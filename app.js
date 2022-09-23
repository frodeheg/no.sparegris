/* eslint-disable brace-style */
/* eslint-disable node/no-unsupported-features/es-syntax */
/* eslint-disable no-loop-func */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-prototype-builtins */
/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint comma-dangle: ["error", "never"] */

'use strict';

// NOTES:
// * As the Zigbee implementation of Homey is extremely poor when it comes to recovering after a reboot,
//   this app will prevent sending commands to other devices using the Homey api for the first 15 minutes
//   after the app was started unless the commands was user initiated (e.g. by using the setup).
//   This will ensure that the Zigbee driver is not interrupted during the recovery process and as such
//   has a higher get enough time to recover after a reboot.
//   (yes, it has been tested that the Zigbee driver does not recover unless this measure is taken)
let preventZigbee = false;

const Homey = require('homey');
const nodemailer = require('nodemailer');
const os = require('node:os');
const { Log } = require('homey-log');
const { Mutex } = require('async-mutex');
const { HomeyAPIApp } = require('homey-api');
const { resolve } = require('path');
const c = require('./common/constants');
const d = require('./common/devices');

const WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MIN = 1 * 60 * 1000; // Wait 1 minute
const WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MAX = 5 * 60 * 1000; // Wait 5 minutes
const TIME_FOR_POWERCYCLE_MIN = 5 * 60 * 1000; // 5 minutes left
const TIME_FOR_POWERCYCLE_MAX = 30 * 60 * 1000; // more than 30 minutes left

// Operations for controlled devices
const ALWAYS_OFF = 0;
const ALWAYS_ON = 1;
const CONTROLLED = 2;

const TURN_ON = 0;
const TURN_OFF = 1;
const DELTA_TEMP = 2;
const EMERGENCY_OFF = 3;
const IGNORE = 4;

// Modes
const MODE_DISABLED = 0;
const MODE_NORMAL = 1;
const MODE_NIGHT = 2;
const MODE_AWAY = 3;
const MODE_CUSTOM = 4;

/**
 * Helper functions
 */
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * PiggyBank Class definition
 */
class PiggyBank extends Homey.App {

  /**
   * Validates the settings
   */
  validateSettings() {
    // this.log('Validating settings.');
    // this.log(`frostList: ${JSON.stringify(this.homey.settings.get('frostList'))}`);
    // this.log(`modeList: ${JSON.stringify(this.homey.settings.get('modeList'))}`);
    // this.log(`priceActionList: ${JSON.stringify(this.homey.settings.get('priceActionList'))}`);
    try {
      if (this.homey.settings.get('operatingMode') === null) return false;
      if (this.homey.settings.get('maxPower') === null) return false;
      const frostList = this.homey.settings.get('frostList');
      const numControlledDevices = Object.keys(frostList).length;
      if (numControlledDevices === 0) return false;
      const modeList = this.homey.settings.get('modeList');
      const actionList = this.homey.settings.get('priceActionList');
      if (modeList.length < 3 || modeList.length > 8
        || actionList.length < 3) return false; // Do not complain about actionList missing for extremely high prices as this could cause older versions of the app to fail
      if (modeList[0].length !== numControlledDevices
        || modeList[1].length !== numControlledDevices
        || modeList[2].length !== numControlledDevices
        || Object.keys(actionList[0]).length !== numControlledDevices
        || Object.keys(actionList[1]).length !== numControlledDevices
        || Object.keys(actionList[2]).length !== numControlledDevices) return false;
    } catch (err) {
      this.updateLog(`Validate error: ${err}`, c.LOG_ERROR);
      return false;
    }
    return true;
  }

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('OnInit');
    this.homey.on('unload', () => this.onUninit());

    /* DEBUG_BEGIN
    // Reset settings to simulate fresh device in case of debug
    if (this.homey.app.manifest.id === 'no.sparegris2') {
      this.log('===== DEBUG MODE =====');
      const settings = this.homey.settings.getKeys();
      this.log(`Settings available: ${JSON.stringify(settings)}`);
      // this.log('Deleting all settings...');
      // for (let i = 0; i < settings.length; i++) {
      //   this.homey.settings.unset(settings[i]);
      // }
    }
    DEBUG_END */

    // Logging
    try {
      this.logInit();
    } catch (err) {} // Ignore logging errors, normal users don't care

    // ===== BREAKING CHANGES =====
    // Version 0.10.8 changes from having maxPower per mode to one global setting
    if (Array.isArray(this.homey.settings.get('maxPowerList'))) {
      const maxPowerList = this.homey.settings.get('maxPowerList');
      this.homey.settings.set('maxPower', maxPowerList[0]);
      this.homey.settings.unset('maxPowerList');
      const maxPowerText = `${this.homey.__('breaking.maxPower')} ${maxPowerList[0]} kWh`;
      this.log(maxPowerText);
      this.homey.notifications.createNotification({ excerpt: maxPowerText });
    }
    // Version 0.12.1 : An earlier version added an option to disregard temperature, this should default to 1 or problems arise
    if (this.homey.settings.get('controlTemp') === null) {
      this.homey.settings.set('controlTemp', 1);
    }

    // Version 0.8.15 and 0.14.3: Added new price modes
    const oldPriceActionList = this.homey.settings.get('priceActionList');
    if (oldPriceActionList !== null && oldPriceActionList.length < 5) {
      const cheapActionList = oldPriceActionList[0];
      const normalActionList = oldPriceActionList[1];
      const highActionList = oldPriceActionList[2];
      const extremeActionList = oldPriceActionList[3] || highActionList; // Added in version 0.8.15
      const dirtCheapActionList = oldPriceActionList[4] || cheapActionList; // Added in version 0.14.3
      const newPriceActionList = [cheapActionList, normalActionList, highActionList, extremeActionList, dirtCheapActionList];
      this.homey.settings.set('priceActionList', newPriceActionList);
    }

    // Version 0.14.5 Adds custom Modes
    const modeNames = this.homey.settings.get('modeNames');
    const modeList = this.homey.settings.get('modeList');
    if (Array.isArray(modeList) && !Array.isArray(modeNames)) {
      const modeNames = modeList.slice(3, 8).map(x => this.homey.__('settings.opMode.custom'));
      this.homey.settings.set('modeNames', modeNames);
    }

    // Version 0.16.2 removed some settings:
    this.homey.settings.unset('stats_tmp_max_power_today');

    // ===== BREAKING CHANGES END =====

    // ===== KEEPING STATE ACROSS RESTARTS =====
    if (this.homey.settings.get('safeShutdown__current_power') !== null) {
      // For onPowerUpdate + onNewHour
      this.__accum_energy = +await this.homey.settings.get('safeShutdown__accum_energy');
      this.__current_power = +await this.homey.settings.get('safeShutdown__current_power');
      this.__current_power_time = new Date(await this.homey.settings.get('safeShutdown__current_power_time'));
      this.__power_last_hour = await this.homey.settings.get('safeShutdown__power_last_hour');
      if (this.__power_last_hour === null) this.__power_last_hour = undefined;
      this.homey.settings.unset('safeShutdown__accum_energy');
      this.homey.settings.unset('safeShutdown__current_power');
      this.homey.settings.unset('safeShutdown__current_power_time');
      this.homey.settings.unset('safeShutdown__power_last_hour');
      this.updateLog(`Restored state from safe shutdown values ${this.__accum_energy} ${this.__current_power} ${this.__current_power_time} ${this.__power_last_hour}`, c.LOG_INFO);
    } else {
      this.updateLog('No state from previous shutown? Powerloss, deactivated or forced restart.', c.LOG_INFO);
    }
    // ===== KEEPING STATE ACROSS RESTARTS END =====

    // Initialize missing settings
    let futurePriceOptions = this.homey.settings.get('futurePriceOptions');
    if (!futurePriceOptions
      || !('minCheapTime' in futurePriceOptions)
      || !('minExpensiveTime' in futurePriceOptions)
      || !('averageTime' in futurePriceOptions)
      || !('dirtCheapPriceModifier' in futurePriceOptions)
      || !('lowPriceModifier' in futurePriceOptions)
      || !('highPriceModifier' in futurePriceOptions)
      || !('extremePriceModifier' in futurePriceOptions)) {
      if (!futurePriceOptions) futurePriceOptions = {};
      if (!('minCheapTime' in futurePriceOptions)) futurePriceOptions.minCheapTime = 4;
      if (!('minExpensiveTime' in futurePriceOptions)) futurePriceOptions.minExpensiveTime = 4;
      if (!('averageTime' in futurePriceOptions)) futurePriceOptions.averageTime = 0;
      if (!('dirtCheapPriceModifier' in futurePriceOptions)) futurePriceOptions.dirtCheapPriceModifier = -50;
      if (!('lowPriceModifier' in futurePriceOptions)) futurePriceOptions.lowPriceModifier = -10;
      if (!('highPriceModifier' in futurePriceOptions)) futurePriceOptions.highPriceModifier = 10;
      if (!('extremePriceModifier' in futurePriceOptions)) futurePriceOptions.extremePriceModifier = 100;
      this.log(`Resetting futurePriceOptions to ${JSON.stringify(futurePriceOptions)}`);
      this.homey.settings.set('futurePriceOptions', futurePriceOptions);
    }

    // Initialize current state
    this.__intervalID = undefined;
    this.__newHourID = undefined;
    this.__current_power = undefined;
    this.__current_power_time = undefined;
    this.__accum_energy = undefined;
    this.__reserved_energy = 0;
    this.__free_power_trigger_time = new Date();
    this.__last_power_off_time = new Date();
    this.__last_power_on_time = new Date();
    this.__power_last_hour = undefined;
    this.__power_estimated = undefined;
    this.__alarm_overshoot = false;
    this.__free_capacity = 0;
    this.__num_forced_off_devices = 0;
    this.__num_off_devices = 0;
    this.__all_prices = this.homey.settings.get('all_prices');
    this.__current_prices = [];
    this.__current_price_index = undefined;
    this.mutex = new Mutex();
    this.homeyApi = new HomeyAPIApp({
      homey: this.homey
    });
    // All elements of current_state will have the following:
    //  nComError: Number of communication errors since last time it worked - Used to depriorotize devices so we don't get stuck in an infinite retry loop
    //  isOn: If the device should be on
    //  temp: The temperature of the device
    //  ongoing: true if the state has not been confirmed yet
    // Need to be refreshed whenever the device list is created
    this.__current_state = {};

    // See comment at the top of the file why zigbee is prevented
    const timeToPreventZigbee = Math.min(15 * 60 - os.uptime(), 15 * 60);
    if (timeToPreventZigbee > 0) {
      preventZigbee = true;
      this.updateLog(`Homey reboot detected. Delaying device control by ${timeToPreventZigbee} seconds to improve Zigbee recovery.`, c.LOG_ERROR);
      setTimeout(() => {
        this.updateLog('Device constrol is once again enabled.', c.LOG_INFO);
        preventZigbee = false;
      }, timeToPreventZigbee * 1000);
    }

    this.statsInit();

    // Check that settings has been updated
    this.app_is_configured = this.validateSettings();

    // Create list of devices
    while (this.__deviceList === undefined) {
      try {
        await this.createDeviceList();
      } catch (err) {
        // Ignore the error and try to refresh the devicelist once more
      }
    }

    // Enable trigger cards
    const freePowerTrigger = this.homey.flow.getTriggerCard('free-power-changed');
    freePowerTrigger.registerRunListener(async (args, state) => {
      return state.freePower >= args.freePower;
    });

