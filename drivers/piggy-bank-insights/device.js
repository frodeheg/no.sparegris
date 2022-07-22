'use strict';

const { Device } = require('homey');

const POLL_INTERVAL = 1000*60*1; // Poll the app once every minute

class MyDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('MyDevice has been initialized');
    this.intervalID = undefined;

    // Every minute check if the state has changed:
    this.intervalID = setInterval(() => {
      this.updateState()
    }, POLL_INTERVAL)
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('MyDevice has been added');
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
    this.log('MyDevice settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('MyDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('MyDevice has been deleted');
    // Make sure the interval is cleared if it was started, otherwise it will continue to
    // trigger but on an unknown device.
    if (this.intervalID != undefined) {
      clearInterval(this.intervalID)
      this.intervalID = undefined
    }
  }

  /**
   * Polls all the state from the app and updates the device
   */
  async updateState() {
    const piggy_state = this.homey.app.getState();
    //this.log("Updating state: " + JSON.stringify(piggy_state));
    if (piggy_state.power_last_hour !== undefined) {
      this.setCapabilityValue('meter_power.last_hour', piggy_state.power_last_hour);
    }
    if (piggy_state.power_estimated !== undefined) {
      this.setCapabilityValue('meter_power.estimated', piggy_state.power_estimated);
    }
    this.setCapabilityValue('alarm_generic.overshoot', piggy_state.alarm_overshoot);

    this.setCapabilityValue('measure_power.free_capacity', Math.round(piggy_state.free_capacity));
    var percentageOn = Math.round(100 * (piggy_state.num_devices - piggy_state.num_devices_off) / piggy_state.num_devices);
    percentageOn = (percentageOn < 0) ? 0 : (percentageOn > 100) ? 100 : percentageOn;
    this.setCapabilityValue('piggy_devices_on', percentageOn);

    // Set Price point capability + update timeline using boolean workaround capabilities
    var prev_price_point = await this.getStoreValue('piggy_price');
    this.setCapabilityValue('piggy_price', piggy_state.price_point);
    if (piggy_state.price_point !== prev_price_point) {
      this.setStoreValue('piggy_price', piggy_state.price_point);
      switch(piggy_state.price_point) {
        case "0": this.toggleCapability("piggy_price_low"); break;
        case "1": this.toggleCapability("piggy_price_normal"); break;
        case "2": this.toggleCapability("piggy_price_expensive"); break;
      }
    }

    // Set Mode capability + update timeline using boolean workaround capabilities
    var prev_mode = await this.getStoreValue('piggy_mode');
    this.setCapabilityValue('piggy_mode', piggy_state.operating_mode);
    if (piggy_state.operating_mode !== prev_mode) {
      this.setStoreValue('piggy_mode', piggy_state.operating_mode);
      switch(piggy_state.operating_mode) {
        case "0": this.toggleCapability("piggy_mode_disabled"); break;
        case "1": this.toggleCapability("piggy_mode_normal"); break;
        case "2": this.toggleCapability("piggy_mode_night"); break;
        case "3": this.toggleCapability("piggy_mode_holiday"); break;
        case "4": this.toggleCapability("piggy_mode_boost"); break;
      }
    }
  }

  /**
   * Used to overcome the fact that Homey does not support enums in the timeline
   * @param {*} capabilityName 
   */
  toggleCapability(capabilityName) {
    var capValue = this.getStoreValue(capabilityName);
    if (typeof capValue !== 'boolean') {
      capValue = false;
    }
    capValue = !capValue;
    this.setStoreValue(capabilityName, capValue);
    this.setCapabilityValue(capabilityName, capValue);
  }

}

module.exports = MyDevice;
