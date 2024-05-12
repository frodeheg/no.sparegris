/* eslint-disable comma-dangle */
/* eslint-disable import/no-dynamic-require */
/* eslint-disable no-nested-ternary */

'use strict';

// eslint-disable-next-line no-undef
const homeypath = ('testing' in global && testing) ? '../../testing/' : '';
const { Device } = require(`${homeypath}homey`);
const { Mutex } = require('async-mutex');
const fs = require('fs');
const { TIMESPAN, timeSinceLastLimiter, toLocalTime, timeDiff } = require('../../common/homeytime');
const { findFile } = require('../../common/homeyfile');
const c = require('../../common/constants');
const d = require('../../common/devices');
const Framebuffer = require('../../lib/framebuffer');

// Driver Manifest references
const VALIDATION_SETTINGS = 3; // Entry number for validation settings in driver.settings.compose.json
const STATUS_GOTWATT = 0;
const STATUS_GOTBATTERY = 1;
const STATUS_GOTCANCHARGE = 2;
const STATUS_GOTCANTCHARGE = 3;
const STATUS_GOTERROR = 4;

const ID_THROTTLE = 1;

// States
const STATE_FULL_CHARGE = 0;
const STATE_PARTIAL_CHARGE = 1;
const STATE_CANT_CHARGE = 2;
const STATE_ERROR = 3;

// Charge groups
const CHARGEGROUP = {
  OUTSIDE_SHEDULE: 0,
  PLANNED_ON: 1,
  PLANNED_OFF: 2,
  PAST_ON: 3,
  PAST_OFF: 4
};

// Default text
const okText = '[\u001b[32;1m OK \u001b[37m]';
const errText = '[\u001b[31;1mFAIL\u001b[37m]';
const infoText = '[\u001b[32;22mINFO\u001b[37;1m]';
const progressText = '[\u001b[37;0m....\u001b[37;1m]';
const RED = '[\u001b[31;1m';
const YELLOW = '\u001b[33;1m';
const WHITE = '\u001b[37;1m';

class ChargeDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit(now = new Date()) {
    this.homey.app.updateLog('Charger init', c.LOG_INFO);
    this.homey.app.updateLog('Piggy Charger has been initialized', 1);
    this.settingsManifest = await this.driver.ready().then(() => this.driver.manifest.settings[VALIDATION_SETTINGS].children);
    this.killed = false;

    // TODO: Remove this code before going public, it's only for the debug
    if (this.hasCapability('charge_mode') === false) {
      this.addCapability('charge_mode');
    }

    // Make short access to device data
    const data = this.getData();
    this.targetDriver = data.targetDriver;
    if (this.targetDriver) {
      this.homey.app.updateLog(`Controller will use direct access for ${this.targetDriver} (Device ID: ${data.id})`, c.LOG_INFO);
      this.targetId = data.id;
      this.targetDef = d.DEVICE_CMD[this.targetDriver];
    }

    // Reset device setting if it's the first time the device is started
    if (!this.getStoreValue('firstInitDone')) {
      await this.setCapabilityValue('onoff', false);
      await this.setCapabilityValue('alarm_generic.notValidated', true);
      await this.setStoreValue('firstInitDone', true);
    }

    // Register maintainance action used for validation of the device
    this.registerCapabilityListener('button.reset', async () => {
      this.log('Reset charger state in order to re-validate it');
      this.__spookey_changes = 0;
      const settings = {};
      settings.GotSignalWatt = 'False';
      settings.GotSignalBattery = 'False';
      settings.GotSignalStatusCanCharge = 'False';
      settings.GotSignalStatusCantCharge = 'False';
      settings.GotSignalStatusError = 'False';
      settings.toggleMeasureW = '-';
      this.setSettings(settings);
      this.setCapabilityValue('onoff', false);
      this.setCapabilityValue('alarm_generic.notValidated', true);
      if (this.triggerThreadStart) {
        clearTimeout(this.triggerThread);
        delete this.triggerThreadStart;
        delete this.triggerThread;
      }
      return Promise.resolve();
    });

    // Register current charging setting
    this.chargePlan = this.getStoreValue('chargePlan') || {};
    this.chargePlan.cycleStart = this.chargePlan.cycleStart ? new Date(this.chargePlan.cycleStart) : new Date();
    this.chargePlan.cycleEnd = this.chargePlan.cycleEnd ? new Date(this.chargePlan.cycleEnd) : new Date();
    this.chargePlan.cycleType = +this.chargePlan.cycleType || c.OFFER_HOURS;
    this.chargePlan.cycleTotal = +this.chargePlan.cycleTotal || 0; // Total number of Wh or hours to charge
    this.chargePlan.cycleRemaining = +this.chargePlan.cycleRemaining || 0; // Remaining number of Wh or hours to charge
    this.chargePlan.currentPlan = Array.isArray(this.chargePlan.currentPlan) ? this.chargePlan.currentPlan : [];
    this.chargePlan.originalPlan = Array.isArray(this.chargePlan.originalPlan) ? this.chargePlan.originalPlan : [];
    this.chargePlan.actualCharge = Array.isArray(this.chargePlan.actualCharge) ? this.chargePlan.actualCharge : []; // Updated at the end of every hour
    this.chargePlan.actualPrices = Array.isArray(this.chargePlan.actualPrices) ? this.chargePlan.actualPrices : []; // Updated at the beginning of every hour
    this.chargePlan.currentIndex = +this.chargePlan.currentIndex || 0;

    this.mutexForPower = new Mutex();
    this.__previousTime = new Date(now);
    this.__spookey_check_activated = undefined;
    this.__spookey_changes = 0;
    this.__offeredEnergy = 0;
    this.limited = false;
    this.moneySpentTotal = this.getStoreValue('moneySpentTotal') || 0;

    // Create charging token if it doesn't exist and return it in case it already exists
    this.chargeToken = await this.homey.flow.createToken(`chargeToken-${data.id}`, {
      type: 'string',
      title: `Charge Plan ${this.getName()}`
    }).catch((err) => this.homey.flow.getToken(`chargeToken-${data.id}`))
      .catch((err) => undefined);
    await this.homey.flow.getToken(`chargeToken-${data.id}`);
    await this.homey.app.doPriceCalculations(now);
    await this.updateChargePlan([]);
    await this.rescheduleCharging(false);

    // Link on-off button with the "controllable-device" setting in piggy
    this.registerCapabilityListener('onoff', async (newVal) => this.makeControllable(newVal));

    // Register the mode change capability
    this.registerCapabilityListener('charge_mode', async (newMode) => {
      this.homey.app.updateLog(`Changed charge mode to : ${newMode}`, c.LOG_INFO);
      return Promise.resolve();
    });

    // Link target-power with the piggy control (note, this cap is hidden for everyone else)
    this.registerCapabilityListener('target_power', async (newPow) => {
      return this.setTargetPower(newPow)
        .then((err) => {
          this.homey.app.updateLog(`Failed changing charger power: ${err.message}`, c.LOG_INFO);
        });
    });

    this.fb = await new Framebuffer({ width: 500, height: 500, colorType: 2, bgColor: { red: 80, green: 80, blue: 80 }});
    await this.homey.images.createImage()
      .then((image) => {
        this.image = image;
        image.setStream((stream) => this.refreshImageStream(stream));
        this.setCameraImage('front', 'Help image', image);
        return this.homey.flow.createToken(`ChargeCam_${this.getId()}`, {
          type: 'image',
          title: `${this.getName()} camera`
        });
      })
      .then((imageToken) => {
        this.imageToken = imageToken;
        return imageToken.setValue(this.image);
      })
      .catch((err) => {
        this.homey.app.updateLog(`Camera image1 failed ${err}`, c.LOG_ERROR);
      });
    /* await this.homey.images.createImage()
      .then((image) => {
        image.setPath('../assets/images/Codepage-437.png');
        return image.update()
          .then(() => this.setCameraImage('help', 'Help image 2', image));
      })
      .catch((err) => {
        this.homey.app.updateLog(`Camera image2 failed ${err}`, c.LOG_ERROR);
      }) */

    // Make sure the device is turned on/off when added/removed from app settings
    this.homey.settings.on('set', (setting) => {
      if (setting === 'settingsSaved') {
        if (this.settingsCalled) {
          delete this.settingsCalled;
          return Promise.resolve();
        }
        this.settingsCalled = true;
        const deviceId = this.getId();
        const frostList = this.homey.settings.get('frostList') || {};
        const wantOn = deviceId in frostList;
        const isOn = this.getCapabilityValue('onoff');
        if ((!isOn && wantOn) || (isOn && !wantOn)) {
          this.log(`Switching controller ${deviceId} controllable state from ${isOn} -> ${wantOn}`);
          return this.makeControllable(wantOn)
            .then(() => this.setCapabilityValue('onoff', wantOn))
            .catch((err) => {
              this.log(err);
              this.homey.settings.set('customError', err.message);
              this.makeControllable(!wantOn).catch(this.error);
            });
        }
      }
      return Promise.resolve();
    });

    // Start the onProcessPower timer if it is not active
    if (this.__powerProcessID === undefined && !this.killed) {
      this.__powerProcessID = setTimeout(() => this.onProcessPowerWrapper(), 1000 * 10);
    }