    // Enable action cards
    const cardActionEnergyUpdate = this.homey.flow.getActionCard('update-meter-energy'); // Marked as deprecated so nobody will see it yet
    cardActionEnergyUpdate.registerRunListener(async args => {
      const newTotal = args.TotalEnergyUsage;
      this.updateLog(`Total energy changed to: ${String(newTotal)}`, c.LOG_INFO);
    });
    const cardActionPowerUpdate = this.homey.flow.getActionCard('update-meter-power');
    cardActionPowerUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onPowerUpdate(args.CurrentPower);
    });
    const cardActionModeUpdate = this.homey.flow.getActionCard('change-piggy-bank-mode');
    cardActionModeUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      return this.onModeUpdate(+args.mode);
    });
    const cardActionModeUpdate2 = this.homey.flow.getActionCard('change-piggy-bank-mode2');
    cardActionModeUpdate2.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      return this.onModeUpdate(+args.mode.id);
    });
    cardActionModeUpdate2.registerArgumentAutocompleteListener(
      'mode',
      async (query, args) => {
        return this.generateModeList(query, args);
      }
    );
    const cardActionPricePointUpdate = this.homey.flow.getActionCard('change-piggy-bank-price-point');
    cardActionPricePointUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      if (+this.homey.settings.get('priceMode') !== c.PRICE_MODE_FLOW) return Promise.reject(new Error(this.homey.__('warnings.notPMfromFlow')));
      return this.onPricePointUpdate(+args.mode);
    });
    const cardActionMaxUsageUpdate = this.homey.flow.getActionCard('change-piggy-bank-max-usage');
    cardActionMaxUsageUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onMaxUsageUpdate(args.maxPow);
    });
    const cardActionSafetyPowerUpdate = this.homey.flow.getActionCard('change-piggy-bank-safety-power');
    cardActionSafetyPowerUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onSafetyPowerUpdate(args.reserved);
    });
    const cardZoneUpdate = this.homey.flow.getActionCard('change-zone-active');
    cardZoneUpdate.registerArgumentAutocompleteListener(
      'zone',
      async (query, args) => {
        if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
        if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
        if (+this.homey.settings.get('operatingMode') === MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
        return this.generateZoneList(query, args);
      }
    );
    cardZoneUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onZoneUpdate(args.zone, args.enabled);
    });
    const priceCondition = this.homey.flow.getConditionCard('the_price_point_is');
    priceCondition.registerRunListener(async (args, state) => {
      const priceIsEqual = +args.mode === +this.homey.settings.get('pricePoint');
      return priceIsEqual;
    });
    const modeCondition = this.homey.flow.getConditionCard('the_mode_is');
    modeCondition.registerRunListener(async (args, state) => {
      const modeIsEqual = +args.mode.id === +this.homey.settings.get('operatingMode');
      return modeIsEqual;
    });
    modeCondition.registerArgumentAutocompleteListener(
      'mode',
      async (query, args) => {
        return this.generateModeList(query, args);
      }
    );

    this.homey.settings.on('set', setting => {
      if (setting === 'deviceList') {
        this.__deviceList = this.homey.settings.get('deviceList');
      } else if (setting === 'settingsSaved') {
        const doRefresh = this.homey.settings.get('settingsSaved');
        if (doRefresh === 'true') {
          this.updateLog('Settings saved, refreshing all devices.', c.LOG_INFO);
          this.app_is_configured = this.validateSettings();
          if (!this.app_is_configured) {
            throw (new Error('This should never happen, please contact the developer and the bug will be fixed'));
          }

          const currentMode = +this.homey.settings.get('operatingMode');
          if (!preventZigbee && currentMode !== MODE_DISABLED) {
            this.refreshAllDevices();
          }
          this.homey.settings.set('settingsSaved', '');
          // The callback only returns on error so notify success with failure
          throw (new Error(this.homey.__('settings.alert.settingssaved')));
        }
      }
    });

    // Not actually a new hour, but it will reset the hour tracking state so it is ready for next hour
    // The function distinguish between being called at a new hour and at app-init
    await this.onNewHour();

    // Monitor energy usage every 5 minute
    this.__monitorError = 0;
    this.__intervalID = setInterval(() => {
      this.onMonitor();
    }, 1000 * 60 * 5);

    this.updateLog('PiggyBank has been initialized', c.LOG_INFO);
    return Promise.resolve();
  }

  /**
   * Warning: homey does not report any errors if this function crashes, so make sure it doesn't crash
   */
  async generateModeList(query, args) {
    const results = [
      { name: this.homey.__('settings.app.disabled'), description: '', id: '0' },
      { name: this.homey.__('settings.opMode.normal'), description: '', id: '1' },
      { name: this.homey.__('settings.opMode.night'), description: '', id: '2' },
      { name: this.homey.__('settings.opMode.holiday'), description: '', id: '3' }
    ];
    const modeNames = this.homey.settings.get('modeNames');
    if (Array.isArray(modeNames)) {
      for (const nameId in modeNames) {
        const mode = {
          name: modeNames[nameId],
          description: `${this.homey.__('settings.opMode.custom')} ${+nameId + 1}`,
          id: `${4 + nameId}`
        };
        results.push(mode);
      }
    }
    return results.filter(result => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

  /**
   * Warning: homey does not report any errors if this function crashes, so make sure it doesn't crash
   */
  async generateZoneList(query, args) {
    // Count how many devices there are in every zone
    // The zone object looks like this:
    // {"id":"9919ee1e-ffbc-480b-bc4b-77fb047e9e68","name":"Hjem","order":1,"parent":null,"active":false,"activeLastUpdated":null,"icon":"home"}
    const zones = await this.homeyApi.zones.getZones()
      .catch(err => {
        // Failed to get the zones so just return nothing
        return [];
      });
    const activeZones = {};
    for (const deviceId in this.__deviceList) {
      if (this.__deviceList[deviceId].use) {
        let zoneId = this.__deviceList[deviceId].roomId;
        while (zoneId !== null) {
          if (zoneId in activeZones) {
            activeZones[zoneId] += 1;
          } else {
            activeZones[zoneId] = 1;
          }
          zoneId = zones[zoneId].parent;
        }
      }
    }

    // Generate zone list to return
    const results = [];
    for (const zoneId in activeZones) {
      const room = {
        name: zones[zoneId].name,
        description: `${this.homey.__('settings.zone.zoneNum')}: ${String(activeZones[zoneId])}`,
        id: zoneId
      };
      results.push(room);
    }
    return results.filter(result => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

  /**
   * onUninit() is called when the app is destroyed
   * Note. Due to a bug in HomeyAPI this function is not called automatically and is instead triggered
   * by the app itself, thus when the HomeyAPI bug is fixed it might be that this function will be called twice.
   * It is for this reason essential that the code is safe to run twice.
   */
  async onUninit() {
    // ===== KEEPING STATE ACROSS RESTARTS =====
    // We only got 1s to do this so need to save state before anything else
    // For onPowerUpdate + onNewHour
    this.homey.settings.set('safeShutdown__accum_energy', this.__accum_energy);
    this.homey.settings.set('safeShutdown__current_power', this.__current_power);
    this.homey.settings.set('safeShutdown__current_power_time', this.__current_power_time);
    this.homey.settings.set('safeShutdown__power_last_hour', this.__power_last_hour);
    // ===== KEEPING STATE ACROSS RESTARTS END =====

    this.log('OnUnInit');
    // Make sure the interval is cleared if it was started, otherwise it will continue to
    // trigger but on an unknown app.
    if (this.__intervalID !== undefined) {
      clearInterval(this.__intervalID);
      this.__intervalID = undefined;
    }
    if (this.__newHourID !== undefined) {
      clearTimeout(this.__newHourID);
      this.__newHourID = undefined;
    }
    this.statsUnInit();

    this.updateLog('PiggyBank has been uninitialized', c.LOG_INFO);
  }

  /**
   * Create a list of relevant devices
   */
  async createDeviceList() {
    // Call APIs
    const devices = await this.homeyApi.devices.getDevices(); // Error thrown is catched by caller of createDeviceList
    const zones = await this.homeyApi.zones.getZones(); // Error thrown is catched by caller of createDeviceList
    // Note: The API calls above might time out, in which case the rest of the function will never be executed.

    const oldDeviceList = this.homey.settings.get('deviceList');
    const relevantDevices = {};

    // Loop all devices
    for (const device of Object.values(devices)) {
      // Relevant Devices must have an onoff capability
      // Unfortunately some devices like the SensiboSky heat pump controller invented their own onoff capability
      // so unless specially handled the capability might not be detected. The generic detection mechanism below
      // has only been tested on SensiboSky devices so there might be problems with other devices with custom onoff capabilities
      const onoffCap = device.capabilities.includes('onoff') ? 'onoff' : device.capabilities.find(cap => cap.includes('onoff'));
      // if ((onoffCap === undefined) && device.capabilities.includes('enabled')) {
      //   onoffCap = 'enabled';
      // }
      if (onoffCap === undefined) {
        this.updateLog(`ignoring: ${device.name}`, c.LOG_DEBUG);
        if (device.name === 'Varmepumpe') {
          this.updateLog('Capabilities ======', c.LOG_DEBUG);
          this.updateLog(String(device.capabilities), c.LOG_DEBUG);
        }
        continue;
      }
      // Priority 1 devices has class = thermostat & heater - capabilities ['target_temperature' + 'measure_temperature']
      const priority = (device.capabilities.includes('target_temperature') ? 1 : 0)
        + (device.capabilities.includes('measure_temperature') ? 1 : 0)
        + ((device.class === 'thermostat' || device.class === 'heater') ? 1 : 0);

      // Filter out irrelevant devices (check old device list if possible)
      let useDevice = false;
      if (oldDeviceList !== null && device.id in oldDeviceList) {
        useDevice = oldDeviceList[device.id].use;
      } else {
        // Never seen before device, set usage based on priority
        useDevice = (priority > 0);
      }

      // Find which zones the device are within:
      let zoneId = device.zone;
      const memberOfZones = [];
      while (zoneId !== null) {
        memberOfZones.push(zoneId);
        zoneId = zones[zoneId].parent;
      }

      this.updateLog(`Device: ${String(priority)} ${device.id} ${device.name} ${device.class}`, c.LOG_DEBUG);
      const thermostatCap = device.capabilities.includes('target_temperature')
        && device.capabilities.includes('measure_temperature');
      // device.capabilitiesObj should be available but in case homey timed out it could be incomplete
      const targetTemp = (thermostatCap && device.capabilitiesObj && ('target_temperature' in device.capabilitiesObj))
        ? +device.capabilitiesObj['target_temperature'].value : 24;
      const driverId = `${device.driverUri.split(':').at(-1)}:${device.driverId}`;
      const relevantDevice = {
        priority: (priority > 0) ? 1 : 0,
        name: device.name,
        room: device.zoneName,
        roomId: device.zone,
        memberOf: memberOfZones,
        image: device.iconObj == null ? null : device.iconObj.url,
        onoff_cap: onoffCap,
        thermostat_cap: thermostatCap,
        targetTemp, // Default target temp for use when setting up for the first time
        driverId, // If this is found in the supported device list then onoff_cap and thermostat_cap are ignored
        use: useDevice // Actually only parameter that is kept across reboots
      };
      relevantDevices[device.id] = relevantDevice;
    }
    this.__deviceList = relevantDevices;

    // Refresh current state for monitoring:
    if (!this.__current_state) {
      this.__current_state = {};
    }
    for (const deviceId in relevantDevices) {
      if (!(deviceId in this.__current_state)) {
        this.__current_state[deviceId] = {
          nComError: 0,
          isOn: undefined,
          temp: undefined,
          ongoing: false,
          __monitorError: 0,
          __monitorFixOn: 0,
          __monitorFixTemp: 0
        };
      }
    }
    return this.__deviceList;
  }

  /**
   * Return a tooken describing how well the app has been configured
   */
  async getAppConfigProgress() {
    const appConfigProgress = {};
    this.apiState = await this._checkApi();
    appConfigProgress.energyMeterNotConnected = (this.__energy_meter_detected_time === undefined);
    appConfigProgress.timeSinceEnergyMeter = ((new Date() - this.__energy_meter_detected_time) / 1000);
    appConfigProgress.gotPPFromFlow = this.homey.settings.get('gotPPFromFlow') === 'true';
    appConfigProgress.ApiStatus = this.apiState;
    return appConfigProgress;
  }

  /**
   * Changes the state of a device.
   * The state cannot always be changed. The priority of states are as follows:
   * - Below frost-guard results in always on and highest priority
   * - If a zone is off then no devices will be on for devices in the zone
   * - Device always off from mode
   * - Device turns off from price action
   * - Device always on from mode
   * - Device turns off due to power control
   * - Device turns on from price action
   * - Device turns on due to power control
   * @return [success, noChange] - success means that the result is as requested, noChange indicate if the result was already as requested
   * @throw error in case of failure
   */
  async changeDeviceState(deviceId, targetState) {
    if (!(deviceId in this.__deviceList)) {
      // Apparently the stored settings are invalid and need to be refreshed
      return Promise.resolve([false, false]);
    }
    const promiseDevice = this.homeyApi.devices.getDevice({ id: deviceId });
    const actionLists = this.homey.settings.get('priceActionList');
    const priceMode = +this.homey.settings.get('priceMode');
    const actionListIdx = +this.homey.settings.get('pricePoint');
    const currentAction = actionLists[actionListIdx][deviceId]; // Action state: .operation
    const modeLists = this.homey.settings.get('modeList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const currentModeList = modeLists[currentMode - 1];
    const currentModeIdx = this.findModeIdx(deviceId);
    const currentModeState = parseInt(currentModeList[currentModeIdx].operation, 10); // Mode state
    const replacementOp = (currentModeState === ALWAYS_OFF) ? TURN_OFF : TURN_ON;
    const currentActionOp = (priceMode === c.PRICE_MODE_DISABLED) ? replacementOp : parseInt(currentAction.operation, 10); // Override the current action if price actions are disabled

    // Do not attempt to control any devices if the app is disabled
    if (currentMode === 0) { // App is disabled
      return Promise.resolve();
    }

    // In case the new state was not set it will be the same as the preferred state.
    // This can happen for 2 cases:
    // - priceMode is DISABLED
    // - zone control turns on devices again
    let newState;
    if ((targetState === undefined) || (targetState === DELTA_TEMP)) {
      switch (currentActionOp) {
        case DELTA_TEMP:
          // Override as changedevicestate only handles onoff
          newState = TURN_ON;
          break;
        default:
          newState = currentActionOp;
      }
    } else {
      newState = targetState;
    }

    // Do not attempt to change the device state if it is in IGNORE
    // or EMERGENCY_OFF mode unless it is an EMERGENCY_OFF operation
    if ((currentActionOp === IGNORE) || (newState === IGNORE)
      || (currentActionOp === EMERGENCY_OFF && newState !== EMERGENCY_OFF)) {
      return Promise.resolve([false, false]);
    }

    let device;
    try {
      device = await promiseDevice;
    } catch (err) {
      // Most likely timeout
      this.updateLog(`Device cannot be fetched. ${String(err)}`, c.LOG_ERROR);
      this.__current_state[deviceId].nComError += 10; // Big error so wait more until retry than smaller errors
      return Promise.resolve([false, false]); // The unhandled device is solved by the later nComError handling
    }
    const frostList = this.homey.settings.get('frostList');
    const frostGuardActive = (this.__deviceList[deviceId].thermostat_cap && (device.capabilitiesObj !== null))
      ? (device.capabilitiesObj[this.getTempGetCap(deviceId)].value < frostList[deviceId].minTemp) : false;

    if (this.getOnOffCap(deviceId) === undefined) return Promise.reject(new Error('onoff capability does not exist, this should not happen'));
    const isOn = this.getIsOn(device, deviceId);
    const activeZones = this.homey.settings.get('zones');
    const newStateOn = frostGuardActive
      || (currentActionOp !== TURN_OFF && currentActionOp !== EMERGENCY_OFF
        && !this.__deviceList[deviceId].memberOf.some(z => (activeZones.hasOwnProperty(z) && !activeZones[z].enabled))
        && ((newState === TURN_ON && currentModeState !== ALWAYS_OFF) || (newState === TURN_OFF && currentModeState === ALWAYS_ON)));

    this.__current_state[deviceId].isOn = newStateOn;
    if (newStateOn === undefined) {
      this.updateLog(`isOn was set to undefined ${frostGuardActive}`, c.LOG_ERROR);
    }
    this.__current_state[deviceId].ongoing = false; // If already ongoing then it should already have been completed, try again
    if (newStateOn && !isOn) {
      // Turn on
      const deviceName = this.__deviceList[deviceId].name;
      this.updateLog(`Turning on device: ${deviceName}`, c.LOG_INFO);
      this.__current_state[deviceId].ongoing = true;
      this.__current_state[deviceId].confirmed = false;
      return device.setCapabilityValue({ capabilityId: this.getOnOffCap(deviceId), value: this.getOnOffTrue(deviceId) })
        .then(() => {
          this.__current_state[deviceId].nComError = 0;
          this.__num_off_devices--;
          // Always change temperature when turning on
          return this.refreshTemp(deviceId); // Will not return error
        })
        .then(() => Promise.resolve([newState === TURN_ON, false]))
        .catch(error => {
          this.statsCountFailedTurnOn();
          this.__current_state[deviceId].ongoing = undefined;
          this.__current_state[deviceId].nComError += 1;
          this.updateLog(`Failed to turn on device ${deviceName}, will retry later`, c.LOG_ERROR);
          return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
        });
    } // ignore case !wantOn && isOn

    if (!newStateOn && isOn) {
      // Turn off
      const deviceName = this.__deviceList[deviceId].name;
      this.updateLog(`Turning off device: ${deviceName}`, c.LOG_INFO);
      this.__current_state[deviceId].ongoing = true;
      this.__current_state[deviceId].confirmed = false;
      return device.setCapabilityValue({ capabilityId: this.getOnOffCap(deviceId), value: this.getOnOffFalse(deviceId) })
        .then(() => {
          this.__current_state[deviceId].nComError = 0;
          this.__current_state[deviceId].ongoing = false;
          this.__num_off_devices++;
          return Promise.resolve([newState === TURN_OFF, false]);
        })
        .catch(error => {
          this.__current_state[deviceId].ongoing = undefined;
          this.statsCountFailedTurnOff();
          this.__current_state[deviceId].nComError += 1;
          this.updateLog(`Failed to turn off device ${deviceName}, will try to turn off other devices instead. (${error})`, c.LOG_ERROR);
          return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
        });
    }

    if (newStateOn && isOn && (targetState === undefined || targetState === DELTA_TEMP)) {
      // Temperature could have changed
      return this.refreshTemp(deviceId);
    }

    // Nothing happened
    return Promise.resolve([newStateOn === (newState === TURN_ON), isOn === (newState === TURN_ON)]);
  }

  /**
   * onNewHour runs whenever a new hour starts
   * - Whenever called it calculates the time until next hour and starts a timeout function
   */
  async onNewHour() {
    const now = new Date();
    const timeWithinHour = 1000 * 60 * 60 - this.timeToNextHour(now);
    try {
      if (this.__current_power === undefined) {
        // First hour after app was started
        // Reserve energy for the time we have no data on
        const maxPower = this.homey.settings.get('maxPower');
        const errorMargin = this.homey.settings.get('errorMargin') ? (parseInt(this.homey.settings.get('errorMargin'), 10) / 100) : 1;
        const lapsedTime = timeWithinHour;
        // Assume 100% use this hour up until now (except for the errorMargin so we gett less warnings the first hour)
        this.__reserved_energy = (1 - errorMargin) * ((maxPower * lapsedTime) / (1000 * 60 * 60));
        if (Number.isNaN(this.__reserved_energy)) {
          this.__reserved_energy = 0;
        }
        this.__accum_energy = 0;
      } else {
        // Add up last part of previous hour. Note that in case an app restart is in progress then the delta from last time might cross the hour so we need to distinguish.
        const lapsedTime = now - this.__current_power_time;
        const timeLeftInHour = this.timeToNextHour(this.__current_power_time);
        let timeToProcess = lapsedTime;
        if (lapsedTime > timeLeftInHour) {
          timeToProcess = timeLeftInHour;
        }
        const energyUsed = (this.__current_power * timeToProcess) / (1000 * 60 * 60);
        this.__accum_energy += energyUsed;
        this.__reserved_energy = 0;
        if (timeToProcess < lapsedTime || timeWithinHour === 0) {
          // Crossed into new hour
          const energyOk = this.__power_last_hour !== undefined; // If undefined then this is not for the full hour
          await this.statsSetLastHourEnergy(this.__accum_energy, energyOk, now);
          this.__power_last_hour = this.__accum_energy;
          this.updateLog(`Hour finalized: ${String(this.__accum_energy)} Wh`, c.LOG_INFO);
          // Add up initial part of next hour (only necessary for app restarts as otherwise the number will be close to 0).
          const energyUsedNewHour = (this.__current_power * timeWithinHour) / (1000 * 60 * 60);
          this.__accum_energy = energyUsedNewHour;
          this.log(`NewHour energy: ${this.__accum_energy}`, c.LOG_INFO);
        } else {
          // Still within the same hour (happens on app restart only)
        }
      }
      this.__current_power_time = now;
      if (+this.homey.settings.get('operatingMode') !== MODE_DISABLED) {
        this.doPriceCalculations()
          .catch(err => {
            // Either the app is not configured yet or the utility price API is not installed, just ignore
            return Promise.resolve();
          });
      }
      // Number of forced off devices can change every hour.
      // Instead of counting it here it is set whenever all devices has been tried to turn off
      // In the meantime it is just set to 0 to prevent the onFreePowerChanged to send out too much free power
      this.__num_forced_off_devices = 0;
    } finally {
      // Start timer to start exactly when a new hour starts
      const timeToNextTrigger = this.timeToNextHour(now);
      this.__newHourID = setTimeout(() => this.onNewHour(), timeToNextTrigger);
      this.updateLog(`New hour in ${String(timeToNextTrigger)} ms (now is: ${String(now)})`, c.LOG_DEBUG);
    }
  }

  /**
   * onMonitor runs regurarly to monitor the actual state
   * Similar to refreshAllDevices(), but it will only refresh states that are not correct
   */
  async onMonitor() {
    this.updateLog('onMonitor()', c.LOG_INFO);
    if (!this.app_is_configured) {
      // Early exit if the app is not configured
      return Promise.resolve(false);
    }
    // Go through all actions for this new mode;
    const actionLists = this.homey.settings.get('priceActionList');
    const currentPricePoint = +this.homey.settings.get('pricePoint');
    const currentActions = actionLists[currentPricePoint];
    const promises = [];
    for (const deviceId in currentActions) {
      if (!(deviceId in this.__deviceList)) {
        // Apparently the stored settings are invalid and need to be refreshed
        continue;
      }
      const { confirmed } = this.__current_state[deviceId];
      if (confirmed) continue;
      promises.push(Promise.resolve()
        .then(() => {
          const isOngoing = this.__current_state[deviceId].ongoing;
          if (isOngoing) return new Promise(resolve => setTimeout(resolve, 2 * 60 * 1000)); // Give it some time to resolve
          return Promise.resolve();
        })
        .then(() => {
          const isOngoing = this.__current_state[deviceId].ongoing;
          if (isOngoing === true) {
            this.__current_state[deviceId].__monitorError += 1;
          }
          // Go on to confirm device states
          return this.homeyApi.devices.getDevice({ id: deviceId });
        })
        .then(device => {
          if (this.getOnOffCap(deviceId) === undefined) {
            return Promise.reject(new Error('The onoff capability is non-existing, this should never happen.'));
          }
          const isOn = this.getIsOn(device, deviceId);
          const onConfirmed = (this.__current_state[deviceId].isOn === isOn);
          if (!onConfirmed) {
            // Try to change the on state.....
            this.__current_state[deviceId].__monitorFixOn += 1;
            const newOp = this.__current_state[deviceId].isOn ? TURN_ON : TURN_OFF;
            return this.changeDeviceState(deviceId, newOp)
              .then(() => this.refreshTemp(deviceId))
              .then(() => {
                this.__current_state[deviceId].confirmed = 1;
                return Promise.resolve(false);
              });
          }
          if ((!isOn) || (!this.__deviceList[deviceId].thermostat_cap)) {
            this.__current_state[deviceId].confirmed = 2;
            return Promise.resolve(true);
          }
          // Thermostat capabilities
          const tempConfirmed = this.__current_state[deviceId].temp && (device.capabilitiesObj[this.getTempSetCap(deviceId)].value === this.__current_state[deviceId].temp);
          if (tempConfirmed) {
            this.__current_state[deviceId].confirmed = 3;
            return Promise.resolve(true);
          }
          // Try to change the temp state.....
          this.__current_state[deviceId].__monitorFixTemp += 1;
          return this.refreshTemp(deviceId)
            .then(() => {
              this.__current_state[deviceId].confirmed = 4;
              return Promise.resolve(false);
            });
        })
        .catch(err => {
          // Ignore the error, just count the error for statistics
          // A fix will be attempted next time the monitor runs anyway
          this.__current_state[deviceId].__monitorError += 1;
          return Promise.resolve(false);
        }));
    }

    return Promise.all(promises)
      .then(values => {
        let allOk = true;
        for (let i = 0; i < values.length; i++) {
          allOk &&= values[i];
        }
        this.updateLog(`Monitor completed with state: ${allOk}`, c.LOG_DEBUG);
        return Promise.resolve(allOk);
      })
      .catch(error => {
        this.__monitorError += 1;
        this.updateLog(`Monitor failed to inspect devices: ${error}`, c.LOG_ERROR);
        return Promise.resolve(false); // Ignore errors as this is for monitoring
      });
  }

  /**
   * onPowerUpdate is the action called whenever the power is updated from the power meter
   * Must never be called when operatingMode is set to Disabled
   */
  async onPowerUpdate(newPower) {
    // this.log(`OnPowerUpdate(${newPower})`);
    if (Number.isNaN(+newPower)) {
      // If newPower is invalid or app is not configured just ignore it
      return Promise.resolve();
    }
    const now = new Date();
    const remainingTime = this.timeToNextHour(now);
    if (this.__current_power === undefined) {
      // First time called ever
      this.__accum_energy = 0;
      this.__current_power = 0;
    } else {
      const lapsedTime = now - this.__current_power_time;
      const energyUsed = (this.__current_power * lapsedTime) / (1000 * 60 * 60);
      this.__accum_energy += energyUsed;
    }
    this.__energy_meter_detected_time = now;
    this.__current_power_time = now;
    this.__current_power = newPower;
    this.__power_estimated = this.__accum_energy + (newPower * remainingTime) / (1000 * 60 * 60);

    // Check if power can be increased or reduced
    const errorMargin = this.homey.settings.get('errorMargin') ? (parseInt(this.homey.settings.get('errorMargin'), 10) / 100) : 0;
    const trueMaxPower = this.homey.settings.get('maxPower');
    const errorMarginWatts = trueMaxPower * errorMargin;
    const maxPower = trueMaxPower - errorMarginWatts;
    const safetyPower = +this.homey.settings.get('safetyPower');

    this.updateLog(`${'onPowerUpdate: '
      + 'Using: '}${String(newPower)}W, `
      + `Accum: ${String(this.__accum_energy.toFixed(2))} Wh, `
      + `Limit: ${String(maxPower)} Wh, `
      + `Reserved: ${String(Math.ceil(this.__reserved_energy + safetyPower))}W, `
      + `(Estimated end: ${String(this.__power_estimated.toFixed(2))})`, c.LOG_DEBUG);

    // Try to control devices if the power is outside of the preferred bounds
    let powerDiff = (((maxPower - this.__accum_energy - this.__reserved_energy) * (1000 * 60 * 60)) / remainingTime) - newPower - safetyPower;
    const mainFuse = this.homey.settings.get('mainFuse'); // Amps
    const maxDrain = Math.round(1.732050808 * 230 * mainFuse);
    const maxFreeDrain = ((isNumber(maxDrain) && (maxDrain > trueMaxPower)) ? maxDrain : (trueMaxPower * 10)) - newPower;
    if (powerDiff > maxFreeDrain) {
      powerDiff = maxFreeDrain; // Cannot use more than the main fuse
    }
    if (powerDiff < -maxDrain) {
      powerDiff = -maxDrain; // If this is the case then we have most likely crossed the power roof already for this hour.
    }
    // Report free capacity:
    this.onFreePowerChanged(powerDiff + safetyPower);
    let promise;
    if (powerDiff < 0) {
      promise = this.onAbovePowerLimit(-powerDiff, errorMarginWatts + safetyPower)
        .catch(() => resolve()); // Ignore failures
    } else if (powerDiff > 0) {
      promise = this.onBelowPowerLimit(powerDiff)
        .catch(() => resolve()); // Ignore failures
    }
    return promise;
  }

  /**
   * onModeUpdate is called whenever the operation mode is changed
   * 0 = off
   * 1+ = modes 0+
   */
  async onModeUpdate(newMode) {
    const oldMode = +this.homey.settings.get('operatingMode');
    const modeList = this.homey.settings.get('modeList');
    if (newMode < 0) {
      newMode = 0;
    }
    if (newMode > modeList.length) {
      newMode = modeList.length;
    }
    if (newMode === oldMode) {
      return Promise.resolve();
    }
    this.updateLog(`Changing the current mode to: ${String(newMode)}`, c.LOG_INFO);
    this.homey.settings.set('operatingMode', newMode);
    if (+newMode === MODE_DISABLED) {
      return Promise.resolve([true, true]);
    }
    return this.refreshAllDevices();
  }

  /**
   * onZoneUpdate is called whenever a zone is turned on/off
   */
  async onZoneUpdate(zone, enabled) {
    this.updateLog(`Changing zone ${zone.name} (ID: ${zone.id}) to ${String(enabled)}`, c.LOG_INFO);
    let activeZones = this.homey.settings.get('zones');
    if (activeZones === null) {
      activeZones = {};
    }
    activeZones[zone.id] = {
      name: zone.name,
      enabled
    };
    this.homey.settings.set('zones', activeZones);

    // Go through all controllable devices
    const promises = [];
    for (const deviceId in this.__deviceList) {
      if (this.__deviceList[deviceId].use
        && this.__deviceList[deviceId].memberOf.includes(zone.id)) {
        promises.push(this.changeDeviceState(deviceId, enabled ? undefined : TURN_OFF));
      }
    }

    // Resolve if the devices was turned on/off correctly
    return Promise.all(promises)
      .then(values => {
        let allOk = true;
        for (let i = 0; i < values.length; i++) {
          allOk &&= values[i][0];
        }
        return Promise.resolve(allOk);
      })
      .catch(error => Promise.reject(new Error(`Unknown error: ${error}`))); // Should never happen
  }

  /**
   * onPricePointUpdate is called whenever the price point is changed
   */
  async onPricePointUpdate(newMode) {
    // Do not continue if price points are disabled:
    if (+this.homey.settings.get('priceMode') === c.PRICE_MODE_DISABLED) {
      return Promise.resolve();
    }
    if (this.gotPPFromFlow === undefined) {
      // Store it in settings as well so it is remembered across reboots, but don't save settings all the time
      this.homey.settings.set('gotPPFromFlow', true);
      this.gotPPFromFlow = true;
    }
    // Do not continue if the price point did not change
    const oldPricePoint = +this.homey.settings.get('pricePoint');
    this.statsSetLastHourPricePoint(oldPricePoint);
    if (+newMode === +oldPricePoint) {
      return Promise.resolve();
    }

    // Find the translation table for price points from the app manifest
    let ppTriggerId = 0;
    const keys = this.manifest.flow.actions;
    for (let key = 0; key < keys.length; key++) if (keys[key].id === 'change-piggy-bank-price-point') ppTriggerId = key;
    const keys2 = this.manifest.flow.actions[ppTriggerId].args[0].values;
    const ppTable = keys2.reduce((outTable, item) => { return { ...outTable, [item.id]: item.label }; }, []);

    // Send price point trigger
    const pricePointTrigger = this.homey.flow.getTriggerCard('price-point-changed');
    const pricePointString = this.homey.__(ppTable[newMode]);
    const tokens = { pricePoint: pricePointString };
    pricePointTrigger.trigger(tokens);

    this.updateLog(`Changing the current price point to: ${String(newMode)}`, c.LOG_INFO);
    this.homey.settings.set('pricePoint', newMode);
    return this.refreshAllDevices();
  }

  /**
   * onMaxUsageUpdate is called whenever the max usage per hour is changed
   */
  async onMaxUsageUpdate(newVal) {
    this.updateLog(`Changing the max usage per hour to: ${String(newVal)}`, c.LOG_INFO);
    this.homey.settings.set('maxPower', newVal);
  }

  /**
   * onSafetyPowerUpdate is called whenever the safety power is changed
   */
  async onSafetyPowerUpdate(newVal) {
    this.updateLog(`Changing the current safety power to: ${String(newVal)}`, c.LOG_INFO);
    this.homey.settings.set('safetyPower', newVal);
  }

  /**
   * onFreePowerChanged is called whenever the amount of free power has changed
   */
  async onFreePowerChanged(powerDiff) {
    // this.log(`OnFreePowerChanged(${powerDiff})`);
    const freeThreshold = +this.homey.settings.get('freeThreshold') || 100;
    const listOfUsedDevices = this.homey.settings.get('frostList') || {};
    const numDevices = Object.keys(listOfUsedDevices).length;
    const percentDevicesOn = (this.__num_off_devices === this.__num_forced_off_devices) ? 100 : (100 * ((numDevices - this.__num_off_devices) / numDevices));
    if (powerDiff < 0) {
      this.__free_capacity = 0;
    } else if (percentDevicesOn >= freeThreshold) {
      this.__free_capacity = powerDiff;
    } else {
      this.__free_capacity = 0;
    }
    // Prevent the trigger from triggering more than once a minute
    const now = new Date();
    const timeSinceLastTrigger = now - this.__free_power_trigger_time;
    if (!timeSinceLastTrigger > (60 * 1000)) {
      this.__free_power_trigger_time = now;
      const freePowerTrigger = this.homey.flow.getTriggerCard('free-power-changed');
      const tokens = { freePower: Math.round(this.__free_capacity) };
      const state = tokens;
      return freePowerTrigger.trigger(tokens, state);
    }
    return Promise.resolve();
  }

  /**
   * onBelowPowerLimit is called whenever power changed and we're allowed to use more power
   */
  async onBelowPowerLimit(morePower) {
    morePower = Math.round(morePower);
    // Reset the power alarm as we now have sufficient power available
    this.__alarm_overshoot = false;

    // If power was turned _OFF_ within the last 1-5 minutes then abort turning on anything.
    // The waiting time is 5 minutes at the beginning of an hour and reduces gradually to 1 minute for the last 5 minutes
    // This is to avoid excessive on/off cycles of high power devices such as electric car chargers
    this.__last_power_on_time = new Date();
    const timeLeftInHour = this.timeToNextHour(this.__last_power_on_time);
    const powerCycleInterval = (timeLeftInHour > TIME_FOR_POWERCYCLE_MAX) ? WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MAX
      : (timeLeftInHour < TIME_FOR_POWERCYCLE_MIN) ? WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MIN
        : (WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MIN + (WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MAX - WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MIN)
          * ((timeLeftInHour - TIME_FOR_POWERCYCLE_MIN) / (TIME_FOR_POWERCYCLE_MAX - TIME_FOR_POWERCYCLE_MIN)));

    const timeSincePowerOff = this.__last_power_on_time - this.__last_power_off_time;
    if (timeSincePowerOff < powerCycleInterval) {
      this.updateLog(`Could use ${String(morePower)} W more power but was aborted due to recent turn off activity. Remaining wait = ${String((5 * 60 * 1000 - timeSincePowerOff) / 1000)} s`,
        c.LOG_DEBUG);
      return Promise.resolve();
    }
    this.updateLog(`Can use ${String(morePower)}W more power`, c.LOG_DEBUG);

    const modeList = this.homey.settings.get('modeList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    const numDevices = currentModeList.length;
    const reorderedModeList = [...currentModeList]; // Make sure all devices with communication errors are handled last (e.g. in case nothing else was possible)
    reorderedModeList.sort((a, b) => { // Err last
      return this.__current_state[a.id].nComError
        - this.__current_state[b.id].nComError;
    });
    // Turn on devices from top down in the priority list
    // Only turn on one device at the time
    let numForcedOffDevices = 0;
    for (let idx = 0; idx < numDevices; idx++) {
      const deviceId = reorderedModeList[idx].id;
      if (!(deviceId in this.__deviceList)) {
        // Apparently the stored settings are invalid and need to be refreshed
        continue;
      }
      // Check if the on state complies with the settings
      switch (reorderedModeList[idx].operation) {
        case CONTROLLED:
        case ALWAYS_ON:
          // Always on is overridden by price actions
          try {
            const [success, noChange] = await this.changeDeviceState(deviceId, TURN_ON);
            if (success && !noChange) {
              // Sucessfully Turned on
              return Promise.resolve();
            } // else try to modify another device
            if (!success) {
              numForcedOffDevices++;
            }
          } catch (err) {
            return Promise.reject(new Error(`Unknown error: ${err}`));
          }
          break;
        case ALWAYS_OFF:
          // Keep off / let it be on if it has been overridden by a user
          break;
        default:
          return Promise.reject(new Error('Invalid operation'));
      }
    }
    // If this point was reached then all devices are on and still below power limit
    this.__num_off_devices = numForcedOffDevices; // Reset the off counter in case it was incorrect
    this.__num_forced_off_devices = numForcedOffDevices;
    return Promise.resolve();
  }

  /**
   * onAbovePowerLimit is called whenever the power changed and we need to reduce it
   */
  async onAbovePowerLimit(lessPower, marginWatts) {
    lessPower = Math.ceil(lessPower);

    // Do not care whether devices was just recently turned on
    this.__last_power_off_time = new Date();

    const modeList = this.homey.settings.get('modeList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    const numDevices = currentModeList.length;
    const reorderedModeList = [...currentModeList]; // Make sure all devices with communication errors are handled last (e.g. in case nothing else was possible)
    reorderedModeList.sort((a, b) => { // Err first
      return this.__current_state[b.id].nComError
        - this.__current_state[a.id].nComError;
    });
    // Turn off devices from bottom and up in the priority list
    // Only turn off one device at the time
    let numForcedOnDevices;
    for (let isEmergency = 0; isEmergency < 2; isEmergency++) {
      numForcedOnDevices = 0;
      for (let idx = numDevices - 1; idx >= 0; idx--) {
        const deviceId = reorderedModeList[idx].id;
        const operation = (isEmergency === 0) ? TURN_OFF : EMERGENCY_OFF;
        // Try to turn the device off regardless, it might be blocked by the state
        if (!(deviceId in this.__deviceList)) {
          // Apparently the stored settings are invalid and need to be refreshed
          continue;
        }
        try {
          const [success, noChange] = await this.changeDeviceState(deviceId, operation);
          if (success && !noChange) {
            // Sucessfully Turned off
            return Promise.resolve();
          }
          if (!success) {
            numForcedOnDevices++;
          }
        } catch (err) {
          return Promise.reject(new Error(`Unknown error: ${err}`));
        }
      }
    }

    // If this point was reached then all devices are off and still above power limit
    const errorString = `Failed to reduce power usage by ${String(lessPower)}W (number of forced on devices: ${String(numForcedOnDevices)})`;
    this.updateLog(errorString, c.LOG_ERROR);
    // Alert the user, but not if first hour since app was started or we are within the error margin. Only send one alert before it has been resolved
    // const firstHourEver = this.__reserved_energy > 0;
    if (/* !firstHourEver && */ (lessPower > marginWatts) && !this.__alarm_overshoot) {
      this.__alarm_overshoot = true;
      // this.homey.notifications.createNotification({ excerpt: `Alert: The power must be reduced by ${String(lessPower)} W immediately or the hourly limit will be breached` });
      const alertTrigger = this.homey.flow.getTriggerCard('unable-to-limit-power');
      const tokens = { excessPower: Math.round(lessPower) };
      alertTrigger.trigger(tokens);
    }
    this.__num_off_devices = numDevices - numForcedOnDevices; // Reset off counter in case it was wrong
    return Promise.reject(new Error(errorString));
  }

  findModeIdx(deviceId) {
    const modeList = this.homey.settings.get('modeList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    for (let i = 0; i < currentModeList.length; i++) {
      if (currentModeList[i].id === deviceId) {
        return i;
      }
    }
    return null; // Nothing found
  }

  /**
   * Find the new target temperature for a device
   * @return [success, noChange] - success means that the result is as requested, noChange indicate if the result was already as requested
   */
  async refreshTemp(deviceId) {
    // Do not refresh temperature if the temperature control is disabled
    if (+this.homey.settings.get('controlTemp') === 0) {
      return Promise.resolve([true, false]);
    }
    const modeList = this.homey.settings.get('modeList');
    const frostList = this.homey.settings.get('frostList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const actionLists = this.homey.settings.get('priceActionList');
    const actionListIdx = +this.homey.settings.get('pricePoint');
    const currentModeList = modeList[currentMode - 1];
    const modeIdx = this.findModeIdx(deviceId);
    const modeTemp = parseInt(currentModeList[modeIdx].targetTemp, 10);
    const currentAction = actionLists[actionListIdx][deviceId]; // Action state: .operation
    const currentPriceMode = +this.homey.settings.get('priceMode');
    const deltaTemp = ((currentPriceMode !== c.PRICE_MODE_DISABLED) && (currentAction.operation === DELTA_TEMP)) ? parseInt(currentAction.delta, 10) : 0;
    return this.homeyApi.devices.getDevice({ id: deviceId })
      .then(device => {
        if (this.getOnOffCap(deviceId) === undefined) {
          return Promise.reject(new Error('The onoff capability is non-existing, this should never happen.'));
        }
        const isOn = this.getIsOn(device, deviceId);
        this.__current_state[deviceId].isOn = isOn;
        if (isOn === undefined) {
          this.updateLog(`Refreshtemp: isOn was set to undefined ${isOn}`, c.LOG_ERROR);
        }
        if (!isOn) return Promise.resolve([true, true]);
        const hasTargetTemp = device.capabilities.includes('target_temperature');
        if (!hasTargetTemp) return Promise.resolve([true, true]);
        const hasMeasureTemp = device.capabilities.includes('measure_temperature');
        if (!hasMeasureTemp) return Promise.resolve([true, true]);
        const frostGuardActive = this.__deviceList[deviceId].thermostat_cap
          ? (device.capabilitiesObj[this.getTempGetCap(deviceId)].value < frostList[deviceId].minTemp) : false;
        let newTemp = frostGuardActive ? frostList[deviceId].minTemp : (modeTemp + deltaTemp);
        const minTemp = this.getTempCapMin(deviceId);
        const maxTemp = this.getTempCapMax(deviceId);
        if (newTemp < minTemp) newTemp = minTemp;
        if (newTemp > maxTemp) newTemp = maxTemp;
        this.__current_state[deviceId].temp = newTemp;
        const tempSetCap = this.getTempSetCap(deviceId);
        if (device.capabilitiesObj[tempSetCap].value === newTemp) return Promise.resolve([true, true]);
        this.__current_state[deviceId].ongoing = true;
        this.__current_state[deviceId].confirmed = false;
        return device.setCapabilityValue({ capabilityId: tempSetCap, value: newTemp })
          .then(() => Promise.resolve([true, false]));
      })
      .then(([success, noChange]) => {
        this.__current_state[deviceId].nComError = 0;
        this.__current_state[deviceId].ongoing = false;
        return Promise.resolve([success, noChange]);
      }).catch(error => {
        this.statsCountFailedTempChange();
        this.__current_state[deviceId].nComError += 1;
        this.__current_state[deviceId].ongoing = undefined;
        this.updateLog(`Failed to set temperature for device ${this.__deviceList[deviceId].name}, will retry later (${error})`, c.LOG_ERROR);
        return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
      });
  }

  /**
   * Refreshes the state of all devices. It will be called when the state has changed
   * This will trigger a full refresh of all the devices.
   */
  async refreshAllDevices() {
    const currentPricePoint = +this.homey.settings.get('pricePoint');
    const currentPriceMode = +this.homey.settings.get('priceMode');

    // Go through all actions for this new mode;
    const actionLists = this.homey.settings.get('priceActionList');
    const currentActions = actionLists[currentPricePoint];
    const promises = [];
    for (const deviceId in currentActions) {
      if (!(deviceId in this.__deviceList)) {
        // Apparently the stored settings are invalid and need to be refreshed
        this.updateLog('A device has been deleted after setup was saved last time, please enter the setup and save the updated config');
        continue;
      }
      const operation = (currentPriceMode === c.PRICE_MODE_DISABLED) ? undefined : currentActions[deviceId].operation;
      switch (operation) {
        case TURN_ON:
        case TURN_OFF:
        case DELTA_TEMP: // Delta temp will abort if the device is off so run changeDevicestate instead
        case undefined: // undefined only means leave it to the changeDeviceState function to decide the operation
          promises.push(this.changeDeviceState(deviceId, operation));
          break;
        case IGNORE:
        case EMERGENCY_OFF:
          // Ignore the device state, it should only be turned off in case of emergency
          break;
        default:
          promises.push(Promise.reject(new Error('Invalid Action')));
          break;
      }
    }
    return Promise.all(promises)
      .then(values => {
        let allOk = true;
        for (let i = 0; i < values.length; i++) {
          allOk &&= values[i][0];
        }
        return Promise.resolve(allOk);
      })
      .catch(error => Promise.reject(error));
  }

  /** ****************************************************************************************************
   * Device handling
   ** ****************************************************************************************************
   */
  getTempSetCap(deviceId) {
    try {
      return d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setTempCap;
    } catch (err) {
      return 'target_temperature';
    }
  }

  getTempCapMin(deviceId) {
    try {
      return d.DEVICE_CMD[this.__deviceList[deviceId].driverId].tempMin;
    } catch (err) {
      return 5;
    }
  }

  getTempCapMax(deviceId) {
    try {
      return d.DEVICE_CMD[this.__deviceList[deviceId].driverId].tempMax;
    } catch (err) {
      return 40;
    }
  }

  getTempGetCap(deviceId) {
    try {
      return d.DEVICE_CMD[this.__deviceList[deviceId].driverId].readTempCap;
    } catch (err) {
      return 'measure_temperature';
    }
  }

  getOnOffCap(deviceId) {
    try {
      return d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setOnOffCap;
    } catch (err) {
      return this.__deviceList[deviceId].onoff_cap;
    }
  }

  getOnOffTrue(deviceId) {
    try {
      return d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setOnValue;
    } catch (err) {
      return true;
    }
  }

  getOnOffFalse(deviceId) {
    try {
      return d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setOffValue;
    } catch (err) {
      return false;
    }
  }

  getIsOn(device, deviceId) {
    const onValue = device.capabilitiesObj[this.getOnOffCap(deviceId)].value;
    if (onValue === this.getOnOffTrue(deviceId)) return true;
    if (onValue === this.getOnOffFalse(deviceId)) return false;
    return undefined;
  }

  /** ****************************************************************************************************
   * HomeyTime
   ** ****************************************************************************************************
   * Handling of insane localtime implementation for Homey.
   * Do NOT use this for anything other than display as it offset the UTC time!!!
   */
  toLocalTime(homeyTime) {
    const tz = this.homey.clock.getTimezone();
    const localTime = new Date(homeyTime.toLocaleString('en-US', { timeZone: tz }));
    return localTime;
  }

  /**
   * Returns the number of milliseconds until next hour
   */
  timeToNextHour(inputTime) {
    return 60 * 60 * 1000
    - inputTime.getMinutes() * 60 * 1000
    - inputTime.getSeconds() * 1000
    - inputTime.getMilliseconds();
  }

  /**
   * Rounds a time object to nearest hour
   */
  roundToNearestHour(date) {
    date.setMinutes(date.getMinutes() + 30);
    date.setMinutes(0, 0, 0);
    return date;
  }

  /**
   * Rounds a time object to start of the day in local time
   */
  roundToStartOfDay(time) {
    const localTime = this.toLocalTime(time);
    const localTimeDiff = Math.round((time.getTime() - localTime.getTime()) / (60 * 60 * 1000));
    localTime.setHours(localTimeDiff, 0, 0, 0);
    return localTime;
  }

  /** ****************************************************************************************************
   * Statistics
   ** ****************************************************************************************************
   * Tracked date:
   * - Power last hour
   * - Price last hour
   * - Price point last hour
   * - Number of failed temp settings
   * - Number of failed turn on's
   * - Number of failed turn off's
   * Output data:
   * - Number of hours with low/high/normal price => Percentage in each mode
   * - Average power for low/hih/normal price => Power moved from high to low price
   * - Average Price for low/high/normal => Money saved moving power
   */

  /**
   * Reset stats - called on app init
   */
  statsInit() {
    this.__stats_failed_turn_on = +this.homey.settings.get('stats_failed_turn_on') | 0;
    this.__stats_failed_turn_off = +this.homey.settings.get('stats_failed_turn_off') | 0;
    this.__stats_failed_temp_change = +this.homey.settings.get('stats_failed_temp_change') | 0;
    this.__statsIntervalID = undefined;
    this.__stats_energy = undefined;
    this.__stats_price = undefined;
    this.__stats_price_point = undefined;
    this.__stats_dirtcheap_energy = this.homey.settings.get('stats_dirtcheap_energy');
    this.__stats_low_energy = this.homey.settings.get('stats_low_energy');
    this.__stats_norm_energy = this.homey.settings.get('stats_norm_energy');
    this.__stats_high_energy = this.homey.settings.get('stats_high_energy');
    this.__stats_extreme_energy = this.homey.settings.get('stats_extreme_energy');
    this.__stats_last_day_max = undefined;
    this.__stats_this_month_maxes = this.homey.settings.get('stats_this_month_maxes'); // Todo: reject if the time is too far away

    this.__stats_cost_if_smooth = undefined;
    this.__stats_savings_yesterday = undefined;
    this.__stats_savings_all_time_use = +this.homey.settings.get('stats_savings_all_time_use') || 0;
    this.__stats_savings_all_time_power_part = +this.homey.settings.get('stats_savings_all_time_power_part') || 0;
    this.__stats_n_hours_today = 0;
    this.__stats_accum_price_today = 0;
    this.__stats_accum_use_today = 0;
    this.__stats_actual_cost = 0;

    if (!Array.isArray(this.__stats_this_month_maxes)) {
      this.__stats_this_month_maxes = [];
    }
    this.__stats_this_month_average = this.homey.settings.get('stats_this_month_average');
    this.__stats_last_month_max = this.homey.settings.get('stats_last_month_max');
    this.__stats_app_restarts = this.homey.settings.get('stats_app_restarts'); // Reset every month
    if (this.__stats_app_restarts === null) {
      this.__stats_app_restarts = 0;
    } else {
      this.__stats_app_restarts = +this.__stats_app_restarts + 1;
    }
    this.homey.settings.set('stats_app_restarts', this.__stats_app_restarts);
    this.statsNewHour();
  }

  /**
   * Deinitializes the stats
   */
  statsUnInit() {
    if (this.__statsIntervalID !== undefined) {
      clearInterval(this.__statsIntervalID);
    }
  }

  /**
   * Various statistic counting functions
   */
  statsCountFailedTurnOn() {
    this.__stats_failed_turn_on += 1;
    this.updateLog(`Signal failures *On:${this.__stats_failed_turn_on} Off:${this.__stats_failed_turn_off} Temp:${this.__stats_failed_temp_change}`);
    this.homey.settings.set('stats_failed_turn_on', this.__stats_failed_turn_on);
  }

  statsCountFailedTurnOff() {
    this.__stats_failed_turn_off += 1;
    this.updateLog(`Signal failures On:${this.__stats_failed_turn_on} *Off:${this.__stats_failed_turn_off} Temp:${this.__stats_failed_temp_change}`);
    this.homey.settings.set('stats_failed_turn_off', this.__stats_failed_turn_off);
  }

  statsCountFailedTempChange() {
    this.__stats_failed_temp_change += 1;
    this.updateLog(`Signal failures On:${this.__stats_failed_turn_on} Off:${this.__stats_failed_turn_off} *Temp:${this.__stats_failed_temp_change}`);
    this.homey.settings.set('stats_failed_temp_change', this.__stats_failed_temp_change);
  }

  // Must only be called once every month
  async statsSetLastMonthPower(energy) {
    const maxPower = this.homey.settings.get('maxPower');
    const overShootAvoided = this.homey.settings.get('overShootAvoided');
    this.__stats_last_month_max = energy;
    this.homey.settings.set('stats_last_month_max', this.__stats_last_month_max);

    // Add savings for power tariff, always assume one step down
    const tariffTable = await this.fetchTariffTable();
    const tariffIndex = this.findTariffIndex(tariffTable, energy);
    const didMeetTariff = (energy < maxPower);
    const avoidedOvershooting = (overShootAvoided <= maxPower);
    if (didMeetTariff && avoidedOvershooting && (tariffIndex < tariffTable.length - 2)) {
      const newSaving = tariffTable[tariffIndex + 1].price - tariffTable[tariffIndex].price;
      this.__stats_savings_all_time_power_part += newSaving;
      this.homey.settings.set('stats_savings_all_time_power_part', this.__stats_savings_all_time_power_part);
    } // else max tariff, nothing saved
  }

  async statsSetLastDayMaxEnergy(timeLastUpdatedUTC, newMonthTriggered) {
    const dailyMax = this.homey.settings.get('stats_daily_max');
    const lastDayLocal = this.toLocalTime(timeLastUpdatedUTC).getDate() - 1;
    this.__stats_last_day_max = dailyMax[lastDayLocal];

    // Keep largest 3 days:
    this.__stats_this_month_maxes.push(dailyMax[lastDayLocal]);
    this.__stats_this_month_maxes.sort((a, b) => b - a);
    if (this.__stats_this_month_maxes.length > 3) {
      this.__stats_this_month_maxes.pop();
    }
    this.__stats_this_month_average = this.__stats_this_month_maxes.reduce((a, b) => a + b, 0) / this.__stats_this_month_maxes.length;
    // On new month:
    if (newMonthTriggered) {
      await this.statsSetLastMonthPower(this.__stats_this_month_average);
      this.__stats_this_month_maxes = [];
      this.__stats_app_restarts = 0;
      this.homey.settings.set('stats_app_restarts', 0);
      this.homey.settings.set('overShootAvoided', 0);
    }
    this.homey.settings.set('stats_this_month_maxes', this.__stats_this_month_maxes);
    this.homey.settings.set('stats_this_month_average', this.__stats_this_month_average);
  }

  /**
   * Called when we have crossed into a new hour
   */
  async statsSetLastHourEnergy(energy, energyOk, timeOfNewHourUTC) {
    if (energyOk) {
      this.__stats_energy_time = this.roundToNearestHour(new Date());
      this.updateLog(`Stats last energy time: ${this.__stats_energy_time}`, c.LOG_INFO);
      this.__stats_energy = energy;
    }

    const hourAgoUTC = new Date(timeOfNewHourUTC.getTime() - (1000 * 60 * 60));
    const lastHourDateLocal = this.toLocalTime(hourAgoUTC).getDate() - 1; // 0-30

    let dailyMax = this.homey.settings.get('stats_daily_max');
    let dailyMaxOk = this.homey.settings.get('stats_daily_max_ok');
    let overShootAvoided = this.homey.settings.get('overShootAvoided');
    const maxPower = this.homey.settings.get('maxPower');
    const dailyMaxPrevUpdateUTC = new Date(this.homey.settings.get('stats_daily_max_last_update_time'));
    const lastHourMissed = (hourAgoUTC - dailyMaxPrevUpdateUTC) > (1000 * 60 * 90); // More than 90 minutes ago
    const firstEverHour = !Array.isArray(dailyMax);
    const newDayTriggered = ((hourAgoUTC - dailyMaxPrevUpdateUTC) > (1000 * 60 * 60 * 24) // More than 24 hours or different day
      || (this.toLocalTime(hourAgoUTC).getDate() !== this.toLocalTime(dailyMaxPrevUpdateUTC).getDate()));
    const newMonthTriggered = ((hourAgoUTC - dailyMaxPrevUpdateUTC) > (1000 * 60 * 60 * 24 * 31) // More than 31 days or different month
      || (this.toLocalTime(hourAgoUTC).getMonth() !== this.toLocalTime(dailyMaxPrevUpdateUTC).getMonth()));
    if (newDayTriggered && !firstEverHour) {
      await this.statsSetLastDayMaxEnergy(dailyMaxPrevUpdateUTC, newMonthTriggered);
    }
    if (firstEverHour || newMonthTriggered) {
      dailyMax = [];
      dailyMaxOk = [];
    }
    dailyMax[lastHourDateLocal] = (dailyMax[lastHourDateLocal] > energy) ? dailyMax[lastHourDateLocal] : energy; // Also set to energy if previous value is undefined
    dailyMaxOk[lastHourDateLocal] = (dailyMaxOk[lastHourDateLocal] !== false) && (energyOk === true) && (lastHourMissed === false); // Need !== false on first to ensure undefined goes to true
    const timeSincePowerOff = this.__last_power_on_time - this.__last_power_off_time;
    overShootAvoided = (energyOk && (energy < maxPower) && (energy > maxPower * 0.9) && (timeSincePowerOff < 1000 * 60 * 15) && (maxPower > +overShootAvoided)) ? maxPower : overShootAvoided;
    this.homey.settings.set('stats_daily_max', dailyMax);
    this.homey.settings.set('stats_daily_max_ok', dailyMaxOk);
    this.homey.settings.set('stats_daily_max_last_update_time', hourAgoUTC);
    this.homey.settings.set('overShootAvoided', overShootAvoided);
  }

  statsSetLastHourPrice(price) {
    this.__stats_price_time = new Date();
    this.updateLog(`Stats price set to: ${this.__stats_price}`, c.LOG_INFO);
    this.__stats_price = price;
  }

  statsSetLastHourPricePoint(pp) {
    this.__starts_price_point_time = new Date();
    this.__stats_price_point = pp;
  }

  statsNewHour() {
    const now = new Date();
    const tenMinutes = 10 * 60 * 1000;

    try {
      // Energy based statistics
      const timeSinceEnergy = now - this.__stats_energy_time;
      if (timeSinceEnergy < tenMinutes) {
        // Only register statistics if reported for the current hour
        let pricePointLastHour;
        const timeSincePricePoint = now - this.__starts_price_point_time;
        if (timeSincePricePoint > tenMinutes) {
          pricePointLastHour = this.__stats_price_point;
        } else {
          pricePointLastHour = +this.homey.settings.get('pricePoint');
        }
        switch (pricePointLastHour) {
          case c.PP_DIRTCHEAP:
            this.__stats_dirtcheap_energy = (!this.__stats_dirtcheap_energy) ? this.__stats_energy : ((+this.__stats_dirtcheap_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_dirtcheap_energy', this.__stats_dirtcheap_energy);
            break;
          case c.PP_LOW:
            this.__stats_low_energy = (!this.__stats_low_energy) ? this.__stats_energy : ((+this.__stats_low_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_low_energy', this.__stats_low_energy);
            break;
          case c.PP_NORM:
            this.__stats_norm_energy = (!this.__stats_norm_energy) ? this.__stats_energy : ((+this.__stats_norm_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_norm_energy', this.__stats_norm_energy);
            break;
          case c.PP_HIGH:
            this.__stats_high_energy = (!this.__stats_high_energy) ? this.__stats_energy : ((+this.__stats_high_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_high_energy', this.__stats_high_energy);
            break;
          case c.PP_EXTREME:
            this.__stats_extreme_energy = (!this.__stats_extreme_energy) ? this.__stats_energy : ((+this.__stats_extreme_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_extreme_energy', this.__stats_extreme_energy);
            break;
          default:
        }
      }

      // Price statistics
      const timeSincePrice = now - this.__stats_price_time;
      if (timeSincePrice < tenMinutes && this.__stats_price && this.__stats_energy) {
        // Calculate how much money has been saved today
        this.__stats_n_hours_today++;
        this.__stats_accum_price_today += this.__stats_price;
        this.__stats_accum_use_today += this.__stats_energy;
        this.__stats_actual_cost += (this.__stats_price * this.__stats_energy) / 1000;
        // If new day
        if (this.toLocalTime(this.__stats_price_time).getHours() === 0
          && this.__stats_n_hours_today > 0) {
          // Accumulate and reset dayliy stats:
          this.__stats_cost_if_smooth = (this.__stats_accum_use_today * (this.__stats_accum_price_today / this.__stats_n_hours_today)) / 1000;
          this.__stats_savings_yesterday = this.__stats_cost_if_smooth - this.__stats_actual_cost;
          if (Number.isFinite(this.__stats_savings_yesterday)) {
            this.__stats_savings_all_time_use += this.__stats_savings_yesterday;
            this.homey.settings.set('stats_savings_all_time_use', this.__stats_savings_all_time_use);
          }
          this.__stats_n_hours_today = 0;
          this.__stats_accum_price_today = 0;
          this.__stats_accum_use_today = 0;
          this.__stats_actual_cost = 0;
        }
      }
    } finally {
      // Start timer to start exactly 5 minutes after the next hour starts
      const timeToNextTrigger = this.timeToNextHour(now) + 5 * 60 * 1000;
      this.__statsIntervalID = setTimeout(() => this.statsNewHour(), timeToNextTrigger);
    }
  }

  async resetStatistics() {
    this.__monitorError = 0;
    this.__stats_app_restarts = 0;
    this.__stats_failed_turn_on = 0;
    this.__stats_failed_turn_off = 0;
    this.__stats_failed_temp_change = 0;
    this.homey.settings.set('stats_app_restarts', this.__stats_app_restarts);
    this.homey.settings.set('stats_failed_turn_on', this.__stats_failed_turn_on);
    this.homey.settings.set('stats_failed_turn_off', this.__stats_failed_turn_off);
    this.homey.settings.set('stats_failed_temp_change', this.__stats_failed_temp_change);
    return Promise.resolve();
  }

  /**
   * Set up arrays for graph generation and return
   * @returns Statistics to generate graphs
   */
  async getStats() {
    const dailyMax = this.homey.settings.get('stats_daily_max');
    const dailyMaxGood = this.homey.settings.get('stats_daily_max_ok');
    const statsTimeLocal = this.toLocalTime(new Date(this.homey.settings.get('stats_daily_max_last_update_time')));
    const daysInStatsMonth = new Date(statsTimeLocal.getFullYear(), statsTimeLocal.getMonth() + 1, 0).getDate();
    const stats = {
      daysInMonth: daysInStatsMonth,
      month: statsTimeLocal.getMonth(),
      dailyMax: Array.isArray(dailyMax) ? dailyMax : [],
      dailyMaxGood: Array.isArray(dailyMaxGood) ? dailyMaxGood : [],
      gridCosts: await this.fetchTariffTable()
    };
    return stats;
  }

  /** ****************************************************************************************************
   *  LOGGING
   ** **************************************************************************************************** */

  logInit() {
    if (this.logInitDone === true) {
      this.log('Init done, so skipping');
      return;
    }
    try {
      this.homeyLog = new Log({ homey: this.homey });
      this.mylog = {};
      this.mylog.diagLog = '';
      this.logInitDone = true;
      this.logLevel = c.LOG_ERROR;
    } catch (err) {
      this.logInitDone = false;
    }
  }

  setLogLevel(newLevel) {
    this.logLevel = +newLevel;
    if (!Number.isInteger(this.logLevel)) this.logLevel = c.LOG_ERROR;
  }

  updateLog(newMessage, ignoreSetting = c.LOG_INFO) {
    if (!this.logInitDone) {
      try {
        this.logInit();
      } catch (err) {
        this.log(`Unable to initialize logging: ${err}`);
        return; // Skip sending log
      }
    }

    if (ignoreSetting > this.logLevel) {
      return;
    }

    if (newMessage !== '') {
      this.log(newMessage);

      let oldText = this.mylog.diagLog || '';
      if (oldText.length > 10000) {
        // Remove the first 5000 characters.
        oldText = oldText.substring(5000);
        const n = oldText.indexOf('\n');
        if (n >= 0) {
          // Remove up to and including the first \n so the log starts on a whole line
          oldText = oldText.substring(n + 1);
        }
      }

      const nowTime = new Date(Date.now());

      if (oldText.length === 0) {
        oldText = `Log ID: ${nowTime.toJSON()}\r\n`;
        oldText += `App version ${Homey.manifest.version}\r\n\r\n`;
      }

      let milliText = nowTime.getMilliseconds().toString();
      if (milliText.length === 2) {
        milliText = `0${milliText}`;
      } else if (milliText.length === 1) {
        milliText = `00${milliText}`;
      }

      oldText += `+${nowTime.getHours()}:${nowTime.getMinutes()}:${nowTime.getSeconds()}.${milliText}: ${newMessage}\r\n`;

      this.mylog.diagLog = oldText;
      this.homeyLog.setExtra({
        diagLog: this.mylog.diagLog
      });
    }

    this.homey.api.realtime('logUpdate', this.mylog.diagLog);
  }

  clearLog() {
    if (!this.logInitDone) {
      try {
        this.logInit();
      } catch (err) {
        this.log(`Unable to initialize logging: ${err}`);
        return;
      }
    }
    this.mylog.diagLog = '';
    this.homey.api.realtime('logUpdate', this.mylog.diagLog);
  }

  async sendLog() {
    if (!this.logInitDone) {
      try {
        this.logInit();
      } catch (err) {
        this.log(`Unable to initialize logging: ${err}`);
        return; // Skip sending log
      }
    }
    // Do not send empty logs
    if (this.mylog.diagLog === '') {
      return;
    }

    let tries = 5;
    while (tries-- > 0) {
      try {
        this.updateLog('Sending log', c.LOG_ERROR);
        // create reusable transporter object using the default SMTP transport
        const transporter = nodemailer.createTransport(
          {
            host: Homey.env.MAIL_HOST, // Homey.env.MAIL_HOST,
            port: 587,
            ignoreTLS: false,
            secure: false, // true for 465, false for other ports
            auth:
            {
              user: Homey.env.MAIL_USER, // generated ethereal user
              pass: Homey.env.MAIL_SECRET // generated ethereal password
            },
            tls:
            {
              // do not fail on invalid certs
              rejectUnauthorized: false
            }
          }
        );

        // send mail with defined transport object
        const mailMessage = {
          from: `"Homey User" <${Homey.env.MAIL_USER}>`, // sender address
          to: Homey.env.MAIL_RECIPIENT, // list of receivers
          subject: 'Sparegris log', // Subject line
          text: String(this.mylog.diagLog) // plain text body
        };
        this.log(`message: ${JSON.stringify(mailMessage)}`);
        const info = await transporter.sendMail(mailMessage);

        this.updateLog(`Message sent: ${info.messageId}`, c.LOG_INFO);
        // Preview only available when sending through an Ethereal account
        this.log('Preview URL: ', nodemailer.getTestMessageUrl(info));
        return;
      } catch (err) {
        this.updateLog(`Send log error: ${err.stack}`, c.LOG_ERROR);
      }
    }
    this.updateLog('Send log FAILED', c.LOG_ERROR);
  }

  async logShowState() {
    const frostList = this.homey.settings.get('frostList');
    const numControlledDevices = Array.isArray(frostList) ? Object.keys(frostList).length : 0;
    this.updateLog('========== INTERNAL STATE ==========', c.LOG_ALL);
    this.updateLog(`Number of devices under control: ${numControlledDevices}`, c.LOG_ALL);
    this.updateLog(`Current operating mode: ${this.homey.settings.get('operatingMode')}`, c.LOG_ALL);
    this.updateLog(`Current price mode: ${this.homey.settings.get('priceMode')}`, c.LOG_ALL);
    this.updateLog(`Current price point: ${this.homey.settings.get('pricePoint')}`, c.LOG_ALL);
    this.updateLog(`Total signal failures On:${this.__stats_failed_turn_on} Off:${this.__stats_failed_turn_off} Temp:${this.__stats_failed_temp_change}`, c.LOG_ALL);
    this.updateLog(`Total number of monitor errors: ${this.__monitorError}`, c.LOG_ALL);
    this.updateLog('Device Name               | Location        | Is On      | Temperature | Com errors | Ongoing', c.LOG_ALL);
    for (const deviceId in frostList) {
      if (!(deviceId in this.__deviceList) || this.__deviceList[deviceId].use === false) continue;
      const { name, room } = this.__deviceList[deviceId];
      const { isOn, nComError } = this.__current_state[deviceId];
      const { temp, ongoing, confirmed } = this.__current_state[deviceId];
      const { __monitorError, __monitorFixTemp, __monitorFixOn } = this.__current_state[deviceId];
      this.homeyApi.devices.getDevice({ id: deviceId })
        .then(device => {
          const isOnActual = (this.getOnOffCap(deviceId) === undefined) ? undefined : this.getIsOn(device, deviceId);
          const tempTargetCap = this.getTempSetCap(deviceId);
          const tempMeasureCap = this.getTempGetCap(deviceId);
          const tempActualTarget = (tempTargetCap in device.capabilitiesObj) ? device.capabilitiesObj[tempTargetCap].value : 'undef';
          const tempActualMeasure = (tempMeasureCap in device.capabilitiesObj) ? device.capabilitiesObj[tempMeasureCap].value : 'undef';
          this.updateLog(`${String(name).padEnd(25)} | ${String(room).padEnd(15)} | ${String(isOn).padEnd(10)} | ${
            String(temp).padStart(11)} | ${String(nComError).padStart(10)} | ${String(ongoing).padEnd(7)}`, c.LOG_ALL);
          this.updateLog(`${String('--->Actual').padEnd(13)} - Errs: ${String(__monitorError).padEnd(3)} | ${
            String(__monitorFixOn).padEnd(7)},${String(__monitorFixTemp).padEnd(7)} | ${String(isOnActual).padEnd(10)} | ${
            String(tempActualMeasure).padStart(5)}/${String(tempActualTarget).padStart(5)} | ${''.padStart(10)} | ${String(confirmed).padEnd(7)}`, c.LOG_ALL);
        })
        .catch(err => {
          this.log(`Error log failed for device with name: ${name}`);
        });
    }
    this.updateLog('======== INTERNAL STATE END ========', c.LOG_ALL);
  }

  async logShowCaps(deviceId, filter) {
    const problems = [
      'No device',
      'Experimental device is working',
      'Device is not being turned on/off',
      'Device does not set temperature',
      'Device is not listed'
    ];
    const flows = await this.homeyApi.flow.getFlowCardActions(); // TBD: Remove???
    await this.homeyApi.devices.getDevice({ id: deviceId })
      .then(device => {
        this.updateLog('----- ANALYZING DEVICE -----', c.LOG_ALL);
        this.updateLog(`Report type: ${problems[filter]}`, c.LOG_ALL);
        this.updateLog(`Device ID:   ${deviceId}`, c.LOG_ALL);
        this.updateLog(`Device Name: ${device.name}`, c.LOG_ALL);
        try {
          this.updateLog(`Driver Uri: ${device.driverUri}`, c.LOG_ALL);
          this.updateLog(`Driver Id: ${device.driverId}`, c.LOG_ALL);
          this.updateLog(`Found onoff cap: ${this.__deviceList[deviceId].onoff_cap}`, c.LOG_ALL);
          this.updateLog(`Found temp cap: ${this.__deviceList[deviceId].thermostat_cap}`, c.LOG_ALL);
        } catch (err) {
          this.updateLog(`Error: ${err}`, c.LOG_ERROR);
        } // Ignore

        this.updateLog(`Capabilities: ${String(device.capabilities)}`, c.LOG_ALL);
        for (const capIdx in Object.keys(device.capabilities)) {
          const cap = device.capabilities[capIdx];
          let opts;
          try {
            opts = JSON.stringify(device.capabilitiesObj[cap]);
          } catch (err) {
            opts = `Error: ${err}`;
          }
          this.updateLog(`Options for '${cap}': ${opts}`, c.LOG_ALL);
        }

        this.updateLog('Actions:', c.LOG_ALL); // TBD: Remove???
        for (let i = 0; i < flows.length; i++) {
          if (flows[i].uri === `homey:device:${deviceId}` || flows[i].uri === `${device.driverUri}`) {
            this.updateLog(`URI: ${JSON.stringify(flows[i])}`, c.LOG_ALL);
          }
        }
      })
      .catch(err => {
        this.log(`Failed to fetch devicelist: ${err}`);
      })
      .finally(done => {
        this.updateLog('--- ANALYZING DEVICE DONE ---', c.LOG_ALL);
      });
  }

  async logShowPriceApi() {
    this.updateLog('========== UTILITYCOST INTEGRATION ==========', c.LOG_ALL);
    const apiState = await this._checkApi();
    const installed = await this.elPriceApi.getInstalled();
    const version = await this.elPriceApi.getVersion();
    const prices = await this.elPriceApi.get('/prices');
    const gridcosts = await this.elPriceApi.get('gridcosts');
    if (this.apiState === c.PRICE_API_NO_APP) this.updateLog('No Api or wrong version');
    if (this.apiState === c.PRICE_API_NO_DEVICE) this.updateLog('No device found');
    this.updateLog(`ApiState: ${apiState}`, c.LOG_ALL);
    this.updateLog(`Installed: ${installed}`, c.LOG_ALL);
    this.updateLog(`Version: ${version}`, c.LOG_ALL);
    this.updateLog(`Prices: ${JSON.stringify(prices)}`, c.LOG_ALL);
    this.updateLog(`GridCosts: ${JSON.stringify(gridcosts)}`, c.LOG_ALL);
    this.updateLog('======== UTILITYCOST INTEGRATION END ========', c.LOG_ALL);
  }

  /** ****************************************************************************************************
   *  DEVICE API's
   ** **************************************************************************************************** */
  async getState() {
    let listOfUsedDevices = await this.homey.settings.get('frostList');
    if (listOfUsedDevices === null) {
      listOfUsedDevices = {};
    }
    if (this.apiState !== c.PRICE_API_OK) {
      this.apiState = await this._checkApi();
    }
    const priceMode = +this.homey.settings.get('priceMode');
    const appState = (this.__deviceList === undefined) ? c.APP_NOT_READY
      : ((priceMode === c.PRICE_MODE_INTERNAL) && (this.apiState === c.PRICE_API_NO_APP)) ? c.APP_MISSING_PRICE_API
        : ((priceMode === c.PRICE_MODE_INTERNAL) && (this.apiState === c.PRICE_API_NO_DEVICE)) ? c.APP_MISSING_PRICE_DEVICE
          : ((priceMode === c.PRICE_MODE_INTERNAL) && (this.apiState === c.PRICE_API_NO_DATA)) ? c.APP_MISSING_PRICE_DATA
            : c.APP_READY;
    return {
      power_last_hour: parseInt(this.__power_last_hour, 10),
      power_estimated: this.__power_estimated === undefined ? undefined : parseInt(this.__power_estimated.toFixed(2), 10),
      price_point: +await this.homey.settings.get('pricePoint'),
      operating_mode: +await this.homey.settings.get('operatingMode'),
      alarm_overshoot: this.__alarm_overshoot,
      free_capacity: this.__free_capacity,
      num_devices: Object.keys(listOfUsedDevices).length,
      num_devices_off: this.__num_off_devices,
      safety_power: parseInt(await this.homey.settings.get('safetyPower'), 10),
      num_fail_on: this.__stats_failed_turn_on,
      num_fail_off: this.__stats_failed_turn_off,
      num_fail_temp: this.__stats_failed_temp_change,
      dirtcheap_price_energy_avg: this.__stats_dirtcheap_energy,
      low_price_energy_avg: this.__stats_low_energy,
      norm_price_energy_avg: this.__stats_norm_energy,
      high_price_energy_avg: this.__stats_high_energy,
      extreme_price_energy_avg: this.__stats_extreme_energy,
      power_yesterday: this.__stats_last_day_max,
      power_average: this.__stats_this_month_average,
      power_last_month: this.__stats_last_month_max,
      num_restarts: this.__stats_app_restarts,

      average_price: +await this.homey.settings.get('averagePrice') || undefined,
      current_price: this.__current_prices[this.__current_price_index],
      dirtcheap_price_limit: this.__dirtcheap_price_limit,
      low_price_limit: this.__low_price_limit,
      high_price_limit: this.__high_price_limit,
      extreme_price_limit: this.__extreme_price_limit,
      savings_yesterday: this.__stats_savings_yesterday,
      savings_all_time_use: this.__stats_savings_all_time_use,
      savings_all_time_power_part: this.__stats_savings_all_time_power_part,

      appState
    };
  }

  /**
   * API part developed for internal use
   */
  async getDevices(type) {
    const retval = [];
    await this.homeyApi.devices.getDevices()
      .then(devices => {
        // Loop all devices
        for (const device of Object.values(devices)) {
          const deviceId = device.id;
          const onoffCap = (deviceId in this.__deviceList) ? this.__deviceList[deviceId].onoff_cap : undefined;
          const isExperimental = (deviceId in this.__deviceList)
            && (!(this.__deviceList[deviceId].driverId in d.DEVICE_CMD)
              || (d.DEVICE_CMD[this.__deviceList[deviceId].driverId].beta === true));
          if ((onoffCap === undefined && +type === 4) // Not listed
            || (onoffCap !== undefined && +type === 2) // Onoff problem
            || (onoffCap !== undefined && +type === 1 && isExperimental) // Experimental device
            || (onoffCap !== undefined && +type === 3) // Temp problem
          ) {
            retval.push({ name: device.name, value: device.id });
          }
        }
      })
      .catch(err => {
        this.log(`Failed to fetch devicelist: ${err}`);
      });
    return retval;
  }

  /** ****************************************************************************************************
   *  Price Handling
   ** **************************************************************************************************** */
  async _checkApi() {
    try {
      this.elPriceApi = this.homey.api.getApiApp('no.almli.utilitycost');
      const isInstalled = await this.elPriceApi.getInstalled();
      const version = await this.elPriceApi.getVersion();
      if (isInstalled && !!version) {
        const split = version.split('.');
        const apiOk = (Number(split[0]) >= 1 && Number(split[1]) >= 5);
        const testData = await this.elPriceApi.get('/prices');
        const deviceOk = apiOk ? (testData !== undefined) : false;
        const dataOk = deviceOk ? (Array.isArray(testData) && testData.length > 0) : false;
        this.updateLog(`Electricity price api version ${version} installed${apiOk ? ' and version is ok' : ', but wrong version'}. Device ${deviceOk ? 'is installed and ok'
          : 'must be installed'}. Data ${dataOk ? 'was returned' : 'was not returned'}.`, c.LOG_INFO);
        return dataOk ? c.PRICE_API_OK : deviceOk ? c.PRICE_API_NO_DATA : apiOk ? c.PRICE_API_NO_DEVICE : c.PRICE_API_NO_APP;
      }
      this.updateLog('Electricity price api not installed', c.LOG_ERROR);
    } catch (err) {
      this.updateLog(`Failed checking electricity price API: ${err.message}`, c.LOG_ERROR);
      this.updateLog('Please install the app "Strømregning" to fetch electricity prices', c.LOG_ERROR);
    }
    return c.PRICE_API_NO_APP;
  }

  /**
   * currentPrices - assumes that the api check has already been done
   * @returns an array where the first price is always the current hour
   */
  async currentPrices() {
    try {
      const now = new Date();
      const nowSeconds = now.getTime() / 1000;
      const todayStart = this.roundToStartOfDay(now).getTime() / 1000;
      let newestPriceWeGot = 0;
      // First delete prices older than today
      if (!Array.isArray(this.__all_prices)) {
        this.__all_prices = [];
      }
      for (let i = this.__all_prices.length - 1; i >= 0; i--) {
        if (this.__all_prices[i].time < todayStart) {
          this.__all_prices.splice(i, 1);
        } else if (this.__all_prices[i].time > newestPriceWeGot) {
          newestPriceWeGot = this.__all_prices[i].time;
        }
      }
      // If it is midnight then wait 2 minutes for the price api to update its prices.
      const delay = ms => new Promise(res => setTimeout(res, ms));
      if ((nowSeconds - (15 * 60)) < todayStart) {
        await delay(2 * 60 * 1000);
      }
      // Fetch new prices if needed and add them
      if (this.__all_prices.length < 24) {
        const futurePrices = await this.elPriceApi.get('/prices');
        if (Array.isArray(futurePrices)) {
          for (let i = 0; i < futurePrices.length; i++) {
            if (futurePrices[i].time > newestPriceWeGot) {
              this.__all_prices.push(futurePrices[i]);
            }
          }
          // Probably not necessary to sort but do it just in case
          this.__all_prices.sort((a, b) => {
            return a.time - b.time;
          });
        }
      }
      this.homey.settings.set('all_prices', this.__all_prices);
      // Analyze the prizes we got and return 24 values only (today prices)
      const pricesOnly = [];
      let currentIndex = 0;
      const nPricesToAdd = Math.min(this.__all_prices.length, 24);
      for (let i = 0; i < nPricesToAdd; i++) {
        pricesOnly.push(this.__all_prices[i].price);
        if ((nowSeconds - 3600) > this.__all_prices[i].time) {
          currentIndex++;
        }
      }
      return { prices: pricesOnly, now: currentIndex };
    } catch (err) {
      this.updateLog(`Electricity price api failed: ${err.message}`, c.LOG_ERROR);
      return { prices: [], now: undefined };
    }
  }

  /**
   * Called once every hour (and when app starts)
   */
  async doPriceCalculations() {
    // Abort if prices are not available
    this.apiState = await this._checkApi();
    if (this.apiState === c.PRICE_API_NO_APP) return Promise.reject(new Error(this.homey.__('warnings.noPriceApi')));
    if (this.apiState === c.PRICE_API_NO_DEVICE) return Promise.reject(new Error(this.homey.__('warnings.noPriceApiDevice')));
    if (this.apiState === c.PRICE_API_NO_DATA) return Promise.reject(new Error(this.homey.__('warnings.noPriceApiData')));

    if (this.__current_prices && this.__current_price_index) {
      this.__last_hour_price = this.__current_prices[this.__current_price_index];
    } else {
      this.__last_hour_price = undefined;
    }
    const priceInfo = await this.currentPrices();
    this.__current_prices = priceInfo.prices;
    this.__current_price_index = priceInfo.now;

    this.statsSetLastHourPrice(this.__last_hour_price);

    // === Calculate price point if state is internal and have future prices ===
    const futurePriceOptions = this.homey.settings.get('futurePriceOptions');
    if (this.__current_prices.length < 1
      || +this.homey.settings.get('priceMode') !== c.PRICE_MODE_INTERNAL) {
      return Promise.resolve();
    }
    if (!this.app_is_configured) {
      return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
    }
    const hoursInInterval = +futurePriceOptions.averageTime * 24;
    let averagePrice = +this.homey.settings.get('averagePrice') || undefined;
    if (!Number.isInteger(hoursInInterval)
      || hoursInInterval === 0
      || typeof (averagePrice) !== 'number'
      || !Number.isFinite(averagePrice)) {
      // Use today price average
      averagePrice = this.__current_prices.reduce((a, b) => a + b, 0) / this.__current_prices.length; // Should always be divide by 24
    } else {
      // Calculate average price over time
      averagePrice = (averagePrice * (hoursInInterval - 1) + this.__current_prices[this.__current_price_index]) / hoursInInterval;
    }

    this.homey.settings.set('averagePrice', averagePrice);
    // Calculate min/max limits
    this.__dirtcheap_price_limit = averagePrice * (+futurePriceOptions.dirtCheapPriceModifier / 100 + 1);
    this.__low_price_limit = averagePrice * (+futurePriceOptions.lowPriceModifier / 100 + 1);
    this.__high_price_limit = averagePrice * (+futurePriceOptions.highPriceModifier / 100 + 1);
    this.__extreme_price_limit = averagePrice * (+futurePriceOptions.extremePriceModifier / 100 + 1);

    // If min/max limit does not encompas enough hours, change the limits
    const orderedPriceTable = [...this.__current_prices].sort();
    const lowPriceIndex = +futurePriceOptions.minCheapTime;
    const highPriceIndex = 23 - futurePriceOptions.minExpensiveTime;
    if (this.__low_price_limit < orderedPriceTable[lowPriceIndex]) {
      this.__low_price_limit = orderedPriceTable[lowPriceIndex];
      if (this.__low_price_limit > this.__high_price_limit) {
        this.__high_price_limit = this.__low_price_limit;
      }
      if (this.__low_price_limit > this.__extreme_price_limit) {
        this.__extreme_price_limit = this.__low_price_limit;
      }
    }
    if (this.__high_price_limit > orderedPriceTable[highPriceIndex]) {
      this.__high_price_limit = orderedPriceTable[highPriceIndex];
      if (this.__low_price_limit > this.__high_price_limit) {
        this.__low_price_limit = this.__high_price_limit;
      }
      if (this.__dirtcheap_price_limit > this.__high_price_limit) {
        this.__dirtcheap_price_limit = this.__high_price_limit;
      }
    }

    // Trigger new Price points
    const isDirtCheapPrice = (this.__current_prices[this.__current_price_index] < this.__dirtcheap_price_limit);
    const isLowPrice = (this.__current_prices[this.__current_price_index] < this.__low_price_limit);
    const isHighPrice = (this.__current_prices[this.__current_price_index] > this.__high_price_limit);
    const isExtremePrice = (this.__current_prices[this.__current_price_index] > this.__extreme_price_limit) && Number.isInteger(+futurePriceOptions.extremePriceModifier);
    const mode = isDirtCheapPrice ? c.PP_DIRTCHEAP
      : isLowPrice ? c.PP_LOW
        : isExtremePrice ? c.PP_EXTREME
          : isHighPrice ? c.PP_HIGH
            : c.PP_NORM;
    if (!preventZigbee) {
      return this.onPricePointUpdate(mode);
    }
    return Promise.resolve();
  }

  async fetchTariffTable() {
    const tensioGridCosts = [
      { limit: 2000, price: 73 },
      { limit: 5000, price: 128 },
      { limit: 10000, price: 219 },
      { limit: 15000, price: 323 },
      { limit: 20000, price: 426 },
      { limit: 25000, price: 530 },
      { limit: 50000, price: 911 },
      { limit: 75000, price: 1430 },
      { limit: 100000, price: 1950 },
      { limit: 150000, price: 2816 },
      { limit: 200000, price: 3855 },
      { limit: 300000, price: 5586 },
      { limit: 400000, price: 7665 },
      { limit: 500000, price: 9743 },
      { limit: Infinity, price: 11821 }
    ];
    try {
      this.apiState = await this._checkApi();
      if (this.apiState === c.PRICE_API_OK) {
        const gridFromApi = await this.elPriceApi.get('/gridcosts');
        if (Array.isArray(gridFromApi) && gridFromApi.length > 0) {
          this.homey.settings.set('gridCosts', gridFromApi);
          return gridFromApi;
        }
      }
    } catch (err) {
      // API call probably timed out
      const oldGridCost = this.homey.settings.get('gridCosts');
      if (oldGridCost !== null) {
        return oldGridCost;
      }
    }
    // Could not fetch the table, using tensio price table instead.
    this.homey.settings.set('gridCosts', tensioGridCosts);
    return tensioGridCosts;
  }

  findTariffIndex(tariffTable, energy) {
    for (let i = 0; i < tariffTable.length; i++) {
      if (energy < tariffTable[i].limit) {
        return i;
      }
    }
    return tariffTable.length - 1;
  }

} // class

module.exports = PiggyBank;
