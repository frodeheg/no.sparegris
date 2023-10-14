/* eslint-disable import/no-dynamic-require */
/* eslint-disable no-nested-ternary */

'use strict';

// eslint-disable-next-line no-undef
const homeypath = ('testing' in global && testing) ? '../../testing/' : '';
const { Device } = require(`${homeypath}homey`);
const { Mutex } = require('async-mutex');
const { TIMESPAN, toLocalTime, timeDiff } = require('../../common/homeytime');
const c = require('../../common/constants');
const d = require('../../common/devices');
const Textify = require('../../lib/textify');

// Driver Manifest references
const VALIDATION_SETTINGS = 2;
const STATUS_GOTWATT = 0;
const STATUS_GOTBATTERY = 1;
const STATUS_GOTCANCHARGE = 2;
const STATUS_GOTCANTCHARGE = 3;
const STATUS_GOTERROR = 4;

// States
const STATE_FULL_CHARGE = 0;
const STATE_PARTIAL_CHARGE = 1;
const STATE_CANT_CHARGE = 2;
const STATE_ERROR = 3;

// Default text
const okText = '[\u001b[32;1m OK \u001b[37m]';
const errText = '[\u001b[31;1mFAIL\u001b[37m]';
const progressText = '[\u001b[37;0m....\u001b[37;1m]';

class ChargeDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.homey.app.updateLog('Charger init', c.LOG_INFO);
    this.homey.app.updateLog('Piggy Charger has been initialized', 1);
    this.settingsManifest = this.driver.manifest.settings[VALIDATION_SETTINGS].children;
    this.killed = false;

    // Make short access to device data
    const data = this.getData();
    this.targetDriver = data.targetDriver;
    if (this.targetDriver) {
      console.log(`Controller will use direct access for ${this.targetDriver} (Device ID: ${data.id})`);
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
      return Promise.resolve();
    });

    // Register current charging setting
    this.cycleStart = this.getStoreValue('cycleStart');
    this.cycleStart = this.cycleStart ? new Date(this.cycleStart) : undefined;
    this.cycleEnd = this.getStoreValue('cycleEnd');
    this.cycleEnd = this.cycleEnd ? new Date(this.cycleEnd) : undefined;
    this.cycleType = this.getStoreValue('cycleType');
    this.cycleRemaining = +this.getStoreValue('cycleRemaining');
    this.mutexForPower = new Mutex();
    this.__spookey_check_activated = undefined;
    this.__spookey_changes = 0;
    this.__offeredEnergy = 0;
    this.__charge_plan = [];
    this.limited = false;
    await this.rescheduleCharging(false);

    // Link on-off button with the "controllable-device" setting in piggy
    this.registerCapabilityListener('onoff', async (newVal) => {
      const deviceId = this.getId();
      this.log(`Changing onOff state to ${newVal} for Charger: ${deviceId}`);
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
      let __deviceList = this.homey.settings.get('deviceList') || {};
      if (__deviceList === null || !(deviceId in __deviceList)) {
        __deviceList = await this.homey.app.createDeviceList();
      }
      __deviceList[deviceId].use = newVal;
      this.homey.app.__deviceList = __deviceList;
      this.homey.settings.set('deviceList', __deviceList);
      // If a device is attached, make sure the add and remove commands are run
      if (newVal) {
        return this.onTurnedOn();
      }
      return this.onTurnedOff();
    });

    // Link target-power with the piggy control (note, this cap is hidden for everyone else)
    this.registerCapabilityListener('target_power', async (newPow) => {
      return this.setTargetPower(newPow);
    });

    await this.homey.images.createImage()
      .then((image) => {
        image.setStream((stream) => this.refreshImageStream(stream));
        return image.update()
          .then(() => this.setCameraImage('front', 'Help image', image));
      })
      .catch((err) => {
        this.homey.app.updateLog(`Camera image1 failed ${err}`, c.LOG_ERROR);
      });
    await this.homey.images.createImage()
      .then((image) => {
        image.setPath('../assets/images/Codepage-437.png');
        return image.update()
          .then(() => this.setCameraImage('help', 'Help image 2', image));
      })
      .catch((err) => {
        this.homey.app.updateLog(`Camera image2 failed ${err}`, c.LOG_ERROR);
      });

    this.homey.app.updateLog('charger init done....', c.LOG_INFO);
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
      if (changed) this.setSettings(newSetting);
    }
  }

  async onUninit() {
    this.homey.app.updateLog('piggy-charger onUninit', c.LOG_INFO);
    this.killed = true;
    if (this.triggerThread) {
      clearTimeout(this.triggerThread);
      this.triggerThread = undefined;
    }
    if (this.getCapabilityValue('onoff')) {
      this.onTurnedOff();
      this.setCapabilityValue('onoff', false);
    }
    if (this.__powerProcessID !== undefined) {
      clearTimeout(this.__powerProcessID);
      this.__powerProcessID = undefined;
    }
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
        if (settingToUpdate !== undefined) this.updateSettingsIfValidationCycle(settingToUpdate, 'True');
        return Promise.resolve(+state);
      });
  }

  /**
   * Sets the charger power
   */
  async setChargerPower(power, fromFlow = true) {
    return this.rejectSetterIfRedundant(fromFlow, 'measurePowerCap')
      .then(() => {
        this.setCapabilityValue('measure_power', +power);
        this.updateSettingsIfValidationCycle('GotSignalWatt', 'True');
        return Promise.resolve(+power);
      });
  }

  /**
   * Sets the target power (called internally when the target power capability changes)
   */
  async setTargetPower(power) {
    // Report power to device trigger
    const changeChargingPowerTrigger = this.homey.flow.getDeviceTriggerCard('charger-change-target-power');
    const tokens = { offeredPower: +power };
    changeChargingPowerTrigger.trigger(this, tokens);
    return Promise.resolve(+power);
  }

  /**
   * Sets the battery level
   */
  async setBatteryLevel(batteryLevel, fromFlow = true) {
    return this.rejectSetterIfRedundant(fromFlow, 'getBatteryCap')
      .then(() => {
        this.setCapabilityValue('measure_battery', +batteryLevel);
        this.updateSettingsIfValidationCycle('GotSignalBattery', 'True');
        return Promise.resolve(+batteryLevel);
      });
  }

  /**
   * Creates a image that can be sent to the device image stream
   */
  async refreshImageStream(stream) {
    const dst = new Textify({ width: 500, height: 500, colorType: 2, bgColor: { red: 80, green: 80, blue: 80 }});

    this.settings = this.getSettings();
    return dst.loadFile('../drivers/piggy-charger/assets/images/notValid.png')
      .then(() => dst.setCursorWindow(190, 80, 460, 170))
      .then(() => dst.setTextColor([255, 128, 128, 255]))
      .then(() => dst.addText(this.homey.__('charger.validation.heading')))
      .then(() => dst.addText('-----------------------------'))
      .then(() => dst.setCursorWindow(40, 185, 460, 460))
      .then(() => dst.setTextColor([255, 255, 255, 255]))
      .then(() => this.runStateTest(dst))
      .then(() => this.runBatteryTest(dst))
      .then(() => this.runWattTest(dst))
      .then(() => this.runTriggerTest(dst))
      .then(() => this.runTurnedOnTest(dst))
      .then(() => this.setAllPassed())
      .catch((err) => {
        this.setCapabilityValue('alarm_generic.notValidated', true);
        if (err) return dst.addText(`\u001b[35;m${err.message}\n`);
        return dst.addText(`${progressText} ${this.homey.__('charger.validation.wait')}\n`);
      })
      .finally(() => dst.addText(`\u001b[0m(${this.homey.__('charger.validation.reset')})\u001b[1m\n`))
      .then(() => dst.pack().pipe(stream));
  }

  /**
   * The test procedure is as follows:
   * 1) Check that a car is connected (requires the user to have updated the flow)
   */
  async runTest(dst, settingId, value) {
    const text = this.settingsManifest[settingId];
    if (value !== 'True') {
      dst.addText(`${errText} ${this.homey.__(text.label)}\n`);
      return Promise.reject(new Error(`${this.homey.__(text.hint)}\n`));
    }
    dst.addText(`${okText} ${this.homey.__(text.label)}\n`);
    return Promise.resolve();
  }

  /**
   * This test will just check that the charger state has been sent to the device
   */
  async runStateTest(dst) {
    return this.getState()
      .then((state) => {
        if (state === null || state === undefined) {
          dst.addText(`${errText} ${this.homey.__('charger.validation.stateLabel')}\n`);
          return Promise.reject(new Error(`${this.homey.__('charger.validation.stateHint')}`));
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
    return this.runTest(dst, STATUS_GOTBATTERY, this.settings.GotSignalBattery);
  }

  async runWattTest(dst) {
    return this.getPower() // If watt is not present, tries to fetch from a connected device
      .then(() => this.runTest(dst, STATUS_GOTWATT, this.settings.GotSignalWatt));
  }

  /**
   * Wait for trigger replay
   */
  async checkForTriggerReply(secleft, testStarted) {
    if (this.killed) return Promise.resolve();
    console.log(`Sec left ${secleft}`);
    const newPower = this.getCapabilityValue('measure_power');
    if ((!testStarted) && (+newPower === 0)) {
      console.log(`Starting Trigger test at time ${secleft}`);
      const changeChargingPowerTrigger = this.homey.flow.getDeviceTriggerCard('charger-change-target-power');
      const tokens = { offeredPower: 2000 };
      changeChargingPowerTrigger.trigger(this, tokens);
      this.triggerTestStart = new Date();
      testStarted = true;
    } else if (testStarted && (+newPower > 0)) {
      const now = new Date();
      const lastedTime = Math.round((now - this.triggerTestStart) / 1000);
      const settings = { toggleMeasureW: `${lastedTime} s` };
      this.setSettings(settings);
      console.log(`Ended Trigger test at time ${secleft}, got Power ${newPower}`);
      this.triggerThread = undefined;
      return this.onTurnedOff();
    }
    if (secleft > 0) {
      this.triggerThread = setTimeout(() => this.checkForTriggerReply(secleft - 1, testStarted), 1000);
    } else {
      this.triggerThread = undefined;
    }
    return Promise.resolve();
  }

  /**
   * This test will check if a trigger event has been created.
   */
  async runTriggerTest(dst) {
    const now = new Date();
    const gotResult = this.settings.toggleMeasureW !== '-';
    console.log('Run trigger test');
    console.log(this.settings.toggleMeasureW);

    if (gotResult) {
      dst.addText(`${okText} ${this.homey.__('charger.validation.turnaroundLabel')} (${this.settings.toggleMeasureW})\n`);
      console.log('has result....');
      return Promise.resolve();
    }
    if (!this.triggerThreadStart) {
      console.log('Started new trigger test');
      await this.onTurnedOn();
      this.triggerThreadStart = now;
      this.triggerThread = setTimeout(() => this.checkForTriggerReply(300, false), 1000);
    }

    const secLasted = Math.round((now - this.triggerThreadStart) / 1000);
    if (secLasted > 60 * 5) {
      dst.addText(`${errText} ${this.homey.__('charger.validation.turnaroundLabel')} (${this.homey.__('charger.validation.turnaroundTimeout')} > 300 s)\n`);
      this.triggerThreadStart = undefined;
      console.log('Test timed out');
      return Promise.reject();
    }
    dst.addText(`${progressText} ${this.homey.__('charger.validation.turnaroundLabel')} (${this.homey.__('charger.validation.turnaroundOngoing')} > ${secLasted} s)\n`);
    console.log('waiting....');
    return Promise.reject();
  }

  /**
   * Check that the device is turned on
   */
  async runTurnedOnTest(dst) {
    const text = this.homey.__('charger.validation.turnedOnLabel');
    const onOffValue = this.getCapabilityValue('onoff');
    if (!onOffValue) {
      dst.addText(`${errText} ${text}\n`);
      return Promise.reject(new Error(`${this.homey.__('charger.validation.turnedOnHint')}`));
    }
    dst.addText(`${okText} ${text}\n`);
    return Promise.resolve();
  }

  /**
   * Mark the device that all tests passed
   */
  async setAllPassed() {
    this.setCapabilityValue('alarm_generic.notValidated', false);
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.homey.app.updateLog('Piggy charger has been added', 1);
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
    this.homey.app.updateLog(`Piggy charger settings where changed: ${JSON.stringify(changedKeys)}`, 1);
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
    this.cycleRemaining = offerEnergy ? (offerEnergy * 1000) : +offerHours;
    this.cycleType = offerEnergy ? c.OFFER_ENERGY : c.OFFER_HOURS;
    this.cycleStart = now;
    this.cycleEnd = endTimeUTC;
    this.setStoreValue('cycleStart', this.cycleStart);
    this.setStoreValue('cycleEnd', this.cycleEnd);
    this.setStoreValue('cycleType', this.cycleType);
    this.setStoreValue('cycleRemaining', this.cycleRemaining);

    await this.rescheduleCharging(false, now);

    // Start the onProcessPower timer if it is not active
    if (this.__powerProcessID === undefined) {
      this.__powerProcessID = setTimeout(() => this.onProcessPowerWrapper(), 1000 * 10);
    }

    return Promise.resolve();
  }

  /**
   * Only called when stopping the charging cycle ahead of time
   */
  async onChargingCycleStop() {
    this.updateLog('Charging cycle abruptly ended', c.LOG_INFO);
    if (this.cycleEnd > new Date()) {
      this.cycleRemaining = 0;
      this.setStoreValue('cycleRemaining', this.cycleRemaining);
      this.rescheduleCharging(false);
    } else {
      this.__charge_plan = [];
      throw new Error('No charging cycle could be stopped');
    }
  }

  /**
   * Called every hour to make sure the Charging is rescheduled most optimal.
   * Whenever a new hour passes, must be called _after_ doPriceCalculations to get correct current_price_index
   */
  async rescheduleCharging(isNewHour, now = new Date()) {
    if (isNewHour) {
      const oldRemaining = this.cycleRemaining;
      if (this.cycleType === c.OFFER_ENERGY) {
        this.cycleRemaining -= this.__offeredEnergy;
        this.__offeredEnergy = 0;
      } else if (this.__charge_plan[0] > 0) {
        // OFFER_HOURS - Only subtract for active hours
        this.cycleRemaining -= 1;
      }
      if (this.cycleRemaining < 0) this.cycleRemaining = 0;
      if (oldRemaining !== 0) {
        this.setStoreValue('cycleRemaining', this.cycleRemaining);
      }
    }

    // Reset charge plan
    this.__charge_plan = [];

    // Ignore rescheduling if there is nothing left to schedule
    if (this.cycleRemaining === 0) return Promise.resolve();

    // Calculate new charging plan
    const end = new Date(this.cycleEnd);
    const priceArray = this.homey.app.getPricePrediction(now, end);
    const maxLimits = this.homey.app.readMaxPower();
    const maxPower = Math.min(+maxLimits[TIMESPAN.QUARTER] * 4, +maxLimits[TIMESPAN.HOUR]);
    const priceSorted = Array.from(priceArray.keys()).sort((a, b) => ((priceArray[a] === priceArray[b]) ? (a - b) : (priceArray[a] - priceArray[b])));
    let scheduleRemaining = this.cycleRemaining;
    for (let i = 0; (i < priceSorted.length) && (scheduleRemaining > 0); i++) {
      const idx = priceSorted[i];
      const estimatedPower = maxPower * 0.75; // Assume 75% available to the charger TODO: replace with historic average
      this.__charge_plan[idx] = estimatedPower;
      scheduleRemaining -= this.cycleType === c.OFFER_ENERGY ? estimatedPower : 1;
    }
    return Promise.resolve();
  }

  /**
   * A wrapper function for whenever the safeguard is run
   */
  async onProcessPowerWrapper() {
    return this.mutexForPower.runExclusive(async () => this.onProcessPower())
      .finally(() => {
        // Schedule new event if and only if charging is active
        if (this.cycleRemaining > 0) {
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
    console.log('Processing power....');
    // 1) Update charger state for non-flow devices
    if (this.targetDriver) {
      await this.getState();
      // Check for power capability
      if (this.targetDef.measurePowerCap) {
        await this.getCapValue(this.targetDef.measurePowerCap)
          .then((targetPower) => this.setChargerPower(targetPower, false));
      }
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
    const withinChargingPlan = (this.__charge_plan[0] > 0) && withinChargingCycle;
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
    return Promise.resolve(this.getCapabilityValue('charge_status'));
  }

  /**
   * Returns power from power cap
   * If it's a non-flow device then the power cap is updated first with the value from the charger
   */
  async getPower() {
    if (this.targetDriver && this.targetDef.measurePowerCap !== null) {
      return this.getCapValue(this.targetDef.measurePowerCap)
        .then((targetPower) => this.setChargerPower(targetPower, false));
    }
    return Promise.resolve(this.getCapabilityValue('measure_power'));
  }

  /**
   * Changes the power
   */
  async changePower(powerChange, now = new Date()) {
    console.log(`Got Changepower ${powerChange}`);
  }

}

module.exports = ChargeDevice;
