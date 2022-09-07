/* eslint-disable no-nested-ternary */

'use strict';

const { Device } = require('homey');
const c = require('../../common/constants');

const DEFAULT_POLL_INTERVAL = 60; // Number of seconds to poll data

class MyDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.intervalID = undefined;

    // Fetch poll interval and set up timer
    const settings = this.getSettings();
    this.setPollIntervalTime(settings['refreshRate']);
    this.updateState();
    // this.deviceId = await this.getDeviceId();
    this.updateCapabilities(settings);
    this.homey.app.updateLog('MyDevice has been initialized', 1);
  }

  /**
   * Incredible complicated function to get the DeviceId.
   * There has to be a simpler way????
   */
  /* async getDeviceId() {
    const deviceInternalId = this.getData().id;
    const deviceDriverId = this.driver.id;
    const deviceAppId = this.homey.app.id;
    // Find deviceId
    const allDevices = await this.homey.app.homeyApi.devices.getDevices();
    return new Promise(resolve => {
      // eslint-disable-next-line no-restricted-syntax
      for (const devId in allDevices) {
        if (allDevices[devId].data.id === deviceInternalId
          && allDevices[devId].driverUri === `homey:app:${deviceAppId}`
          && allDevices[devId].driverId === deviceDriverId) {
          resolve(allDevices[devId].id);
        }
      }
      resolve(undefined);
    });
  } */

  /**
   * Update which capabilities to show
   */
  updateCapabilities(settings) {
    // New normal capabilities in version 0.5.15
    if (this.hasCapability('meter_power.last_day') === false) {
      this.addCapability('meter_power.last_day');
    }
    if (this.hasCapability('meter_power.last_month') === false) {
      this.addCapability('meter_power.last_month');
    }
    if (this.hasCapability('meter_power.month_estimate') === false) {
      this.addCapability('meter_power.month_estimate');
    }

    // Removed capabilities in version 0.8.3
    if (this.hasCapability('piggy_money.acceptable_price') === true) {
      this.removeCapability('piggy_money.acceptable_price');
    }

    // Added capabilities in version 0.8.15
    if (this.hasCapability('piggy_price_extreme') === false) {
      this.addCapability('piggy_price_extreme');
    }
    // === Athom seem to have disabled permission for apps to delete logs even for their own devices ===
    // if (this.homey.app.homeyApi.insights.getLog({ uri: `homey:device:${this.deviceId}`, id: 'piggy_money.acceptable_price' })) {
    //   this.homey.app.homeyApi.insights.deleteLog({ uri: `homey:device:${this.deviceId}`, id: 'piggy_money.acceptable_price' });
    // }

    // New experimental capabilities
    if (settings['experimentalCap'] === true) {
      if (this.hasCapability('piggy_money.savings_all_time_use') === false) {
        this.addCapability('piggy_money.savings_all_time_use');
      }
      if (this.hasCapability('piggy_money.savings_all_time_power_part') === false) {
        this.addCapability('piggy_money.savings_all_time_power_part');
      }
      if (this.hasCapability('piggy_money.savings_all_time_total') === false) {
        this.addCapability('piggy_money.savings_all_time_total');
      }
    } else if (settings['experimentalCap'] === false) {
      if (this.hasCapability('piggy_money.savings_all_time_use') === true) {
        this.removeCapability('piggy_money.savings_all_time_use');
      }
      if (this.hasCapability('piggy_money.savings_all_time_power_part') === true) {
        this.removeCapability('piggy_money.savings_all_time_power_part');
      }
      if (this.hasCapability('piggy_money.savings_all_time_total') === true) {
        this.removeCapability('piggy_money.savings_all_time_total');
      }
    }

    // New extended capabilities
    if (settings['extendedCap'] === true) {
      if (this.hasCapability('meter_power.low_energy_avg') === false) {
        this.addCapability('meter_power.low_energy_avg');
      }
      if (this.hasCapability('meter_power.norm_energy_avg') === false) {
        this.addCapability('meter_power.norm_energy_avg');
      }
      if (this.hasCapability('meter_power.high_energy_avg') === false) {
        this.addCapability('meter_power.high_energy_avg');
      }
      if (this.hasCapability('meter_power.extreme_energy_avg') === false) {
        this.addCapability('meter_power.extreme_energy_avg');
      }
      if (this.hasCapability('piggy_money.average_price') === false) {
        this.addCapability('piggy_money.average_price');
      }
      if (this.hasCapability('piggy_money.current_price') === false) {
        this.addCapability('piggy_money.current_price');
      }
      if (this.hasCapability('piggy_money.low_price_limit') === false) {
        this.addCapability('piggy_money.low_price_limit');
      }
      if (this.hasCapability('piggy_money.high_price_limit') === false) {
        this.addCapability('piggy_money.high_price_limit');
      }
      if (this.hasCapability('piggy_money.extreme_price_limit') === false) {
        this.addCapability('piggy_money.extreme_price_limit');
      }
    } else if (settings['extendedCap'] === false) {
      if (this.hasCapability('meter_power.low_energy_avg') === true) {
        this.removeCapability('meter_power.low_energy_avg');
      }
      if (this.hasCapability('meter_power.norm_energy_avg') === true) {
        this.removeCapability('meter_power.norm_energy_avg');
      }
      if (this.hasCapability('meter_power.high_energy_avg') === true) {
        this.removeCapability('meter_power.high_energy_avg');
      }
      if (this.hasCapability('meter_power.extreme_energy_avg') === true) {
        this.removeCapability('meter_power.extreme_energy_avg');
      }
      if (this.hasCapability('piggy_money.average_price') === true) {
        this.removeCapability('piggy_money.average_price');
      }
      if (this.hasCapability('piggy_money.current_price') === true) {
        this.removeCapability('piggy_money.current_price');
      }
      if (this.hasCapability('piggy_money.low_price_limit') === true) {
        this.removeCapability('piggy_money.low_price_limit');
      }
      if (this.hasCapability('piggy_money.high_price_limit') === true) {
        this.removeCapability('piggy_money.high_price_limit');
      }
      if (this.hasCapability('piggy_money.extreme_price_limit') === true) {
        this.removeCapability('piggy_money.extreme_price_limit');
      }
    }

    // New debug capabilities
    if (settings['debugCap'] === true) {
      if (this.hasCapability('piggy_num_failures') === false) {
        this.addCapability('piggy_num_failures');
      }
      if (this.hasCapability('piggy_num_restarts') === false) {
        this.addCapability('piggy_num_restarts');
      }
      if (this.hasCapability('button.reset_stats') === false) {
        this.addCapability('button.reset_stats');
      }
      this.registerCapabilityListener('button.reset_stats', async () => this.homey.app.resetStatistics());
    } else if (settings['debugCap'] === false) {
      if (this.hasCapability('piggy_num_failures') === true) {
        this.removeCapability('piggy_num_failures');
      }
      if (this.hasCapability('piggy_num_restarts') === true) {
        this.removeCapability('piggy_num_restarts');
      }
      if (this.hasCapability('button.reset_stats') === true) {
        this.removeCapability('button.reset_stats');
      }
    }
  }

  /**
   * Sets the poll interval time
   * @param newTime is in seconds
   */
  setPollIntervalTime(newTime) {
    let myTime = +newTime; // Convert to number in case it is not
    if (typeof myTime !== 'number' || myTime < 10 || myTime > 60) {
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
    if (changedKeys.includes('debugCap') || changedKeys.includes('extendedCap') || changedKeys.includes('experimentalCap')) {
      this.updateCapabilities(newSettings);
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
      const piggyState = await this.homey.app.getState();
      if (piggyState.appState === c.APP_NOT_READY) {
        this.setUnavailable(this.homey.__('warnings.homeyApiNotResponding'));
      } else if (piggyState.appState === c.APP_MISSING_PRICE_API) {
        this.setUnavailable(this.homey.__('warnings.noPriceApi'));
      } else if (piggyState.appState === c.APP_MISSING_PRICE_DEVICE) {
        this.setUnavailable(this.homey.__('warnings.noPriceApiDevice'));
      } else if (piggyState.appState === c.APP_MISSING_PRICE_DATA) {
        this.setUnavailable(this.homey.__('warnings.noPriceApiData'));
      } else if (+piggyState.operating_mode === 0) {
        this.setUnavailable(this.homey.__('warnings.appDisabled'));
      } else {
        this.setAvailable();
      }
      // this.homey.app.updateLog("Updating state: " + JSON.stringify(piggyState), 1);
      if (piggyState.power_last_hour) {
        this.setCapabilityValue('meter_power.last_hour', piggyState.power_last_hour);
      }
      if (piggyState.power_estimated) {
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
      this.log(`Device price point is: ${piggyState.price_point}`);
      if (piggyState.price_point !== null && piggyState !== undefined) {
        this.setCapabilityValue('piggy_price', String(piggyState.price_point));
      }
      if (+piggyState.price_point !== +prevPricePoint) {
        this.setStoreValue('piggy_price', piggyState.price_point);
        switch (+piggyState.price_point) {
          case 0: this.toggleCapability('piggy_price_low'); break;
          case 1: this.toggleCapability('piggy_price_normal'); break;
          case 2: this.toggleCapability('piggy_price_expensive'); break;
          case 3: this.toggleCapability('piggy_price_extreme'); break;
          default: /* Broken input should not happen */ break;
        }
      }

      // Set Mode capability + update timeline using boolean workaround capabilities
      const prevMode = await this.getStoreValue('piggy_mode');
      this.setCapabilityValue('piggy_mode', String(piggyState.operating_mode));
      if (+piggyState.operating_mode !== +prevMode) {
        this.setStoreValue('piggy_mode', +piggyState.operating_mode);
        switch (+piggyState.operating_mode) {
          case 0: this.toggleCapability('piggy_mode_disabled'); break;
          case 1: this.toggleCapability('piggy_mode_normal'); break;
          case 2: this.toggleCapability('piggy_mode_night'); break;
          case 3: this.toggleCapability('piggy_mode_holiday'); break;
          case 4: this.toggleCapability('piggy_mode_custom'); break;
          default: /* Broken input should not happen */ break;
        }
      }

      if (piggyState.power_yesterday) {
        this.setCapabilityValue('meter_power.last_day', piggyState.power_yesterday);
      }
      if (piggyState.power_last_month) {
        this.setCapabilityValue('meter_power.last_month', piggyState.power_last_month);
      }
      if (piggyState.power_average) {
        this.setCapabilityValue('meter_power.month_estimate', piggyState.power_average);
      }

      // Experimental capabilities, so only update if they exist
      if (this.hasCapability('piggy_money.savings_all_time_use') === true && piggyState.savings_all_time_use) {
        this.setCapabilityValue('piggy_money.savings_all_time_use', piggyState.savings_all_time_use);
      }
      if (this.hasCapability('piggy_money.savings_all_time_power_part') === true && piggyState.savings_all_time_power_part) {
        this.setCapabilityValue('piggy_money.savings_all_time_power_part', piggyState.savings_all_time_power_part);
      }
      if (this.hasCapability('piggy_money.savings_all_time_total') === true && (piggyState.savings_all_time_use || piggyState.savings_all_time_power_part)) {
        this.setCapabilityValue('piggy_money.savings_all_time_total', piggyState.savings_all_time_use + piggyState.savings_all_time_power_part);
      }

      // Debug capabilities, so only update if they exist
      if (this.hasCapability('piggy_num_failures') === true) {
        this.setCapabilityValue('piggy_num_failures', piggyState.num_fail_on + piggyState.num_fail_off + piggyState.num_fail_temp);
      }
      if (this.hasCapability('piggy_num_restarts') === true) {
        this.setCapabilityValue('piggy_num_restarts', piggyState.num_restarts);
      }

      // Extended capabilities so only update if they exist
      if (this.hasCapability('meter_power.low_energy_avg') === true && piggyState.low_price_energy_avg) {
        this.setCapabilityValue('meter_power.low_energy_avg', piggyState.low_price_energy_avg);
      }
      if (this.hasCapability('meter_power.norm_energy_avg') === true && piggyState.norm_price_energy_avg) {
        this.setCapabilityValue('meter_power.norm_energy_avg', piggyState.norm_price_energy_avg);
      }
      if (this.hasCapability('meter_power.high_energy_avg') === true && piggyState.high_price_energy_avg) {
        this.setCapabilityValue('meter_power.high_energy_avg', piggyState.high_price_energy_avg);
      }
      if (this.hasCapability('meter_power.extreme_energy_avg') === true && piggyState.extreme_price_energy_avg) {
        this.setCapabilityValue('meter_power.extreme_energy_avg', piggyState.extreme_price_energy_avg);
      }
      if (this.hasCapability('piggy_money.average_price') === true && piggyState.average_price) {
        this.setCapabilityValue('piggy_money.average_price', piggyState.average_price);
      }
      if (this.hasCapability('piggy_money.current_price') === true && piggyState.current_price) {
        this.setCapabilityValue('piggy_money.current_price', piggyState.current_price);
      }
      if (this.hasCapability('piggy_money.low_price_limit') === true && piggyState.low_price_limit) {
        this.setCapabilityValue('piggy_money.low_price_limit', piggyState.low_price_limit);
      }
      if (this.hasCapability('piggy_money.high_price_limit') === true && piggyState.high_price_limit) {
        this.setCapabilityValue('piggy_money.high_price_limit', piggyState.high_price_limit);
      }
      if (this.hasCapability('piggy_money.extreme_price_limit') === true && piggyState.extreme_price_limit) {
        this.setCapabilityValue('piggy_money.extreme_price_limit', piggyState.extreme_price_limit);
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
