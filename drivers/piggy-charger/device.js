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
    this.homey.app.updateLog('Piggy Charger has been initialized', 1);
    this.settingsManifest = this.driver.manifest.settings[VALIDATION_SETTINGS].children;

    // Register maintainance action used for validation of the device
    this.registerCapabilityListener('button.reset', async () => {
      this.log('Reset charger state in order to re-validate it');
      const settings = this.getSettings();
      settings.GotSignalAmps = 'False';
      settings.GotSignalWatt = 'False';
      settings.GotSignalBattery = 'False';
      settings.GotSignalStatusDisconnected = 'False';
      settings.GotSignalStatusConnected = 'False';
      settings.GotSignalStatusDone = 'False';
      settings.GotSignalStatusError = 'False';
      this.setSettings(settings);
      this.setCapabilityValue('onoff', false);
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

    this.homey.images.createImage()
      .then((image) => {
        image.setStream((stream) => this.refreshImageStream(stream));
        this.setCameraImage('front', 'Help image', image);
      })
      .catch(this.error);
    this.homey.images.createImage()
      .then((image) => {
        image.setPath('../assets/images/Codepage-437.png');
        this.setCameraImage('help', 'Help image 2', image);
      })
      .catch(this.error);
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
      .then(() => dst.addText(`${progressText} Press refresh for updates\n`))
      .catch((err) => dst.addText(`\u001b[35;m${err.message}\n`))
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

}

module.exports = MyDevice;
