/* eslint-disable no-nested-ternary */

'use strict';

const { Device } = require('homey');

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
        image.setPath('../drivers/piggy-charger/assets/images/large.png');
        this.setCameraImage('front', 'Help image', image);
      })
      .catch(this.error);
    this.homey.images.createImage()
      .then((image) => {
        image.setPath('../assets/images/large.png');
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