    this.homey.app.updateLog('charger init done....', c.LOG_INFO);
  }

  /**
   * Switches state of the controller to be controllable or not
   * newVal: true when the device should be controllable, false otherwise.
   */
  async makeControllable(newVal) {
    const deviceId = this.getId();
    this.log(`Changing controllable state to ${newVal} for Charger: ${deviceId}`);
    if (newVal) {
      // Check if the device can be turned on
      const settings = this.getSettings();
      if (settings.GotSignalWatt === 'False'
        || (settings.GotSignalBattery === 'False' && settings.batteryFlowRequired)
        || settings.GotSignalStatusCanCharge === 'False'
        || settings.toggleMeasureW === '-') {
        return Promise.reject(new Error(this.homey.__('charger.error.notReady')));
      }
    }
    // Make the device controllable if it was not...
    let __deviceList = this.homey.settings.get('deviceList') || {};
    if (__deviceList === null || !(deviceId in __deviceList)) {
      __deviceList = await this.homey.app.createDeviceList();
    }
    __deviceList[deviceId].use = newVal;
    const frostList = this.homey.settings.get('frostList') || {};
    const modeList = this.homey.settings.get('modeList');
    const priceList = this.homey.settings.get('priceActionList') || {};
    if (newVal) {
      // Disable the old controller (TODO: Remove when the old controller is deprecated)
      if (this.targetDriver && this.targetId in __deviceList && __deviceList[this.targetId].use) {
        __deviceList[this.targetId].use = false;
        delete frostList[this.targetId];
        for (let m = 0; m < modeList.length; m++) {
          const idx = modeList[m].findIndex(({ id }) => id === this.targetId);
          if (idx >= 0) modeList[m].splice(idx, 1);
        }
        for (let p = 0; p < priceList.length; p++) delete priceList[p][this.targetId];
      }

      // Set up all state required when enabling a device:
      frostList[deviceId] = { minTemp: 5 };
      const oldModes = this.getStoreValue('oldModes') || [];
      for (let m = 0; m < modeList.length; m++) {
        const idx = modeList[m].findIndex(({ id }) => id === deviceId);
        if (idx < 0) {
          const operation = Array.isArray(oldModes)
            && oldModes[m]
            && (oldModes[m] in c.MAIN_OP)
            ? oldModes[m] : c.MAIN_OP.CONTROLLED;
          modeList[m].push({ id: deviceId, operation, targetTemp: 5 });
        }
      }
      const oldPriceTarget = this.getStoreValue('oldPriceTarget') || [];
      for (let p = 0; p < priceList.length; p++) {
        const operation = Array.isArray(oldPriceTarget) && oldPriceTarget[p] ? oldPriceTarget[p] : c.TARGET_OP.TURN_ON;
        priceList[p][deviceId] = { delta: null, operation };
      }
    } else {
      // If attempting to turn off store the controllable status for next time it is enabled
      const oldModes = [];
      for (let m = 0; m < modeList.length; m++) {
        const idx = modeList[m].findIndex(({ id }) => id === deviceId);
        oldModes[m] = (idx >= 0) ? modeList[m][idx].operation
          : (m in oldModes) ? oldModes[m]
            : c.MAIN_OP.CONTROLLED;
      }
      await this.setStoreValue('oldModes', oldModes).catch(this.error);
      const oldPriceTarget = [];
      for (let p = 0; p < priceList.length; p++) {
        oldPriceTarget[p] = (Array.isArray(priceList[p]) && deviceId in priceList[p]) ? priceList[p][deviceId].operation
          : (p in oldPriceTarget) ? oldPriceTarget[p]
            : c.TARGET_OP.TURN_ON;
      }
      await this.setStoreValue('oldPriceTarget', oldPriceTarget).catch(this.error);

      delete frostList[deviceId];
      for (let m = 0; m < modeList.length; m++) {
        const idx = modeList[m].findIndex(({ id }) => id === deviceId);
        if (idx >= 0) {
          modeList[m].splice(idx, 1);
        }
      }
      for (let p = 0; p < priceList.length; p++) {
        delete priceList[p][deviceId];
      }
    }
    // Update all settings
    await this.homey.settings.set('frostList', frostList);
    await this.homey.settings.set('modeList', modeList);
    this.homey.app.__deviceList = __deviceList;
    await this.homey.settings.set('deviceList', __deviceList);
    await this.homey.settings.set('priceActionList', priceList);
    // If a device is attached, make sure the add and remove commands are run
    if (newVal) {
      return this.onTurnedOn();
    }
    return this.onTurnedOff();
  }

  /**
   * Update a setting when within a validation cycle only
   */
  async updateSettingsIfValidationCycle(setting, newVal) {
    if (this.getCapabilityValue('alarm_generic.notValidated') === true) {
      const settings = this.getSettings();
      const changed = settings[setting] !== newVal;
      const newSetting = {};
      newSetting[setting] = newVal;
      if (changed) {
        return this.setSettings(newSetting)
          .then(() => {
            this.settings = this.getSettings();
            return Promise.resolve();
          });
      }
    }
    return Promise.resolve();
  }

  /**
   * Update the Charge plan JSON
   * The structure to set up is as follows:
   * {
   *   schedule: [
   *     // one item per hour in the charge plan. Anything before/after the plan is deleted.
   *     { startTime: xxxx, plannedPower: xxxx, actualPower: xxxx },
   *   ],
   *   currentIdx: number // Points to the element in the schedule array which is current
   */
  async updateChargePlan(newPlan) {
    for (let i = 0; i < newPlan.length; i++) {
      this.chargePlan.currentPlan[this.chargePlan.currentIndex + i] = newPlan[i];
    }
    if (this.chargePlan.currentIndex === 0) {
      this.chargePlan.originalPlan = [...newPlan];
    }
    if (!this.chargeToken) return Promise.resolve(); // Return ok to avoid crashing
    return this.chargeToken.setValue(JSON.stringify(this.chargePlan));
  }

  async onUninit() {
    this.homey.app.updateLog('piggy-charger onUninit', c.LOG_INFO);
    this.killed = true;
    if (this.triggerThread) {
      clearTimeout(this.triggerThread);
      delete this.triggerThread;
    }
    if (this.getCapabilityValue('onoff')) {
      await this.onTurnedOff();
      await this.setCapabilityValue('onoff', false).catch(this.ignoredError);
    }
    if (this.__powerProcessID !== undefined) {
      clearTimeout(this.__powerProcessID);
      delete this.__powerProcessID;
    }
    await this.homey.flow.unregisterToken(this.chargeToken);
    delete this.chargeToken;
  }

  /**
   * Runs the turn-on procedure for the controller
   * - This procedure consist of powering off the controlled devices
   */
  async onTurnedOn() {
    if (this.targetDriver) {
      return this.homey.app.runDeviceCommands(this.targetId, 'onAdd');
    }
    // else flow based control, make sure the charging power is 0W
    const changeChargingPowerTrigger = this.homey.flow.getDeviceTriggerCard('charger-change-target-power');
    const tokens = { offeredPower: 0 };
    return changeChargingPowerTrigger.trigger(this, tokens);
  }

  /**
   * Runs the turn-off procedure for the controller
   * - This procedure consist of releasing power control of the controlled devices
   */
  async onTurnedOff() {
    if (this.targetDriver) {
      return this.homey.app.runDeviceCommands(this.targetId, 'onRemove');
    }
    return Promise.resolve();
  }

  /**
   * Reject a setter function if it came from a flow for devices that are directly connected
   */
  async rejectSetterIfRedundant(fromFlow, capName) {
    if (fromFlow && this.targetDriver && this.targetDef[capName]) {
      const newErr = new Error(`${this.homey.__('charger.warnings.redundantFlow')} (${capName})`);
      this.homey.app.updateLog(newErr.message, c.LOG_ERROR);
      return Promise.reject(newErr);
    }
    return Promise.resolve();
  }

  /**
   * Set the charger state
   */
  async setChargerState(state, fromFlow = true) {
    return this.rejectSetterIfRedundant(fromFlow, 'statusCap')
      .then(() => {
        this.setCapabilityValue('charge_status', String(state));
        let settingToUpdate;
        switch (+state) {
          case STATE_FULL_CHARGE:
          case STATE_PARTIAL_CHARGE: settingToUpdate = 'GotSignalStatusCanCharge'; break;
          case STATE_CANT_CHARGE: settingToUpdate = 'GotSignalStatusCantCharge'; break;
          default:
          case STATE_ERROR: settingToUpdate = 'GotSignalStatusError'; break;
        }
        if (settingToUpdate !== undefined) return this.updateSettingsIfValidationCycle(settingToUpdate, 'True');
        return Promise.resolve();
      })
      .then(() => Promise.resolve(+state));
  }

  /**
   * Sets the charger power
   */
  async setChargerPower(power, fromFlow = true) {
    return this.rejectSetterIfRedundant(fromFlow, 'measurePowerCap')
      .then(() => this.setCapabilityValue('measure_power', (+power < 0) ? 0 : +power))
      .then(() => this.updateSettingsIfValidationCycle('GotSignalWatt', 'True'))
      .then(() => Promise.resolve((+power < 0) ? 0 : +power));
  }

  /**
   * Makes sure that a charge cycle does not move out of the active phase
   * and count spookey changes
   * Returns true if a change was needed
   */
  async chargeCycleValidation(planActive, throttleActive) {
    if (!this.targetDriver) return Promise.resolve(false);
    const listRef = planActive ? 'onChargeStart' : 'onChargeEnd';
    const changeNeeded = await this.homey.app.runDeviceCommands(this.targetId, listRef); // Pass errors on
    this.__spookey_changes += (this.__spookey_check_activated === planActive && !throttleActive) ? changeNeeded : 0;
    this.__spookey_check_activated = planActive;
    return Promise.resolve(changeNeeded);
  }

  /**
   * Sets the target power (called internally when the target power capability changes)
   */
  async setTargetPower(power, powerChange = 0) {
    // Filter the new target power with the charge plan
    const { withinChargingCycle, withinChargingPlan } = this.getIsPlanned();
    const filteredPower = withinChargingPlan ? +power : 0;

    // Check that we do not toggle the charger too often
    const now = new Date();
    const timeLapsed = ((now - this.prevChargerTime) / 1000) || Infinity; // Lapsed time in seconds
    const throttleActive = timeLapsed < +this.settings.toggleTime;

    return this.chargeCycleValidation(withinChargingCycle, throttleActive)
      .then(() => {
        // Report power to device trigger
        if (this.targetDriver && this.targetDef.setCurrentCap) {
          return this.homey.app.getDevice(this.targetId)
            .then((device) => {
              if (!device.capabilitiesObj) {
                return Promise.reject(new Error(`Timed out when waiting for charger device ${this.targetId}`));
              }
              const { lastCurrent, lastPower } = this;
              const ampsActualOffer = +device.capabilitiesObj[this.targetDef.getOfferedCap].value;
              const ampsOffered = +device.capabilitiesObj[this.targetDef.setCurrentCap].value;
              const powerUsed = +device.capabilitiesObj[this.targetDef.measurePowerCap].value;
              this.setChargerPower(powerUsed, false).catch(this.err);

              if ((lastCurrent === ampsActualOffer) && (lastPower !== powerUsed)) {
                // note that confirmed is not set when lastCurrent is higher than ampsActualOffer because ampsActualOffer is clamped.
                // Since we don't know the clamp it's difficult to detect confirmed for this case... But: This is ok for our case,
                // because confirmed is only used to ignore charger throttle and it doesn't matter if we throttle a little bit more
                // when increasing power. One possible downside is that when power is becoming available then less prioritized devices
                // will have a possibility to be turned on before the charger.
                this.confirmed = true;
                this.ongoing = false;
              }
              const ignoreChargerThrottle = this.confirmed || !this.ongoing;
              const isEmergency = (+powerChange < 0) && (
                ((powerUsed + +powerChange) < 0)
                || ((ampsOffered === this.settings.minCurrent)
                  && (this.settings.minCurrent !== this.settings.stopCurrent)
                  && (this.settings.minCurrent !== this.settings.pauseCurrent)));
              if (this.prevChargerTime !== undefined && throttleActive && !ignoreChargerThrottle && !isEmergency) {
                // Must wait a little bit more before changing
                this.homey.app.updateLog(`Wait more: ${+this.settings.toggleTime} - ${timeLapsed} = ${+this.settings.toggleTime - timeLapsed} sec left`, c.LOG_DEBUG);
                // Report success in case there is an unconfirmed command and we're trying to reduce power... to avoid reporting powerfail too early.
                if (+powerChange < 0) {
                  if (this.homey.app.logUnit === this.getId()) {
                    this.homey.app.updateLog(`finished changeDevicePower() for ${device.name} - still waiting for confirmation on previous command`, c.LOG_ALL);
                  }
                  return Promise.reject(new Error('Change accepted, but throttled', { cause: ID_THROTTLE })); // Translate into [true, false] : Report onChanged=false because of the unconfirmed change
                }
                // Return failure in case the earlier commands was confirmed to allow turning on/off other devices
                if (this.homey.app.logUnit === this.getId()) {
                  this.homey.app.updateLog(`aborted changeDevicePower() for ${device.name} - Must wait for toggle time to expire`, c.LOG_ALL);
                }
                return Promise.reject(new Error('Throttle active', { cause: ID_THROTTLE })); // Translates into [false, false]
              }
              this.prevChargerTime = now;
              if (isEmergency) this.homey.app.updateLog('Emergency turn off for charger device (minToggleTime ignored)', c.LOG_WARNING);

              const chargerStatus = device.capabilitiesObj[this.targetDef.statusCap].value;
              const toMaxCurrent = +device.capabilitiesObj[this.targetDef.setCurrentCap].max;
              const maxCurrent = Math.min(+this.settings.maxCurrent, toMaxCurrent);
              const maxPowers = this.homey.app.readMaxPower();
              const maxPower = (maxPowers[TIMESPAN.QUARTER] !== Infinity) ? maxPowers[TIMESPAN.QUARTER] : maxPowers[TIMESPAN.HOUR];
              const cannotCharge = this.targetDef.statusUnavailable.includes(chargerStatus);
              const shouldntCharge = this.targetDef.statusProblem.includes(chargerStatus);
              const shouldntChargeThrottle = (this.prevChargeIgnoreErrorTime !== undefined) && ((now - this.prevChargeIgnoreErrorTime) < (5 * 60 * 1000)); // Every 5 min ok.
              if (shouldntCharge && !shouldntChargeThrottle) {
                this.prevChargeIgnoreErrorTime = new Date(now.getTime());
              }
              if (this.homey.app.logUnit === this.getId()) {
                if (cannotCharge || (shouldntCharge && shouldntChargeThrottle)) {
                  this.homey.app.updateLog(`Cannot charge ${device.name} due to device state ${chargerStatus}`, c.LOG_ALL);
                }
              }
              if (shouldntCharge) {
                this.homey.app.updateLog(`The Charger may be malfunctioning as it reports state ${chargerStatus}`, c.LOG_ERROR);
              }
              const newOfferPower = Math.min(powerUsed + +powerChange, maxPower);
              const stoppedCharging = !withinChargingCycle || cannotCharge;
              const pausedCharging = !withinChargingPlan || isEmergency || (shouldntCharge && shouldntChargeThrottle);
              const newOfferCurrent = stoppedCharging ? +this.settings.stopCurrent
                : pausedCharging ? +this.settings.pauseCurrent
                  : (+powerUsed === 0) ? +this.settings.startCurrent
                    : Math.floor(Math.min(Math.max(ampsOffered * (newOfferPower / +powerUsed), +this.settings.minCurrent), +maxCurrent));
              this.homey.app.updateLog(`Setting ${newOfferCurrent} amp, was ${ampsActualOffer}`, c.LOG_DEBUG);
              if ((newOfferCurrent === ampsActualOffer) && (newOfferCurrent === ampsOffered)) {
                if (this.homey.app.logUnit === this.getId()) this.homey.app.updateLog(`finished changeDevicePower() for ${device.name} - The new current is the same as the previous`, c.LOG_ALL);
                return Promise.resolve(); // Should resolve to [true, true]
              }
              this.lastCurrent = newOfferCurrent;
              this.lastPower = powerUsed;
              this.confirmed = false;
              this.ongoing = true;
              const capName = this.targetDef.setCurrentCap;
              if (this.homey.app.logUnit === this.getId()) {
                this.homey.app.updateLog(`Setting Device ${device.name}.${capName} = ${newOfferCurrent} | Origin ChangeDevicePower(${powerChange})`, c.LOG_ALL);
              }
              return device.setCapabilityValue(capName, newOfferCurrent);
            }).then((value) => {
              this.ongoing = false;
              this.nComError = 0;
              this.reliability = (0.99 * this.reliability) + (0.01 * 1); // Reliable
              return Promise.resolve(value);
            })
            .catch((err) => {
              if (err.cause !== ID_THROTTLE) {
                this.homey.app.updateLog(`Failed signalling charger: ${err.message}`, c.LOG_ERROR);
                this.nComError += 1;
                this.ongoing = undefined;
                this.reliability = (0.99 * this.reliability) + (0.01 * 0); // Unreliable
              }
              return Promise.reject(err);
            });
        }
        // Else flow device: Send trigger
        const changeChargingPowerTrigger = this.homey.flow.getDeviceTriggerCard('charger-change-target-power');
        const tokens = { offeredPower: filteredPower };
        changeChargingPowerTrigger.trigger(this, tokens);
        return Promise.resolve();
      })
      .then(() => Promise.resolve(filteredPower));
  }

  /**
   * Sets the battery level
   */
  async setBatteryLevel(batteryLevel, fromFlow = true) {
    return this.rejectSetterIfRedundant(fromFlow, 'getBatteryCap')
      .then(() => this.setCapabilityValue('measure_battery', +batteryLevel))
      .then(() => this.updateSettingsIfValidationCycle('GotSignalBattery', 'True'))
      .then(() => Promise.resolve(+batteryLevel));
  }

  /**
   * Validation procedure
   * Returns the validation image
   */
  async validationProcedure(dst) {
    return findFile('drivers/piggy-charger/assets/images/notValid.png')
      .catch((err) => this.setUnavailable(err.message))
      .then((file) => dst.loadFile(file))
      .then(() => dst.setCursorWindow(190, 80, 470, 170))
      .then(() => dst.setTextColor([255, 128, 128, 255]))
      .then(() => dst.addText(`${this.homey.__('charger.validation.heading')}\n`))
      .then(() => dst.addText('-----------------------------'))
      .then(() => dst.setCursorWindow(33, 180, 470, 475))
      .then(() => dst.setTextColor([255, 255, 255, 255]))
      .then(() => this.runStateTest(dst))
      .then(() => this.runBatteryTest(dst))
      .then(() => this.runWattTest(dst))
      .then(() => this.runTriggerTest(dst))
      .then(() => this.runTurnedOnTest(dst))
      .then(() => this.setAllPassed())
      .catch((err) => {
        this.setCapabilityValue('alarm_generic.notValidated', true);
        this.homey.app.updateLog(err.message, c.LOG_INFO);
        let errText = '';
        if (err) errText += `${YELLOW}${err.message}\n`;
        errText += `${WHITE}${this.homey.__('charger.validation.wait')}\n`;
        return dst.addText(errText);
      })
      .finally(() => dst.addText(`\u001b[0m(${this.homey.__('charger.validation.reset')})\n\u001b[1m`));
  }

  /**
   * Returns an image displaying the charge plan
   */
  async displayPlan(dst, now) {
    const title = this.homey.__('chargePlanGraph.title');
    const yAxisText = this.homey.__('chargePlanGraph.price');
    const groupText = this.homey.__('chargePlanGraph.enabled');
    const alwaysOn = (+this.getCapabilityValue('charge_mode') === c.MAIN_OP.ALWAYS_ON);
    const startHour = alwaysOn ? 0 : this.chargePlan.cycleStart ? toLocalTime(this.chargePlan.cycleStart, this.homey).getHours() : 0;
    const cycleEnded = this.chargePlan.cycleEnd < now;
    const statusTextSrc = alwaysOn ? 'chargePlanGraph.alwaysOn'
      : cycleEnded ? 'chargePlanGraph.cycleEnded'
        : 'chargePlanGraph.charging';
    const statusText = this.homey.__(statusTextSrc);
    const xAxisText = [];
    // TBD: Values && group (CHARGEGROUP)
    const currentIndex = alwaysOn ? toLocalTime(now, this.homey).getHours() : this.chargePlan.currentIndex;
    const remaining = (24 - currentIndex < 0) ? 0 : (24 - currentIndex); // Safeguard for summer/winter time
    const group = alwaysOn ? [...Array(currentIndex).fill(CHARGEGROUP.PAST_ON), ...Array(remaining).fill(CHARGEGROUP.PLANNED_ON)] : [
      ...this.chargePlan.actualCharge.slice(0, currentIndex).map((charge) => (charge ? CHARGEGROUP.PAST_ON : CHARGEGROUP.PAST_OFF)),
      ...this.chargePlan.currentPlan.slice(currentIndex, 24).map((charge) => (charge ? CHARGEGROUP.PLANNED_ON : CHARGEGROUP.PLANNED_OFF))
    ].slice(0, 24);
    const endTimeUTC = new Date(now.getTime());
    endTimeUTC.setUTCMinutes(endTimeUTC.getUTCMinutes() + 1440, 0, 0);
    const values = alwaysOn ? [...await this.homey.app.getPricePrediction(now, endTimeUTC)] : this.chargePlan.actualPrices;
    for (let i = 0; i < 24; i++) {
      xAxisText[i] = `${String((i + startHour) % 24).padStart(2, ' ')}:00`;
      if (!(i in values)) values[i] = null;
      if (!(i in group)) group[i] = 0;
    }
    return findFile('drivers/piggy-charger/assets/images/valid.png')
      .catch((err) => this.setUnavailable(err.message))
      .then((file) => dst.loadFile(file))
      .then(() => dst.setTextSize(2))
      .then(() => dst.addText(title, 250 - (dst.getWidth(title) / 2), 25))
      .then(() => dst.setTextSize(1))
      .then(() => dst.setCursorWindow(25, 60, 475, 170))
      .then(() => dst.addText(statusText, 25, 80))
      .then(() => dst.drawLineChart(25, 150, 450, 325, {
        xAxisText,
        yAxisText,
        groupText,
        values,
        group,
        groupCol: [
          [0, 0, 0, 128], // Outside schedule
          [64, 255, 64, 128], // Planned on
          [255, 64, 64, 128], // Planned off
          [0, 64, 0, 128], // Past on
          [64, 0, 0, 128] // Past off
        ],
        gridCol: [128, 128, 128, 255],
        yCol: [180, 180, 180, 255],
        xCol: [180, 180, 180, 255],
        lineCol: [255, 255, 128, 255]
      }))
      .catch((err) => dst.addText(`${RED}ERROR: Please report this to the developer: ${err.message}${WHITE}`));
  }

  /**
   * Returns an image suggesting to create a charge plan
   */
  async displayNoPlan(dst) {
    const title = this.homey.__('chargePlanGraph.title');
    const mode = +this.getCapabilityValue('charge_mode');
    const textSource = (mode === c.MAIN_OP.CONTROLLED) ? 'chargePlanGraph.noPlan' : 'chargePlanGraph.disabled';
    const noPlanText = this.homey.__(textSource);
    return findFile('drivers/piggy-charger/assets/images/large.png')
      .catch((err) => this.setUnavailable(err.message))
      .then((file) => dst.loadFile(file))
      .then(() => dst.setTextSize(2))
      .then(() => dst.addText(`\x1B[4;30m${title}\x1B[24m`, 250 - (dst.getWidth(title) / 2), 25))
      .then(() => dst.setTextSize(1))
      .then(() => dst.setCursorWindow(25, 60, 475, 270))
      .then(() => dst.addText(noPlanText, 25, 80));
  }

  /**
   * Creates a image that can be sent to the device image stream
   */
  async refreshImageStream(stream, now = new Date()) {
    // iOS requests two images for each refresh, this is a short hack to abort the first request
    // in case a new one comes within 100 ms.
    if (this.iOSHackActive) {
      this.iOSHackAck = true;
    } else {
      delete this.iOSHackAck;
      this.iOSHackActive = true;
      const delay = (ms) => new Promise((res) => setTimeout(res, ms));
      await delay(100);
      delete this.iOSHackActive;
      if (this.iOSHackAck) return Promise.reject(new Error('Aborted due to iOS workaround hack'));
    }

    // The default shown image per consumer is the first image received by the consumer.
    // Thus, send a specialized first image to ease the understanding of the camera device.
    // Note though.... the first image received by the consumer is not the same for every consumer
    // Thus, the code below should be updated to send the first image to every consumer and not only the first one... (TODO)
    if (!this.sentFirstImage) {
      return findFile('drivers/piggy-charger/assets/images/refresh_single.png')
        .then((filename) => fs.createReadStream(filename), { bufferSize: 1024 })
        .then((writer) => {
          this.sentFirstImage = true;
          return writer.pipe(stream);
        });
    }
    const delayedFinalize = (device) => {
      if (!device.timer) {
        device.timer = setTimeout((device) => {
          device.ongoing = false;
          clearTimeout(device.timer);
          delete device.timer;
        }, 2000, device);
      } // Else timer already ongoing
    };
    if (this.ongoing) {
      return findFile('drivers/piggy-charger/assets/images/wait.png')
        .then((filename) => fs.createReadStream(filename, { bufferSize: 1024 }))
        .then((writer) => {
          delayedFinalize(this);
          writer.pipe(stream);
          return Promise.resolve();
        });
    }
    this.ongoing = true;

    this.homey.app.updateLog('Image refresh started....', c.LOG_INFO);
    this.settings = this.getSettings();
    return Promise.resolve(this.getCapabilityValue('alarm_generic.notValidated'))
      .then((notValidated) => {
        if (notValidated) return this.validationProcedure(this.fb);
        const mode = +this.getCapabilityValue('charge_mode');
        if (((this.chargePlan.cycleStart < now) && (mode === c.MAIN_OP.CONTROLLED))
          || (mode === c.MAIN_OP.ALWAYS_ON)) {
          return this.displayPlan(this.fb, now);
        }
        return this.displayNoPlan(this.fb);
      })
      .then(() => {
        this.homey.app.updateLog('Image was refreshed', c.LOG_INFO);
        delayedFinalize(this);
        return this.fb.pipe(stream);
      })
      .catch((err) => {
        this.homey.app.updateLog(`Image update failed: ${err}`, c.LOG_ERROR);
      });
  }

  /**
   * Waits for a test to complete and writes the results
   * -If the test takes too long, timeout and write waiting text
   * -If the test completes, write ok-text
   * -If the test fails, write error-text
   */
  async waitForTest(dst, promise, settingId, settingName) {
    const text = this.settingsManifest[settingId];
    return Promise.race([
      promise,
      new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve({ status: progressText, err: null, timeout: true });
        }, 1000);
      })])
      .then((params) => {
        if (typeof params === 'object' && params && ('timeout' in params)) return Promise.resolve(params);
        if (this.settings[settingName] !== 'True') {
          return Promise.resolve({ status: errText, err: new Error(`${this.homey.__(text.hint)}\n`), timeout: null });
        }
        return Promise.resolve({ status: okText, err: null, timeout: null });
      })
      .then(({ status, err, timeout }) => { // only in case of timeout
        dst.addText(`${status} ${this.homey.__(text.label)}\n`);
        if (timeout) return Promise.reject();
        if (err) return Promise.reject(err); // Pass on real error
        return Promise.resolve();
      });
  }

  /**
   * This test will just check that the charger state has been sent to the device
   */
  async runStateTest(dst) {
    return this.getState()
      .then((state) => {
        switch (state) {
          case STATE_FULL_CHARGE:
          case STATE_PARTIAL_CHARGE:
            // The state is ok to go for charging
            break;
          case STATE_CANT_CHARGE:
            dst.addText(`${errText} ${this.homey.__('charger.validation.stateLabel')}\n`);
            return Promise.reject(new Error(this.homey.__('charger.validation.stateHint')));
          case STATE_ERROR:
            dst.addText(`${errText} ${this.homey.__('charger.validation.stateLabel')}\n`);
            return Promise.reject(new Error(this.homey.__('charger.validation.stateHint')));
          default: // null and undefined
            dst.addText(`${errText} ${this.homey.__('charger.validation.stateLabel')}\n`);
            return Promise.reject(new Error(this.homey.__('charger.validation.stateHint')));
        }
        dst.addText(`${okText} ${this.homey.__('charger.validation.stateLabel')}\n`);
        return Promise.resolve();
      });
  }

  async runBatteryTest(dst) {
    if (!this.settings.batteryFlowRequired) {
      dst.addText(`${okText} ${this.homey.__('charger.validation.batterySkipped')}\n`);
      return Promise.resolve();
    }
    // If battery is not present, tries to fetch from a connected device, which might timeout
    return this.waitForTest(dst, this.getBattery(), STATUS_GOTBATTERY, 'GotSignalBattery');
  }

  async runWattTest(dst) {
    // If watt is not present, tries to fetch from a connected device, which might timeout
    return this.waitForTest(dst, this.getPower(), STATUS_GOTWATT, 'GotSignalWatt');
  }

  /**
   * Wait for trigger replay
   * testProgress:
   *   0: Not started yet, waiting for power to reach 0
   *   1: 0W Validated - waiting for power to go up
   *   2: >0W Validated
   */
  async checkForTriggerReply(secleft, testProgress) {
    if (this.killed) return Promise.resolve();
    this.homey.app.updateLog(`Sec left ${secleft}`, c.LOG_INFO);
    const newPower = this.getCapabilityValue('measure_power');
    const zeroPowerThreshold = 200; // Easee has been reported to set watts to 62W when 0 ams are offered.
    let changeNeeded = false;
    if (testProgress === 0) {
      // Validate 0 W
      changeNeeded = await this.onTurnedOn();
      if ((!changeNeeded) && (+newPower <= zeroPowerThreshold)) {
        this.homey.app.updateLog(`Starting Trigger test at time ${secleft}`, c.LOG_INFO);
        testProgress = 1;
        this.triggerTestStart = new Date();
        this.__spookey_check_activated = false;
      }
    }
    if (testProgress === 1) {
      // 0 W validated - Turn up W
      if (this.targetDriver && this.targetDef.setCurrentCap) {
        const device = await this.homey.app.getDevice(this.targetId);
        changeNeeded = await this.homey.app.runDeviceCommands(this.targetId, 'onChargeStart')
          || !device
          || !('capabilitiesObj' in device)
          || !(this.targetDef.setCurrentCap in device.capabilitiesObj)
          || !('value' in device.capabilitiesObj[this.targetDef.setCurrentCap])
          || (device.capabilitiesObj[this.targetDef.setCurrentCap].value !== 10);
        if (device) device.setCapabilityValue(this.targetDef.setCurrentCap, 10);
      } else {
        // Call flow when power cannot be changed by automation
        const changeChargingPowerTrigger = this.homey.flow.getDeviceTriggerCard('charger-change-target-power');
        const tokens = { offeredPower: 2000 };
        changeChargingPowerTrigger.trigger(this, tokens);
      }
      if (!changeNeeded && (+newPower > zeroPowerThreshold)) {
        testProgress = 2;
        this.__spookey_check_activated = false;
      }
    }
    if (testProgress === 2) {
      // > 0W confirmed
      if (this.targetDriver && this.targetDef.setCurrentCap) {
        await this.homey.app.runDeviceCommands(this.targetId, 'onChargeEnd');
      }
      const now = new Date();
      const lastedTime = Math.round((now - this.triggerTestStart) / 1000);
      const settings = { toggleMeasureW: `${lastedTime} s` };
      this.setSettings(settings);
      this.homey.app.updateLog(`Ended Trigger test at time ${secleft}, got Power ${newPower}`, c.LOG_INFO);
      this.triggerThread = undefined;
      return this.endTriggerTest();
    }
    // Nothing confirmed, test is ongoing
    if (changeNeeded) {
      if (this.__spookey_check_activated) {
        this.__spookey_changes++;
      }
      this.__spookey_check_activated = true;
    }

    if (secleft > 0) {
      this.triggerThread = setTimeout(() => this.checkForTriggerReply(secleft - 1, testProgress), 1000);
    } else {
      // Timed out
      this.triggerThread = undefined;
      return this.endTriggerTest();
    }
    return Promise.resolve();
  }

  /**
   * This test will check if a trigger event has been created.
   */
  async runTriggerTest(dst) {
    const now = new Date();
    const gotResult = this.settings.toggleMeasureW !== '-';

    if (gotResult) {
      this.homey.app.updateLog('has result....', c.LOG_INFO);
      return dst.addText(`${okText} ${this.homey.__('charger.validation.turnaroundLabel')} (${this.settings.toggleMeasureW})\n`);
    }
    if (!this.triggerThreadStart) {
      this.homey.app.updateLog('Started new trigger test', c.LOG_INFO);
      this.triggerThreadStart = now;
      try {
        this.triggerThread = setTimeout(() => this.checkForTriggerReply(300, 0), 1000);
      } catch (err) {
        this.homey.app.updateLog(`Failed to start charging: ${err.message}`, c.LOG_ERROR);
        return Promise.resolve(); // Ignore... the test will eventually time out
      }
    }

    const secLasted = Math.round((now - this.triggerThreadStart) / 1000);
    if (this.__spookey_changes > 0) {
      this.endTriggerTest();
      this.homey.app.updateLog(`Test had ${this.__spookey_changes} spookey changes`, c.LOG_INFO);
      return dst.addText(`${errText} ${this.homey.__('charger.validation.turnaroundLabel')}\n`)
        .then(() => Promise.reject(new Error(this.homey.__('charger.validation.spookey'))));
    }
    if (secLasted > 60 * 5) {
      this.endTriggerTest();
      this.homey.app.updateLog('Test timed out', c.LOG_INFO);
      return dst.addText(`${errText} ${this.homey.__('charger.validation.turnaroundLabel')} (${this.homey.__('charger.validation.turnaroundTimeout')} > 300 s)\n`)
        .then(() => Promise.reject(new Error(this.homey.__('charger.validation.connectCar'))));
    }
    this.homey.app.updateLog('waiting....', c.LOG_INFO);
    return dst.addText(`${progressText} ${this.homey.__('charger.validation.turnaroundLabel')} (${this.homey.__('charger.validation.turnaroundOngoing')} > ${secLasted} s)\n`)
      .then(() => Promise.reject(new Error(this.homey.__('charger.validation.connectCar'))));
  }

  /**
   * Ends the trigger test
   */
  async endTriggerTest() {
    if (this.triggerThread) {
      clearTimeout(this.triggerThread);
      delete this.triggerThreadStart;
      delete this.triggerThread;
    }
    return Promise.resolve()
      .then(() => {
        if (this.targetDriver) {
          return this.homey.app.runDeviceCommands(this.targetId, 'onChargeEnd');
        }
        return Promise.resolve();
      })
      .then(() => this.onTurnedOff())
      .catch((err) => {
        this.homey.app.updateLog(`Failed to end charging: ${err.message}`, c.LOG_ERROR);
        return Promise.resolve();
      });
  }

  /**
   * Check that the device is turned on
   */
  async runTurnedOnTest(dst) {
    const text = this.homey.__('charger.validation.turnedOnLabel');
    const onOffValue = this.getCapabilityValue('onoff');
    if (!onOffValue) {
      dst.addText(`${infoText} ${text}\n`);
      return Promise.reject(new Error(`${this.homey.__('charger.validation.turnedOnHint')}`));
    }
    dst.addText(`${okText} ${text}\n`);
    return Promise.resolve();
  }

  /**
   * Mark the device that all tests passed
   */
  async setAllPassed() {
    return this.setCapabilityValue('alarm_generic.notValidated', false);
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.homey.app.updateLog('Piggy charger has been added', c.LOG_INFO);
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.homey.app.updateLog(`Piggy charger settings was changed: ${JSON.stringify(changedKeys)}`, c.LOG_INFO);
    this.settings = newSettings;
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.homey.app.updateLog('Piggy charger was renamed', 1);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.homey.app.updateLog('Piggy charger has been deleted', 1);
  }

  /**
   * Called when the user initiates a charging cycles through a flow
   * @param offerEnergy number of kWh to offer before time runs out (will be undefined if offerHours)
   * @param endTime the localtime for when to end charging
   * @param offerHours number of hours to offer energy before time runs out (will be undefined if offerEnergy)
   */
  async onChargingCycleStart(offerEnergy, endTime, offerHours = undefined, now = new Date()) {
    if ((typeof (endTime) !== 'string') || (!endTime.includes(':'))) {
      return Promise.reject(new Error(this.homey.__('warnings.notValidTime')));
    }
    const hoursEnd = +endTime.split(':').at(0);
    const minutesEnd = +endTime.split(':').at(1);
    if (hoursEnd < 0 || hoursEnd > 23 || Number.isNaN(hoursEnd)
      || minutesEnd < 0 || minutesEnd > 59 || Number.isNaN(minutesEnd)) {
      return Promise.reject(new Error(this.homey.__('warnings.notValidTime')));
    }

    this.homey.app.updateLog('Charging cycle started', c.LOG_INFO);
    this.__spookey_check_activated = undefined;
    this.__spookey_changes = 0;

    // Convert local end time to UTC
    const nowLocal = toLocalTime(now, this.homey);
    const minutesDiff = timeDiff(nowLocal.getHours(), nowLocal.getMinutes(), hoursEnd, minutesEnd);
    const endTimeUTC = new Date(now.getTime());
    endTimeUTC.setUTCMinutes(endTimeUTC.getUTCMinutes() + minutesDiff, 0, 0);

    // Calculate length of plan in hours
    const startOfHour = new Date(now.getTime());
    startOfHour.setUTCMinutes(0, 0, 0);
    const cycleLength = Math.ceil(Math.min((endTimeUTC - startOfHour) / (60 * 60 * 1000), 24)); // timespan to plan in hours

    // Set up the charge plan
    this.chargePlan = {};
    this.chargePlan.cycleStart = now;
    this.chargePlan.cycleEnd = endTimeUTC;
    this.chargePlan.cycleType = offerEnergy ? c.OFFER_ENERGY : c.OFFER_HOURS;
    this.chargePlan.cycleRemaining = offerEnergy ? (offerEnergy * 1000) : +offerHours;
    this.chargePlan.cycleTotal = this.chargePlan.cycleRemaining;
    this.chargePlan.currentPlan = new Array(cycleLength);
    this.chargePlan.originalPlan = new Array(cycleLength);
    this.chargePlan.actualCharge = new Array(cycleLength);
    this.chargePlan.actualPrices = [...await this.homey.app.getPricePrediction(now, endTimeUTC)];
    this.chargePlan.currentIndex = 0;

    this.setStoreValue('chargePlan', this.chargePlan);

    await this.rescheduleCharging(false, now);

    // Reset the charge process
    this.setCapabilityValue('measure_battery.charge_cycle', 0);
    this.setCapabilityValue('piggy_money', 0);
    this.moneySpentThisCycle = 0;

    await this.refreshCapabilities();

    return Promise.resolve();
  }

  /**
   * Only called when stopping the charging cycle ahead of time
   */
  async onChargingCycleStop(now = new Date()) {
    this.homey.app.updateLog('Charging cycle abruptly ended', c.LOG_INFO);
    if (this.chargePlan.cycleEnd > now) {
      this.chargePlan.cycleRemaining = 0;
      this.chargePlan.cycleEnd = now;
      this.setStoreValue('chargePlan', this.chargePlan);
      this.rescheduleCharging(false);
    } else {
      this.updateChargePlan([]);
      throw new Error('No charging cycle could be stopped');
    }
  }

  /**
   * Sets the capabilities options
   */
  async updateCapability(capabilityId, baseOptions) {
    const options = { ...this.homey.app.manifest.drivers[0].capabilitiesOptions[capabilityId], ...baseOptions };
    await this.setCapabilityOptions(capabilityId, options);
  }

  /**
   * Refresh the capabilities
   */
  async refreshCapabilities() {
    // Change currencies
    const currencyInfo = await this.homey.app.getCurrencyInfo();
    if (this.currency !== currencyInfo.currency) {
      // Currency
      const currencyOptions = {
        units: { en: currencyInfo.unit },
        decimals: currencyInfo.decimals,
      };
      await this.updateCapability('piggy_money', currencyOptions);
      await this.updateCapability('piggy_moneypile', currencyOptions);
      this.currency = currencyInfo.currency;
    }
  }

  /**
   * Called every hour to make sure the Charging is rescheduled most optimal.
   * Whenever a new hour passes, must be called _after_ doPriceCalculations to get correct current_price_index
   */
  async rescheduleCharging(isNewHour, now = new Date()) {
    const end = new Date(this.chargePlan.cycleEnd);
    const priceArray = await this.homey.app.getPricePrediction(now, end);

    if (isNewHour) {
      // Calculate cost of previous hour
      const currentHour = this.homey.app.__current_price_index;
      const currentPrices = this.homey.app.__current_prices;
      const currentCost = (currentHour in currentPrices) ? currentPrices[currentHour] : 0;
      const pastEnergy = this.chargePlan.actualCharge[this.chargePlan.currentIndex] || 0;
      this.moneySpentTotal += pastEnergy * currentCost;
      this.setStoreValue('moneySpentTotal', this.moneySpentTotal);
      this.setCapabilityValue('piggy_moneypile', this.moneySpentTotal);

      const oldRemaining = this.chargePlan.cycleRemaining;
      if (this.chargePlan.cycleType === c.OFFER_ENERGY) {
        this.chargePlan.cycleRemaining -= pastEnergy;
      } else if (this.chargePlan.currentPlan[this.chargePlan.currentIndex] > 0) {
        // OFFER_HOURS - Only subtract for active hours
        this.chargePlan.cycleRemaining -= 1;
      } else {
        // OFFER HOURS - Inactive hours
      }
      // Update prices (they may have been unavailable earlier)
      const startIndex = (now.getHours() - this.chargePlan.cycleStart.getHours() + 24) % 24;
      const cycleLength = this.chargePlan.actualPrices.length;
      for (let loop = startIndex; loop < cycleLength; loop++) {
        this.chargePlan.actualPrices[loop] = priceArray[loop - startIndex];
      }
      if (this.chargePlan.cycleRemaining < 0) this.chargePlan.cycleRemaining = 0;
      if (this.chargePlan.currentIndex < this.chargePlan.currentPlan.length) {
        this.chargePlan.currentIndex++;
      }
      if (this.chargePlan.currentIndex === this.chargePlan.currentPlan.length) {
        // Any remaining charge must be invalidated when the charge plan is completed
        this.chargePlan.cycleRemaining = 0;
      }
      if (oldRemaining !== 0) {
        this.setStoreValue('chargePlan', this.chargePlan);
      }
    }

    // Reset charge plan
    const tempChargePlan = [];

    // Ignore rescheduling if there is nothing left to schedule
    if (this.chargePlan.cycleRemaining === 0) return Promise.resolve();

    // Calculate new charging plan
    const maxLimits = this.homey.app.readMaxPower();
    const maxPower = Math.min(+maxLimits[TIMESPAN.QUARTER] * 4, +maxLimits[TIMESPAN.HOUR]);
    const priceSorted = Array.from(priceArray.keys()).sort((a, b) => ((priceArray[a] === priceArray[b]) ? (a - b) : (priceArray[a] - priceArray[b])));
    let scheduleRemaining = this.chargePlan.cycleRemaining;
    for (let i = 0; (i < priceSorted.length) && (scheduleRemaining > 0); i++) {
      const idx = priceSorted[i];
      const estimatedPower = maxPower * 0.75; // Assume 75% available to the charger TODO: replace with historic average
      tempChargePlan[idx] = estimatedPower;
      scheduleRemaining -= this.chargePlan.cycleType === c.OFFER_ENERGY ? estimatedPower : 1;
    }
    this.setCapabilityValue('measure_battery.charge_cycle', 100 * (1 - ((this.chargePlan.cycleTotal - this.chargePlan.cycleRemaining) / this.chargePlan.cycleRemaining)));
    this.updateChargePlan(tempChargePlan);

    if (isNewHour) {
      // Re-apply the charge on/off since the plan is recalculated
      const oldTargetPower = this.getCapabilityValue('target_power');
      await this.setTargetPower(oldTargetPower)
        .catch((err) => {
          this.homey.app.updateLog(`Charger power failed: ${err.message}`, c.LOG_INFO);
        });
    }

    return Promise.resolve();
  }

  /**
   * Return and reset the offered energy since last time called (called once per hour)
   * Always called before rescheduleCharging (from app.json)
   * NOTE! This also return energy offered when there is no charge plan active...
   */
  async getOfferedEnergy(now = new Date()) {
    // Abort if the timestamp is from the past
    if (this.__previousTime && now < this.__previousTime) return Promise.resolve(0);
    // Find time spent before and after the timestamp
    const lapsedTime = this.__previousTime ? (now - this.__previousTime) : 0;
    const lapsedTimeWithinLimit = timeSinceLastLimiter(now, TIMESPAN.HOUR, this.homey);
    const lapsedTimeAfter = (lapsedTime > lapsedTimeWithinLimit) ? lapsedTimeWithinLimit : lapsedTime;
    const lapsedTimeBefore = lapsedTime - lapsedTimeAfter;

    // Find energy used before the hour mark
    const currentPower = await this.getPower();
    const deltaEnergyBefore = currentPower * (lapsedTimeBefore / (1000 * 60 * 60));

    // Store energy at hour mark
    const pastEnergy = this.__offeredEnergy + deltaEnergyBefore;
    const previousIndex = (this.__previousTime.getHours() - this.chargePlan.cycleStart.getHours() + 24) % 24;
    this.chargePlan.actualCharge[previousIndex] = pastEnergy;

    // Find energy used after the hour mark
    const deltaEnergyAfter = currentPower * (lapsedTimeAfter / (1000 * 60 * 60));

    // Initiate offered energy for the next hour
    this.__previousTime = now;
    this.__offeredEnergy = deltaEnergyAfter;

    return Promise.resolve(pastEnergy);
  }

  /**
   * A wrapper function for whenever the safeguard is run
   */
  async onProcessPowerWrapper() {
    if (this.killed) {
      console.log('The app was killed before properly being shut down...');
      return Promise.resolve();
    }
    return this.mutexForPower.runExclusive(async () => this.onProcessPower())
      .finally(() => {
        if (!this.killed) {
          const timeToNextTrigger = 1000 * 10;
          this.__powerProcessID = setTimeout(() => this.onProcessPowerWrapper(), timeToNextTrigger);
        } else {
          this.__powerProcessID = undefined;
        }
      });
  }

  /**
   * onProcessPower
   * Called whenever we can process the new power situation
   */
  async onProcessPower(now = new Date()) {
    // 1) Update charger state for non-flow devices
    if (this.targetDriver) {
      await this.getState();
      // Check for battery capability
      if (this.targetDef.getBatteryCap) {
        await this.getCapValue(this.targetDef.getBatteryCap)
          .then((batteryLevel) => this.setBatteryLevel(batteryLevel, false));
      }
    }

    // 2) Assess if the charger need to be updated
    const waiting_for_reply = false;
    const timed_out = false;
    if (waiting_for_reply && !timed_out) {
      return Promise.resolve();
    }

    // 3) Signal any new changes to the charger

    // TODO: Call trigger "charger-start-charging"
    // TODO: Call trigger "charger-stop-charging"
    // TODO: Change cap: "measure_battery.charge_cycle",

/*
    const chargerOptions = this.homey.settings.get('chargerOptions');
    if (chargerOptions.chargeTarget === c.CHARGE_TARGET_FLOW) {
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for '${deviceId} because you have selected to control charging using flows, not automaticly.`, c.LOG_ALL);
      return Promise.resolve([true, true]);
    }
    this.updateLog(`Requested power change: ${powerChange}`, c.LOG_DEBUG);
    let device;
    try {
      device = await this.getDevice(deviceId);
      this.updateReliability(deviceId, 1);
    } catch (err) {
      // Most likely timeout
      this.updateLog(`Charger device cannot be fetched. ${String(err)}`, c.LOG_ERROR);
      this.__current_state[deviceId].nComError += 10; // Big error so wait more until retry than smaller errors
      this.updateReliability(deviceId, 0);
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for '${deviceId} due to Homey API issues (Homey is busy)`, c.LOG_ALL);
      return Promise.resolve([false, false]); // The unhandled device is solved by the later nComError handling
    }

    if (this.logUnit === deviceId) this.updateLog(`attempt changeDevicePower(${powerChange}) for ${device.name}`, c.LOG_ALL);

    if (device.capabilitiesObj === null) {
      this.updateLog('Charger device capability list missing', c.LOG_ERROR);
      this.__current_state[deviceId].nComError += 10; // This should not happen
      this.updateReliability(deviceId, 0);
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for ${device.name} due to Homey API issues (Homey busy?)`, c.LOG_ALL);
      return Promise.resolve([false, false]);
    }

    const { driverId } = this.__deviceList[deviceId];
    if ((!(driverId in d.DEVICE_CMD))
      || (d.DEVICE_CMD[driverId].measurePowerCap === undefined)
      || (d.DEVICE_CMD[driverId].setCurrentCap === undefined)
      || (d.DEVICE_CMD[driverId].getOfferedCap === undefined)
      || (d.DEVICE_CMD[driverId].onChargeStart === undefined)
      || (d.DEVICE_CMD[driverId].onChargeEnd === undefined)
      || (d.DEVICE_CMD[driverId].onAdd === undefined)
      || (d.DEVICE_CMD[driverId].onRemove === undefined)
      || (d.DEVICE_CMD[driverId].startCurrent === undefined)
      || (d.DEVICE_CMD[driverId].minCurrent === undefined)
      || (d.DEVICE_CMD[driverId].pauseCurrent === undefined)
      || (d.DEVICE_CMD[driverId].statusCap === undefined)
      || (d.DEVICE_CMD[driverId].statusUnavailable === undefined)) {
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for ${device.name} the charger definition in Piggy is incorrect`, c.LOG_ALL);
      return Promise.reject(new Error('Please notify the developer that the charger definition for this charger is incorrect and need to be updated'));
    }
    const ampsOffered = +await device.capabilitiesObj[d.DEVICE_CMD[driverId].setCurrentCap].value;
    const powerUsed = +await device.capabilitiesObj[d.DEVICE_CMD[driverId].measurePowerCap].value;
    const isOn = (powerUsed > 0) || (ampsOffered > 0);
    this.__charge_power_active = powerUsed;
    if ((!isOn) && (powerChange < chargerOptions.chargeThreshold)) {
      // The device should not be turned on if the available power is less than the charge threshold
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for ${device.name} - available power was less than charge threshold`, c.LOG_ALL);
      return Promise.resolve([false, false]);
    }
    const minCurrent = +chargerOptions.overrideEnable ? +chargerOptions.overrideMinCurrent : d.DEVICE_CMD[driverId].minCurrent;
    const startCurrent = +chargerOptions.overrideEnable ? +chargerOptions.overrideStart : d.DEVICE_CMD[driverId].startCurrent;
    const stopCurrent = +chargerOptions.overrideEnable ? +chargerOptions.overrideStop : 0;
    const pauseCurrent = +chargerOptions.overrideEnable ? +chargerOptions.overridePause : d.DEVICE_CMD[driverId].pauseCurrent;
    const isEmergency = (+powerChange < 0) && (
      ((powerUsed + +powerChange) < 0)
      || ((ampsOffered === minCurrent)
        && (minCurrent !== stopCurrent)
        && (minCurrent !== pauseCurrent)));
    const end = new Date(chargerOptions.chargeEnd);
    if ((end < now)
      || ((chargerOptions.chargeCycleType === c.OFFER_ENERGY) && (+chargerOptions.chargeRemaining < this.__offeredEnergy))) {
      chargerOptions.chargeRemaining = 0;
    }

    const withinChargingCycle = (+chargerOptions.chargeRemaining > 0);
    const withinChargingPlan = (this.chargePlan.currentPlan[this.chargePlan.currentIndex] > 0) && withinChargingCycle;
    const { lastCurrent, lastPower } = this.__current_state[deviceId];
    const ampsActualOffer = +await device.capabilitiesObj[d.DEVICE_CMD[driverId].getOfferedCap].value;
    if ((lastCurrent === ampsActualOffer) && (lastPower !== powerUsed)) {
      // note that confirmed is not set when lastCurrent is higher than ampsActualOffer because ampsActualOffer is clamped.
      // Since we don't know the clamp it's difficult to detect confirmed for this case... But: This is ok for our case,
      // because confirmed is only used to ignore charger throttle and it doesn't matter if we throttle a little bit more
      // when increasing power. One possible downside is that when power is becoming available then less prioritized devices
      // will have a possibility to be turned on before the charger.
      this.__current_state[deviceId].confirmed = true;
    }
    const ignoreChargerThrottle = this.__current_state[deviceId].confirmed;
    // Check that we do not toggle the charger too often
    const timeLapsed = (now - this.prevChargerTime) / 1000; // Lapsed time in seconds
    const throttleActive = timeLapsed < +chargerOptions.minToggleTime;
    if (this.prevChargerTime !== undefined && throttleActive && !ignoreChargerThrottle && !isEmergency) {
      // Must wait a little bit more before changing
      this.updateLog(`Wait more: ${+(chargerOptions.minToggleTime)} - ${timeLapsed} = ${+(chargerOptions.minToggleTime) - timeLapsed} sec left`, c.LOG_DEBUG);
      // Report success in case there is an unconfirmed command and we're trying to reduce power... to avoid reporting powerfail too early.
      if (!ignoreChargerThrottle && (+powerChange < 0)) {
        if (this.logUnit === deviceId) this.updateLog(`finished changeDevicePower() for ${device.name} - still waiting for confirmation on previous command`, c.LOG_ALL);
        return Promise.resolve([true, false]); // Also report onChanged=false because of the unconfirmed change
      }
      // Return failure in case the earlier commands was confirmed to allow turning on/off other devices
      if (this.logUnit === deviceId) this.updateLog(`aborted changeDevicePower() for ${device.name} - Must wait for toggle time to expire`, c.LOG_ALL);
      return Promise.resolve([false, false]);
    }
    this.prevChargerTime = now;
    if (isEmergency) this.updateLog('Emergency turn off for charger device (minToggleTime ignored)', c.LOG_WARNING);

    const chargerStatus = await device.capabilitiesObj[d.DEVICE_CMD[driverId].statusCap].value;
    const toMaxCurrent = +await device.capabilitiesObj[d.DEVICE_CMD[driverId].setCurrentCap].max;
    const maxCurrent = +chargerOptions.overrideEnable ? Math.min(+chargerOptions.overrideMaxCurrent, toMaxCurrent) : toMaxCurrent;
    const maxPowers = this.readMaxPower();
    const maxPower = (maxPowers[TIMESPAN.QUARTER] !== Infinity) ? maxPowers[TIMESPAN.QUARTER] : maxPowers[TIMESPAN.HOUR];
    const cannotCharge = d.DEVICE_CMD[driverId].statusUnavailable.includes(chargerStatus);
    const shouldntCharge = d.DEVICE_CMD[driverId].statusProblem.includes(chargerStatus);
    const shouldntChargeThrottle = (this.prevChargeIgnoreErrorTime !== undefined) && ((now - this.prevChargeIgnoreErrorTime) < (5 * 60 * 1000)); // Every 5 min ok.
    if (shouldntCharge && !shouldntChargeThrottle) {
      this.prevChargeIgnoreErrorTime = new Date(now.getTime());
    }
    if (this.logUnit === deviceId) {
      if (cannotCharge || (shouldntCharge && shouldntChargeThrottle)) {
        this.updateLog(`Cannot charge ${device.name} due to device state ${chargerStatus}`, c.LOG_ALL);
      }
    }
    if (shouldntCharge) {
      this.updateLog(`The Charger may be malfunctioning as it reports state ${chargerStatus}`, c.LOG_ERROR);
    }
    const newOfferPower = Math.min(Math.max(powerUsed + +powerChange, +chargerOptions.chargeMin), maxPower);
    const stoppedCharging = !withinChargingCycle || cannotCharge;
    const pausedCharging = !withinChargingPlan || isEmergency || (shouldntCharge && shouldntChargeThrottle);
    const newOfferCurrent = stoppedCharging ? stopCurrent
      : pausedCharging ? pauseCurrent
        : (+powerUsed === 0) ? startCurrent
          : Math.floor(Math.min(Math.max(ampsOffered * (newOfferPower / +powerUsed), minCurrent), +maxCurrent));
    this.updateLog(`Setting ${newOfferCurrent} amp, was ${ampsActualOffer}`, c.LOG_DEBUG);
    if ((newOfferCurrent === ampsActualOffer) && (newOfferCurrent === ampsOffered)) {
      if (this.logUnit === deviceId) this.updateLog(`finished changeDevicePower() for ${device.name} - The new current is the same as the previous`, c.LOG_ALL);
      return Promise.resolve([true, true]);
    }
    this.__current_state[deviceId].lastCurrent = newOfferCurrent;
    this.__current_state[deviceId].lastPower = powerUsed;
    this.__current_state[deviceId].confirmed = false;
    this.__current_state[deviceId].ongoing = true;
    return this.chargeCycleValidation(deviceId, withinChargingCycle, throttleActive)
      .then(() => {
        const capName = d.DEVICE_CMD[driverId].setCurrentCap;
        if (this.logUnit === deviceId) this.updateLog(`Setting Device ${device.name}.${capName} = ${newOfferCurrent} | Origin ChangeDevicePower(${powerChange})`, c.LOG_ALL);
        return device.setCapabilityValue({ capabilityId: capName, value: newOfferCurrent });
      })
      .then(() => {
        this.__current_state[deviceId].ongoing = false;
        this.__current_state[deviceId].nComError = 0;
        this.updateReliability(deviceId, 1);
        const noChange = withinChargingPlan ? powerUsed + +powerChange < newOfferPower : !isOn;
        if (this.logUnit === deviceId) this.updateLog(`finished changeDevicePower() for ${device.name} - all success`, c.LOG_ALL);
        return Promise.resolve([true, noChange]); // In case more power is offered but it doesn't get used, let the app turn on other devices
      })
      .catch(err => {
        this.updateLog(`Failed signalling charger: ${String(err)}`, c.LOG_ERROR);
        this.__current_state[deviceId].nComError += 1;
        this.__current_state[deviceId].ongoing = undefined;
        this.updateReliability(deviceId, 0);
        if (this.logUnit === deviceId) this.updateLog(`aborted changeDevicePower() for ${device.name} - failed signalling charger ${String(err)}`, c.LOG_ALL);
        return Promise.resolve([false, false]);
      });
*/

    // Update energy used
    const lapsedTime = this.__previousTime ? (now - this.__previousTime) : 0;
    const timeDelta = (lapsedTime < 0) ? 0 : (lapsedTime / (1000 * 60 * 60));
    const currentPower = await this.getPower();
    const deltaEnergy = currentPower * timeDelta;
    this.__previousTime = now;
    this.__offeredEnergy += deltaEnergy;

    // Update money spent
    const currentHour = this.homey.app.__current_price_index;
    const currentPrices = this.homey.app.__current_prices;
    const currentCost = (currentHour in currentPrices) ? currentPrices[currentHour] : 0;
    this.moneySpentThisCycle += deltaEnergy * currentCost;
    this.setCapabilityValue('piggy_money', this.moneySpentThisCycle);
    this.setCapabilityValue('piggy_moneypile', this.moneySpentTotal + this.moneySpentThisCycle);

    return Promise.resolve();
  }

  /** *******************************************************************************************************
   * Internal getters/setters that does not make difference to if the device is Flow or directly controlled *
   ******************************************************************************************************** */

  /**
   * Get a capability value from the controlled device
   */
  async getCapValue(capName) {
    return this.homey.app.getDevice(this.targetId)
      .then((device) => {
        if (!device.capabilitiesObj) {
          return Promise.resolve(undefined);
        }
        if (!(capName in device.capabilitiesObj)) {
          const newErr = new Error(`Could not find the capability ${capName} for ${device.name}. Please install the most recent driver.`);
          this.homey.app.updateLog(newErr, c.LOG_ERROR);
          return Promise.reject(newErr);
        }
        return Promise.resolve(device.capabilitiesObj[capName].value);
      });
  }

  /**
   * Returns state from state cap
   * If it's a non-flow device then the state cap is updated first with the value from the charger
   */
  async getState() {
    if (this.targetDriver && this.targetDef.statusCap !== null) {
      return this.getCapValue(this.targetDef.statusCap)
        .then((state) => {
          const translatedState = (this.targetDef.statusProblem.includes(state)) ? STATE_ERROR
            : (this.targetDef.statusUnavailable.includes(state)) ? STATE_CANT_CHARGE
              : this.limited ? STATE_PARTIAL_CHARGE : STATE_FULL_CHARGE;
          return this.setChargerState(translatedState, false);
        });
    }
    const state = this.getCapabilityValue('charge_status');
    return Promise.resolve(state === null ? STATE_ERROR : +state);
  }

  /**
   * Returns battery level from battery cap
   * If it's a non-flow device then the power cap is updated first with the value from the charger
   */
  async getBattery() {
    if (this.targetDriver && this.targetDef.getBatteryCap) {
      return this.getCapValue(this.targetDef.getBatteryCap)
        .then((batteryLevel) => this.setBatteryLevel(batteryLevel, false));
    }
    return Promise.resolve(this.getCapabilityValue('measure_battery'));
  }

  /**
   * Returns power from power cap
   * If it's a non-flow device then the power cap is updated first with the value from the charger
   */
  async getPower() {
    if (this.targetDriver && this.targetDef.measurePowerCap !== null) {
      return this.getCapValue(this.targetDef.measurePowerCap)
        .then((targetPower) => this.setChargerPower(targetPower, false))
        .then(() => Promise.resolve(this.getCapabilityValue('measure_power')));
    }
    return Promise.resolve(this.getCapabilityValue('measure_power'));
  }

  /**
   * Returns the power target
   */
  getTargetPower() {
    return this.getCapabilityValue('target_power');
  }

  /**
   * Returns if we are within a charging cycle
   */
  getIsPlanned() {
    const currentMode = +this.getCapabilityValue('charge_mode');
    const allowPowerPlan = this.chargePlan.currentPlan[this.chargePlan.currentIndex] > 0;
    const allowPowerMode = currentMode !== c.MAIN_OP.ALWAYS_OFF;
    const forceOn = currentMode === c.MAIN_OP.ALWAYS_ON;

    const withinChargingCycle = (allowPowerMode && (+this.chargePlan.cycleRemaining > 0)) || forceOn;
    const withinChargingPlan = (allowPowerPlan && withinChargingCycle) || forceOn;
    return { withinChargingCycle, withinChargingPlan };
  }

  /**
   * Called by the app internally to changes the target power
   */
  async changePowerInternal(powerChange, now = new Date()) {
    const oldTarget = this.getTargetPower() || 0;
    let newTarget = oldTarget + powerChange;
    const phases = +(await this.getSetting('phases'));
    const voltage = +(await this.getSetting('voltage'));
    const maxCurrent = await this.getSetting('maxCurrent');
    const maxPower = maxCurrent * voltage * (phases === 3 ? 1.732 : 1);
    if (newTarget > maxPower) {
      newTarget = maxPower;
    }
    this.setCapabilityValue('target_power', newTarget);
    await this.setTargetPower(newTarget, powerChange)
      .catch((err) => {
        // If not confirmed, it's considered a success due to being blocked by toggle rate
        return Promise.resolve([(!this.confirmed && this.ongoing) || false, false]); // Try changing another device
      });
    const noChange = (powerChange === 0)
      || ((oldTarget >= maxPower) && (newTarget >= maxPower))
      || !this.getIsPlanned().withinChargingPlan;
    const success = true;
    return Promise.resolve([success, noChange]);
  }

}

module.exports = ChargeDevice;
