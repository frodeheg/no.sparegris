/* eslint-disable no-nested-ternary */

'use strict';

const { Device } = require('homey');

const DEFAULT_POLL_INTERVAL = 60; // Number of seconds to poll data

class MyDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.homey.app.updateLog('MyDevice has been initialized', 1);
    this.intervalID = undefined;

    // Fetch poll interval and set up timer
    const settings = this.getSettings();
    this.setPollIntervalTime(settings['refreshRate']);
    this.intervalID = setTimeout(() => this.updateState(), this.__pollIntervalTime);
  }

  /**
   * Sets the poll interval time
   * @param newTime is in seconds
   */
  setPollIntervalTime(newTime) {
    let myTime = +newTime; // Convert to number in case it is not
    if (typeof myTime !== 'number' || myTime < 5 || myTime > 60) {
      this.homey.app.updateLog(`New poll time '${myTime}' was rejected`, 0);
      myTime = DEFAULT_POLL_INTERVAL;
    }
    this.homey.app.updateLog(`New poll time is: ${myTime}`, 1);
    this.__pollIntervalTime = myTime * 1000; // Change from seconds to ms
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.homey.app.updateLog('MyDevice has been added', 1);
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
    this.homey.app.updateLog(`MyDevice settings where changed: ${JSON.stringify(changedKeys)}`, 1);
    if (changedKeys.includes('refreshRate')) {
      this.setPollIntervalTime(newSettings['refreshRate']);
      // The new setting will be applied after next refresh
    }
    if (changedKeys.includes('debugCap')) {
      if (newSettings['debugCap'] === true) {
        if (this.hasCapability('piggy_num_failures') === false) {
          this.addCapability('piggy_num_failures');
        }
      } else if (newSettings['debugCap'] === false) {
        if (this.hasCapability('piggy_num_failures') === true) {
          this.removeCapability('piggy_num_failures');
        }
      }
    }
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.homey.app.updateLog('MyDevice was renamed', 1);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.homey.app.updateLog('MyDevice has been deleted', 1);
    // Make sure the interval is cleared if it was started, otherwise it will continue to
    // trigger but on an unknown device.
    if (this.intervalID !== undefined) {
      clearInterval(this.intervalID);
      this.intervalID = undefined;
    }
  }

  /**
   * Polls all the state from the app and updates the device
   */
  async updateState() {
    try {
      const piggyState = this.homey.app.getState();
      // this.homey.app.updateLog("Updating state: " + JSON.stringify(piggyState), 1);
      if (piggyState.power_last_hour !== undefined) {
        this.setCapabilityValue('meter_power.last_hour', piggyState.power_last_hour);
      }
      if (piggyState.power_estimated !== undefined) {
        this.setCapabilityValue('meter_power.estimated', piggyState.power_estimated);
      }
      this.setCapabilityValue('alarm_generic.overshoot', piggyState.alarm_overshoot);

      this.setCapabilityValue('measure_power.free_capacity', Math.round(piggyState.free_capacity));
      this.setCapabilityValue('measure_power.reserved_power', piggyState.safety_power);
      let percentageOn = Math.round((100 * (piggyState.num_devices - piggyState.num_devices_off)) / piggyState.num_devices);
      percentageOn = (percentageOn < 0) ? 0 : (percentageOn > 100) ? 100 : percentageOn;
      this.setCapabilityValue('piggy_devices_on', percentageOn);

      // Set Price point capability + update timeline using boolean workaround capabilities
      const prevPricePoint = await this.getStoreValue('piggy_price');
      this.setCapabilityValue('piggy_price', piggyState.price_point);
      if (piggyState.price_point !== prevPricePoint) {
        this.setStoreValue('piggy_price', piggyState.price_point);
        switch (piggyState.price_point) {
          case '0': this.toggleCapability('piggy_price_low'); break;
          case '1': this.toggleCapability('piggy_price_normal'); break;
          case '2': this.toggleCapability('piggy_price_expensive'); break;
          default: /* Broken input should not happen */ break;
        }
      }

      // Set Mode capability + update timeline using boolean workaround capabilities
      const prevMode = await this.getStoreValue('piggy_mode');
      this.setCapabilityValue('piggy_mode', piggyState.operating_mode);
      if (piggyState.operating_mode !== prevMode) {
        this.setStoreValue('piggy_mode', piggyState.operating_mode);
        switch (piggyState.operating_mode) {
          case '0': this.toggleCapability('piggy_mode_disabled'); break;
          case '1': this.toggleCapability('piggy_mode_normal'); break;
          case '2': this.toggleCapability('piggy_mode_night'); break;
          case '3': this.toggleCapability('piggy_mode_holiday'); break;
          case '4': this.toggleCapability('piggy_mode_custom'); break;
          default: /* Broken input should not happen */ break;
        }
      }

      // Debug capabilities, so only update if they exist
      if (this.hasCapability('piggy_num_failures') === true) {
        this.setCapabilityValue('piggy_num_failures', piggyState.num_fail_on + piggyState.num_fail_off + piggyState.num_fail_temp);
      }

      // Other things to report:
      // * 4: Average power used in every mode
      // * 3: Average power used in every price pointupdateupdate
      //      low_energy_energy_avg
      //      norm_energy_energy_avg
      //      high_energy_energy_avg
      // * 3: Average price per price point
      // * 1: Average power moved to lower price points
      // * 1: Money spent by moving between price points
    } finally {
      this.intervalID = setTimeout(() => this.updateState(), this.__pollIntervalTime);
    }
  }

  /**
   * Used to overcome the fact that Homey does not support enums in the timeline
   * @param {*} capabilityName
   */
  toggleCapability(capabilityName) {
    let capValue = this.getStoreValue(capabilityName);
    if (typeof capValue !== 'boolean') {
      capValue = false;
    }
    capValue = !capValue;
    this.setStoreValue(capabilityName, capValue);
    this.setCapabilityValue(capabilityName, capValue);
  }

}

module.exports = MyDevice;
