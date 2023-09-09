/* eslint-disable no-nested-ternary */

'use strict';

const { Device } = require('homey');
const Textify = require('../../lib/textify');

// Driver Manifest references
const VALIDATION_SETTINGS = 2;
const STATUS_GOTAMP = 0;
const STATUS_GOTWATT = 1;
const STATUS_GOTBATTERY = 2;
const STATUS_GOTDISCONNECT = 3;
const STATUS_GOTCONNECT = 4;
const STATUS_GOTDONE = 5;
const STATUS_GOTERROR = 6;

// Default text
const okText = '[\u001b[32;1m OK \u001b[37m]';
const errText = '[\u001b[31;1mFAIL\u001b[37m]';
const progressText = '[\u001b[37;0m....\u001b[37;1m]';

class MyDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    console.log('Charger init');
    this.homey.app.updateLog('Piggy Charger has been initialized', 1);
    this.settingsManifest = this.driver.manifest.settings[VALIDATION_SETTINGS].children;

    // Reset device setting if it's the first time the device is started
    if (!this.getStoreValue('firstInitDone')) {
      await this.setCapabilityValue('onoff', false);
      await this.setCapabilityValue('alarm_generic.notValidated', true);
      await this.setStoreValue('firstInitDone', true);
    }

    // Register maintainance action used for validation of the device
    this.registerCapabilityListener('button.reset', async () => {
      this.log('Reset charger state in order to re-validate it');
      const settings = await this.getSettings();
      settings.GotSignalAmps = 'False';
      settings.GotSignalWatt = 'False';
      settings.GotSignalBattery = 'False';
      settings.GotSignalStatusDisconnected = 'False';
      settings.GotSignalStatusConnected = 'False';
      settings.GotSignalStatusDone = 'False';
      settings.GotSignalStatusError = 'False';
      this.setSettings(settings);
      this.setCapabilityValue('onoff', false);
      this.setCapabilityValue('alarm_generic.notValidated', true);
      return Promise.resolve();
    });

    // Link on-off button with the "controllable-device" setting in piggy
    this.registerCapabilityListener('onoff', async (newVal) => {
      const deviceId = this.getId();
      this.log(`Changing onOff state to ${newVal} for Charger: ${deviceId}`);
      if (newVal) {
        // Check if the device can be turned on
        const settings = this.getSettings();
        if (settings.GotSignalAmps === 'False'
          || settings.GotSignalWatt === 'False'
          || settings.GotSignalBattery === 'False'
          || settings.GotSignalStatusDisconnected === 'False'
          || settings.GotSignalStatusConnected === 'False'
          || settings.GotSignalStatusDone === 'False'
          || settings.GotSignalStatusError === 'False') {
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
      return Promise.resolve();
    });

    await this.homey.images.createImage()
      .then((image) => {
        image.setStream((stream) => this.refreshImageStream(stream));
        return image.update()
          .then(() => this.setCameraImage('front', 'Help image', image));
      })
      .catch((err) => {
        console.log(`Camera image1 failed ${err}`);
      });
    await this.homey.images.createImage()
      .then((image) => {
        image.setPath('../assets/images/Codepage-437.png');
        return image.update()
          .then(() => this.setCameraImage('help', 'Help image 2', image));
      })
      .catch((err) => {
        console.log(`Camera image2 failed ${err}`);
      });
    console.log('charger init done....');
  }

  /**
   * Update a setting when within a validation cycle only
   */
  async updateSettingsIfValidationCycle(setting, newVal) {
    if (this.getCapabilityValue('alarm_generic.notValidated') === true) {
      const settings = this.getSettings();
      const changed = settings[setting] !== newVal;
      settings[setting] = newVal;
      if (changed) this.setSettings(settings);
    }
  }

  /**
   * Set the charger state
   */
  async setChargerState(state) {
    this.setCapabilityValue('charge_status', String(state));
    let settingToUpdate;
    switch (+state) {
      case 0: settingToUpdate = 'GotSignalStatusDisconnected'; break; // Car disconnected
      case 1: settingToUpdate = 'GotSignalStatusConnected'; break; // Car connected
      case 2: console.log('TODO: Register state charging'); break; // Charging
      case 3: console.log('TODO: Register state paused'); break; // Paused charging
      case 4: settingToUpdate = 'GotSignalStatusDone'; break; // Charging completed
      default:
      case 5: settingToUpdate = 'GotSignalStatusError'; break; // Charging failed
    }
    if (settingToUpdate !== undefined) this.updateSettingsIfValidationCycle(settingToUpdate);
  }

  /**
   * Sets the charger power
   */
  async setChargerPower(power) {
    this.setCapabilityValue('measure_power', +power);
    this.updateSettingsIfValidationCycle('GotSignalWatt', 'True');
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
      .then(() => dst.addText('The device can not be used\nbefore the check-list below\nhas been completed\n'))
      .then(() => dst.addText('-----------------------------'))
      .then(() => dst.setCursorWindow(40, 185, 460, 460))
      .then(() => dst.setTextColor([255, 255, 255, 255]))
      .then(() => this.runConnectedTest(dst))
      .then(() => this.runAmpTest(dst))
      .then(() => this.runWattTest(dst))
      .then(() => this.runBatteryTest(dst))
      .then(() => this.runDisconnectTest(dst))
      .then(() => this.runTurnedOnTest(dst))
      .then(() => this.setAllPassed())
      .then(() => dst.addText(`${progressText} Press refresh for updates\n`))
      .catch((err) => dst.addText(`\u001b[35;m${err.message}\n`))
      .then(() => this.setCapabilityValue('alarm_generic.notValidated', true))
      .finally(() => dst.addText('\u001b[0m(maintenance action "reset" will start over)\u001b[1m\n'))
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
   * This test will just check that the charger is within connected state
   */
  async runConnectedTest(dst) {
    return this.runTest(dst, STATUS_GOTCONNECT, this.settings.GotSignalStatusConnected);
  }

  async runAmpTest(dst) {
    return this.runTest(dst, STATUS_GOTAMP, this.settings.GotSignalAmps);
  }

  async runWattTest(dst) {
    return this.runTest(dst, STATUS_GOTWATT, this.settings.GotSignalWatt);
  }

  async runBatteryTest(dst) {
    return this.runTest(dst, STATUS_GOTBATTERY, this.settings.GotSignalBattery);
  }

  async runDisconnectTest(dst) {
    return this.runTest(dst, STATUS_GOTDISCONNECT, this.settings.GotSignalStatusDisconnected);
  }

  /**
   * Check that the device is turned on
   */
  async runTurnedOnTest(dst) {
    const text = this.homey.__('charger.status.turnedOn');
    const onOffValue = this.getCapabilityValue('onoff');
    if (!onOffValue) {
      dst.addText(`${errText} ${text}\n`);
      return Promise.reject(new Error(`${this.homey.__('charger.tasks.turnOn')}`));
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
    console.log('Start charging cycle xxx');
    /*if ((typeof (endTime) !== 'string') || (!endTime.includes(':'))) {
      return Promise.reject(new Error(this.homey.__('warnings.notValidTime')));
    }
    const hoursEnd = +endTime.split(':').at(0);
    const minutesEnd = +endTime.split(':').at(1);
    if (hoursEnd < 0 || hoursEnd > 23 || Number.isNaN(hoursEnd)
      || minutesEnd < 0 || minutesEnd > 59 || Number.isNaN(minutesEnd)) {
      return Promise.reject(new Error(this.homey.__('warnings.notValidTime')));
    }

    this.updateLog('Charging cycle started', c.LOG_INFO);
    this.__spookey_check_activated = undefined;
    this.__spookey_changes = 0;
    const chargerOptions = this.homey.settings.get('chargerOptions');
    if (chargerOptions) {
      // Convert local end time to UTC
      const nowLocal = toLocalTime(now, this.homey);
      const minutesDiff = timeDiff(nowLocal.getHours(), nowLocal.getMinutes(), hoursEnd, minutesEnd);
      const endTimeUTC = new Date(now.getTime());
      endTimeUTC.setUTCMinutes(endTimeUTC.getUTCMinutes() + minutesDiff, 0, 0);
      chargerOptions.chargeRemaining = offerEnergy ? (offerEnergy * 1000) : +offerHours;
      chargerOptions.chargeCycleType = offerEnergy ? c.OFFER_ENERGY : c.OFFER_HOURS;
      chargerOptions.chargeEnd = endTimeUTC;
      this.homey.settings.set('chargerOptions', chargerOptions);
    }
    await this.rescheduleCharging(false, now);
    return Promise.resolve();*/
  }

  /**
   * Only called when stopping the charging cycle ahead of time
   */
  async onChargingCycleStop() {
    console.log('Stop charging cycle xxx');
    /*this.updateLog('Charging cycle abruptly ended', c.LOG_INFO);
    const chargerOptions = this.homey.settings.get('chargerOptions');
    if (chargerOptions) {
      chargerOptions.chargeRemaining = 0;
      this.homey.settings.set('chargerOptions', chargerOptions);
      this.rescheduleCharging(false);
    } else {
      this.__charge_plan = [];
      throw new Error('No charging cycle was to stop');
    }*/
  }

}

module.exports = MyDevice;
