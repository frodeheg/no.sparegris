/* eslint-disable no-nested-ternary */

'use strict';

const { Device } = require('homey');
const Textify = require('../../lib/textify');

class MyDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.homey.app.updateLog('Piggy Charger has been initialized', 1);

    // Register maintainance action to validate the device
    this.registerCapabilityListener('button.validate', async () => {
      this.log('Validating charger');
      const settings = this.getSettings();
      if (settings['GotSignalAmps'] !== 'True') return Promise.reject(this.homey.__('charger.warnings.noSignalAmps'));
      if (settings['GotSignalWatt'] !== 'True') return Promise.reject(new Error(this.homey.__('charger.warnings.noSignalWatts')));
      if (settings['GotSignalBattery'] !== 'True') return Promise.reject(new Error(this.homey.__('charger.warnings.noSignalBattery')));
      if (settings['GotSignalStatusDisconnected'] !== 'True') return Promise.reject(new Error(this.homey.__('charger.warnings.noStatusDisconnected')));
      if (settings['GotSignalStatusConnected'] !== 'True') return Promise.reject(new Error(this.homey.__('charger.warnings.noStatusConnected')));
      // if (settings['GotSignalStatusDone'] !== 'True') return Promise.reject(new Error(this.homey.__('charger.warnings.noStatusDone')));
      // if (settings['GotSignalStatusError'] !== 'True') return Promise.reject(new Error(this.homey.__('charger.warnings.noStatusError')));
      return Promise.resolve();
    });

    this.homey.images.createImage()
      .then((image) => {
        image.setStream(async (stream) => {
          const dst = new Textify({ width: 500, height: 500, colorType: 2, bgColor: { red: 80, green: 80, blue: 80 }});
          const okText = '[\u001b[32;1m OK \u001b[37m]';
          const errText = '[\u001b[31;1mFAIL\u001b[37m]';
          return dst.loadFile('../drivers/piggy-charger/assets/images/notValid.png')
            .then(() => dst.setCursorWindow(190, 80, 460, 170))
            .then(() => dst.setTextColor([255, 128, 128, 255]))
            .then(() => dst.addText('The device can not be used\nbefore the check-list below\nhas been completed\n'))
            .then(() => dst.addText('-----------------------------'))
            .then(() => dst.setCursorWindow(40, 185, 460, 460))
            .then(() => dst.setTextColor([255, 255, 255, 255]))
            .then(() => dst.addText(`${errText} Connect xxxx\n`))
            .then(() => dst.addText(`${okText} device\n`))
            .then(() => dst.pack().pipe(stream));
        });
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
