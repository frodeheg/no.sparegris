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

const WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MIN = 1 * 60 * 1000; // Wait 1 minute
const WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MAX = 5 * 60 * 1000; // Wait 5 minutes
const TIME_FOR_POWERCYCLE_MIN = 5 * 60 * 1000; // 5 minutes left
const TIME_FOR_POWERCYCLE_MAX = 30 * 60 * 1000; // more than 30 minutes left

// Logging classes
const LOG_ERROR = 0;
const LOG_INFO = 1;
const LOG_DEBUG = 2;

// Operations for controlled devices
const ALWAYS_OFF = 0;
const ALWAYS_ON = 1;
const CONTROLLED = 2;

const TURN_ON = 0;
const TURN_OFF = 1;
const DELTA_TEMP = 2;
const EMERGENCY_OFF = 3;
const IGNORE = 4;

// Price points
const PP_LOW = 0;
const PP_NORM = 1;
const PP_HIGH = 2;
const PP_EXTREME = 3;

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
      if (modeList.length !== 4
        || actionList.length < 3) return false; // Do not complain about actionList missing for extremely high prices as this could cause older versions of the app to fail
      if (modeList[0].length !== numControlledDevices
        || modeList[1].length !== numControlledDevices
        || modeList[2].length !== numControlledDevices
        || modeList[3].length !== numControlledDevices
        || Object.keys(actionList[0]).length !== numControlledDevices
        || Object.keys(actionList[1]).length !== numControlledDevices
        || Object.keys(actionList[2]).length !== numControlledDevices) return false;
    } catch (err) {
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
    // ===== BREAKING CHANGES END =====

    /* DEBUG_BEGIN
    // // In case of debug
    if (this.homey.app.manifest.id === 'no.sparegris2') {
      this.log('===== DEBUG MODE =====');
      // const settings = this.homey.settings.getKeys();
      // this.log(`Settings being deleted: ${JSON.stringify(settings)}`);
      // for (let i = 0; i < settings.length; i++) {
      //   this.homey.settings.unset(settings[i]);
      // }
    }
    DEBUG_END */

    // ===== KEEPING STATE ACROSS RESTARTS =====
    if (this.homey.settings.get('safeShutdown__current_power') !== null) {
      // For onPowerUpdate + onNewHour
      this.__accum_energy = +await this.homey.settings.get('safeShutdown__accum_energy');
      this.__current_power = +await this.homey.settings.get('safeShutdown__current_power');
      this.__current_power_time = new Date(await this.homey.settings.get('safeShutdown__current_power_time'));
      this.__power_last_hour = +await this.homey.settings.get('safeShutdown__power_last_hour');
      this.homey.settings.unset('safeShutdown__accum_energy');
      this.homey.settings.unset('safeShutdown__current_power');
      this.homey.settings.unset('safeShutdown__current_power_time');
      this.homey.settings.unset('safeShutdown__power_last_hour');
      this.updateLog(`Restored state from safe shutdown values ${this.__accum_energy} ${this.__current_power} ${this.__current_power_time} ${this.__power_last_hour}`, LOG_INFO);
    } else {
      this.updateLog('No state from previous shutown? Powerloss, deactivated or forced restart.', LOG_INFO);
    }
    // ===== KEEPING STATE ACROSS RESTARTS END =====
    this.logInit();
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
      this.updateLog(`Homey reboot detected. Delaying device control by ${timeToPreventZigbee} seconds to improve Zigbee recovery.`, LOG_ERROR);
      setTimeout(() => {
        this.updateLog('Device constrol is once again enabled.', LOG_INFO);
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
      this.updateLog(`Total energy changed to: ${String(newTotal)}`, LOG_INFO);
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
    const cardActionPricePointUpdate = this.homey.flow.getActionCard('change-piggy-bank-price-point');
    cardActionPricePointUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      if (+this.homey.settings.get('priceMode') !== c.PRICE_MODE_FLOW) return Promise.reject(new Error(this.homey.__('warnings.notPMfromFlow')));
      if (+args.mode === PP_EXTREME && this.homey.settings.get('priceActionList').length === 3) return Promise.reject(new Error(this.homey.__('warnings.notConfigured'))); // Added in version 0.8.15
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

    this.homey.settings.on('set', setting => {
      if (setting === 'deviceListRefresh') {
        const doRefresh = this.homey.settings.get('deviceListRefresh');
        if (doRefresh === 'true') {
          try {
            this.createDeviceList();
          } catch (err) {
            // In case refreshing the devicelist failed we just reuse the device list from when the app was initialized
          }
        }
      } else if (setting === 'settingsSaved') {
        const doRefresh = this.homey.settings.get('settingsSaved');
        if (doRefresh === 'true') {
          this.updateLog('Settings saved, refreshing all devices.', LOG_INFO);
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

    this.updateLog('PiggyBank has been initialized', LOG_INFO);
    return Promise.resolve();
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
   * It is for this reason essential that the code is safe t
   */
  async onUninit() {
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

    // ===== KEEPING STATE ACROSS RESTARTS =====
    // For onPowerUpdate + onNewHour
    this.homey.settings.set('safeShutdown__accum_energy', this.__accum_energy);
    this.homey.settings.set('safeShutdown__current_power', this.__current_power);
    this.homey.settings.set('safeShutdown__current_power_time', this.__current_power_time);
    this.homey.settings.set('safeShutdown__power_last_hour', this.__power_last_hour);
    // ===== KEEPING STATE ACROSS RESTARTS END =====

    this.updateLog('PiggyBank has been uninitialized', LOG_INFO);
  }

  /**
   * Create a list of relevant devices
   */
  async createDeviceList() {
    // Call APIs
    const devices = await this.homeyApi.devices.getDevices(); // Error thrown is catched by caller of createDeviceList
    const zones = await this.homeyApi.zones.getZones(); // Error thrown is catched by caller of createDeviceList
    // Note: The API calls above might time out, in which case the rest of the function will never be executed.

    const relevantDevices = {};

    // Loop all devices
    for (const device of Object.values(devices)) {
      // Relevant Devices must have an onoff capability
      // Unfortunately some devices like the SensiboSky heat pump controller invented their own onoff capability
      // so unless specially handled the capability might not be detected. The generic detection mechanism below
      // has only been tested on SensiboSky devices so there might be problems with other devices with custom onoff capabilities
      let onoffCap = device.capabilities.includes('onoff') ? 'onoff' : device.capabilities.find(cap => cap.includes('onoff'));
      if ((onoffCap === undefined) && device.capabilities.includes('enabled')) {
        onoffCap = 'enabled';
      }
      if (onoffCap === undefined) {
        this.updateLog(`ignoring: ${device.name}`, LOG_DEBUG);
        if (device.name === 'Varmepumpe') {
          this.updateLog('Capabilities ======', LOG_DEBUG);
          this.updateLog(String(device.capabilities), LOG_DEBUG);
        }
        continue;
      }
      // Priority 1 devices has class = thermostat & heater - capabilities ['target_temperature' + 'measure_temperature']
      const priority = (device.capabilities.includes('target_temperature') ? 1 : 0)
        + (device.capabilities.includes('measure_temperature') ? 1 : 0)
        + ((device.class === 'thermostat' || device.class === 'heater') ? 1 : 0);

      // Filter out irrelevant devices (check old device list if possible)
      let useDevice = false;
      const oldDeviceList = this.homey.settings.get('deviceList');
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

      this.updateLog(`Device: ${String(priority)} ${device.id} ${device.name} ${device.class}`, LOG_DEBUG);
      const thermostatCap = device.capabilities.includes('target_temperature')
        && device.capabilities.includes('measure_temperature');
      // device.capabilitiesObj should be available but in case homey timed out it could be incomplete
      const targetTemp = (thermostatCap && device.capabilitiesObj && ('target_temperature' in device.capabilitiesObj))
        ? +device.capabilitiesObj['target_temperature'].value : 24;
      const relevantDevice = {
        priority: (priority > 0) ? 1 : 0,
        name: device.name,
        room: device.zoneName,
        roomId: device.zone,
        memberOf: memberOfZones,
        image: device.iconObj == null ? null : device.iconObj.url,
        onoff_cap: onoffCap,
        thermostat_cap: thermostatCap,
        targetTemp,
        use: useDevice
      };
      relevantDevices[device.id] = relevantDevice;
    }
    this.__deviceList = relevantDevices;

    this.homey.settings.set('deviceList', this.__deviceList);

    // Refresh current state:
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

    // This shouldn't be done here but is needed as the ApiStatus must be sent to the setup page
    let futurePriceOptions = this.homey.settings.get('futurePriceOptions');
    if (!futurePriceOptions) futurePriceOptions = {};
    this.homey.settings.set('futurePriceOptions', futurePriceOptions);

    const appConfigProgress = {};
    this.apiState = await this._checkApi();
    appConfigProgress.energyMeterNotConnected = (this.__energy_meter_detected_time === undefined);
    appConfigProgress.timeSinceEnergyMeter = ((new Date() - this.__energy_meter_detected_time) / 1000);
    appConfigProgress.gotPPFromFlow = this.homey.settings.get('gotPPFromFlow') === 'true';
    appConfigProgress.ApiStatus = this.apiState;
    this.homey.settings.set('appConfigProgress', appConfigProgress);

    this.homey.settings.set('deviceListRefresh', 'done');
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
  async changeDeviceState(deviceId, newState) {
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
    if (newState === undefined) {
      switch (currentActionOp) {
        case DELTA_TEMP:
          // Override as changedevicestate only handles onoff
          newState = TURN_ON;
          break;
        default:
          newState = currentActionOp;
      }
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
      this.updateLog(`Device cannot be fetched. ${String(err)}`, LOG_ERROR);
      this.__current_state[deviceId].nComError += 10; // Big error so wait more until retry than smaller errors
      return Promise.resolve([false, false]); // The unhandled device is solved by the later nComError handling
    }
    const frostList = this.homey.settings.get('frostList');
    const frostGuardActive = this.__deviceList[deviceId].thermostat_cap
      ? (device.capabilitiesObj['measure_temperature'].value < frostList[deviceId].minTemp) : false;

    if (this.__deviceList[deviceId].onoff_cap === undefined) return Promise.reject(new Error('onoff capability does not exist, this should not happen'));
    const isOn = await device.capabilitiesObj[this.__deviceList[deviceId].onoff_cap].value;
    const activeZones = this.homey.settings.get('zones');
    const newStateOn = frostGuardActive
      || (currentActionOp !== TURN_OFF && currentActionOp !== EMERGENCY_OFF
        && !this.__deviceList[deviceId].memberOf.some(z => (activeZones.hasOwnProperty(z) && !activeZones[z].enabled))
        && ((newState === TURN_ON && currentModeState !== ALWAYS_OFF) || (newState === TURN_OFF && currentModeState === ALWAYS_ON)));

    this.__current_state[deviceId].isOn = newStateOn;
    if (newStateOn === undefined) {
      this.updateLog(`isOn was set to undefined ${frostGuardActive}`, LOG_ERROR);
    }
    this.__current_state[deviceId].ongoing = false; // If already ongoing then it should already have been completed, try again
    if (newStateOn && !isOn) {
      // Turn on
      const deviceName = this.__deviceList[deviceId].name;
      this.updateLog(`Turning on device: ${deviceName}`, LOG_INFO);
      this.__current_state[deviceId].ongoing = true;
      this.__current_state[deviceId].confirmed = false;
      return device.setCapabilityValue({ capabilityId: this.__deviceList[deviceId].onoff_cap, value: true })
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
          this.updateLog(`Failed to turn on device ${deviceName}, will retry later`, LOG_ERROR);
          return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
        });
    } // ignore case !wantOn && isOn

    if (!newStateOn && isOn) {
      // Turn off
      const deviceName = this.__deviceList[deviceId].name;
      this.updateLog(`Turning off device: ${deviceName}`, LOG_INFO);
      this.__current_state[deviceId].ongoing = true;
      this.__current_state[deviceId].confirmed = false;
      return device.setCapabilityValue({ capabilityId: this.__deviceList[deviceId].onoff_cap, value: false })
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
          this.updateLog(`Failed to turn off device ${deviceName}, will try to turn off other devices instead. (${error})`, LOG_ERROR);
          return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
        });
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
          if (this.__power_last_hour !== undefined) {
            // The first time the data is not for a full hour, so skip adding to statistics
            await this.statsSetLastHourEnergy(this.__accum_energy);
          }
          this.__power_last_hour = this.__accum_energy;
          this.updateLog(`Hour finalized: ${String(this.__accum_energy)} Wh`, LOG_INFO);
          // Add up initial part of next hour (only necessary for app restarts as otherwise the number will be close to 0).
          const energyUsedNewHour = (this.__current_power * timeWithinHour) / (1000 * 60 * 60);
          this.__accum_energy = energyUsedNewHour;
          this.log(`NewHour energy: ${this.__accum_energy}`);
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
      this.updateLog(`New hour in ${String(timeToNextTrigger)} ms (now is: ${String(now)})`, LOG_DEBUG);
    }
  }

  /**
   * onMonitor runs regurarly to monitor the actual state
   * Similar to refreshAllDevices(), but it will only refresh states that are not correct
   */
  async onMonitor() {
    this.updateLog('onMonitor()', LOG_INFO);
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
          if (this.__deviceList[deviceId].onoff_cap === undefined) {
            return Promise.reject(new Error('The onoff capability is non-existing, this should never happen.'));
          }
          const isOn = device.capabilitiesObj[this.__deviceList[deviceId].onoff_cap].value;
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
          const tempConfirmed = this.__current_state[deviceId].temp && (device.capabilitiesObj['target_temperature'].value === this.__current_state[deviceId].temp);
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
        this.updateLog(`Monitor completed with state: ${allOk}`, LOG_DEBUG);
        return Promise.resolve(allOk);
      })
      .catch(error => {
        this.__monitorError += 1;
        this.updateLog(`Monitor failed to inspect devices: ${error}`, LOG_ERROR);
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
      + `(Estimated end: ${String(this.__power_estimated.toFixed(2))})`, LOG_DEBUG);

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
   */
  async onModeUpdate(newMode) {
    const oldMode = +this.homey.settings.get('operatingMode');
    if (newMode === oldMode) {
      return Promise.resolve();
    }
    this.updateLog(`Changing the current mode to: ${String(newMode)}`, LOG_INFO);
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
    this.updateLog(`Changing zone ${zone.name} (ID: ${zone.id}) to ${String(enabled)}`, LOG_INFO);
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
    this.homey.settings.set('gotPPFromFlow', true);
    // Do not continue if the price point did not change
    const oldPricePoint = +this.homey.settings.get('pricePoint');
    this.statsSetLastHourPricePoint(oldPricePoint);
    if (+newMode === +oldPricePoint) {
      return Promise.resolve();
    }
    this.updateLog(`Changing the current price point to: ${String(newMode)}`, LOG_INFO);
    this.homey.settings.set('pricePoint', newMode);
    return this.refreshAllDevices();
  }

  /**
   * onMaxUsageUpdate is called whenever the max usage per hour is changed
   */
  async onMaxUsageUpdate(newVal) {
    this.updateLog(`Changing the max usage per hour to: ${String(newVal)}`, LOG_INFO);
    this.homey.settings.set('maxPower', newVal);
  }

  /**
   * onSafetyPowerUpdate is called whenever the safety power is changed
   */
  async onSafetyPowerUpdate(newVal) {
    this.updateLog(`Changing the current safety power to: ${String(newVal)}`, LOG_INFO);
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
        LOG_DEBUG);
      return Promise.resolve();
    }
    this.updateLog(`Can use ${String(morePower)}W more power`, LOG_DEBUG);

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
    this.updateLog(errorString, LOG_ERROR);
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
        if (this.__deviceList[deviceId].onoff_cap === undefined) {
          return Promise.reject(new Error('The onoff capability is non-existing, this should never happen.'));
        }
        const isOn = device.capabilitiesObj[this.__deviceList[deviceId].onoff_cap].value;
        this.__current_state[deviceId].isOn = isOn;
        if (isOn === undefined) {
          this.updateLog(`Refreshtemp: isOn was set to undefined ${isOn}`, LOG_ERROR);
        }
        if (!isOn) return Promise.resolve([true, true]);
        const hasTargetTemp = device.capabilities.includes('target_temperature');
        if (!hasTargetTemp) return Promise.resolve([true, true]);
        const hasMeasureTemp = device.capabilities.includes('measure_temperature');
        if (!hasMeasureTemp) return Promise.resolve([true, true]);
        const frostGuardActive = this.__deviceList[deviceId].thermostat_cap
          ? (device.capabilitiesObj['measure_temperature'].value < frostList[deviceId].minTemp) : false;
        const newTemp = frostGuardActive ? frostList[deviceId].minTemp : (modeTemp + deltaTemp);
        this.__current_state[deviceId].temp = newTemp;
        if (device.capabilitiesObj['target_temperature'].value === newTemp) return Promise.resolve([true, true]);
        this.__current_state[deviceId].ongoing = true;
        this.__current_state[deviceId].confirmed = false;
        return device.setCapabilityValue({ capabilityId: 'target_temperature', value: newTemp })
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
        this.updateLog(`Failed to set temperature for device ${this.__deviceList[deviceId].name}, will retry later (${error})`, LOG_ERROR);
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
        continue;
      }
      const operation = (currentPriceMode === c.PRICE_MODE_DISABLED) ? undefined : currentActions[deviceId].operation;
      switch (operation) {
        case TURN_ON:
        case TURN_OFF:
        case undefined: // undefined only means leave it to the changeDeviceState function to decide the operation
          promises.push(this.changeDeviceState(deviceId, operation));
          break;
        case DELTA_TEMP:
          promises.push(this.refreshTemp(deviceId));
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
    this.__stats_low_energy = this.homey.settings.get('stats_low_energy');
    this.__stats_norm_energy = this.homey.settings.get('stats_norm_energy');
    this.__stats_high_energy = this.homey.settings.get('stats_high_energy');
    this.__stats_extreme_energy = this.homey.settings.get('stats_extreme_energy');
    this.__stats_last_day_max = undefined;
    this.__stats_tmp_max_power_today = this.homey.settings.get('stats_tmp_max_power_today'); // Todo: reject if the time is too far away
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
    this.__stats_last_month_max = energy;
    this.homey.settings.set('stats_last_month_max', this.__stats_last_month_max);

    // Add savings for power tariff, always assume one step down
    const tariffTable = await this.fetchTariffTable();
    const tariffIndex = this.findTariffIndex(tariffTable, energy);
    if (tariffIndex < tariffTable.length - 1) {
      this.__stats_savings_all_time_power_part += tariffTable[tariffIndex + 1].price - tariffTable[tariffIndex].price;
      this.homey.settings.set('stats_savings_all_time_power_part', this.__stats_savings_all_time_power_part);
    } // else max tariff, nothing saved
  }

  async statsSetLastDayMaxEnergy(energy) {
    this.__stats_last_day_time = this.roundToNearestHour(new Date());
    this.__stats_last_day_max = energy;

    // Keep largest 3 days:
    this.__stats_this_month_maxes.push(energy);
    this.__stats_this_month_maxes.sort((a, b) => b - a);
    if (this.__stats_this_month_maxes.length > 3) {
      this.__stats_this_month_maxes.pop();
    }
    this.__stats_this_month_average = this.__stats_this_month_maxes.reduce((a, b) => a + b, 0) / this.__stats_this_month_maxes.length;
    // On new month:
    const dayOfMonth = this.toLocalTime(this.__stats_last_day_time).getDate();
    if (dayOfMonth === 0) {
      await this.statsSetLastMonthPower(this.__stats_this_month_average);
      this.__stats_this_month_maxes = [];
      this.__stats_app_restarts = 0;
      this.homey.settings.set('stats_app_restarts', 0);
    }
    this.homey.settings.set('stats_this_month_maxes', this.__stats_this_month_maxes);
    this.homey.settings.set('stats_this_month_average', this.__stats_this_month_average);
  }

  async statsSetLastHourEnergy(energy) {
    this.__stats_energy_time = this.roundToNearestHour(new Date());
    this.updateLog(`Stats last energy time: ${this.__stats_energy_time}`, LOG_INFO);
    this.__stats_energy = energy;

    // Find todays max - TODO check if correct interval
    if (this.__stats_tmp_max_power_today === null || energy > +this.__stats_tmp_max_power_today) {
      this.__stats_tmp_max_power_today = energy;
    }

    // If new day has begun - TODO swap first hour with first active hour
    if (this.toLocalTime(this.__stats_energy_time).getHours() === 0) {
      await this.statsSetLastDayMaxEnergy(this.__stats_tmp_max_power_today);
      this.__stats_tmp_max_power_today = 0;
    }

    this.homey.settings.set('stats_tmp_max_power_today', this.__stats_tmp_max_power_today);
  }

  statsSetLastHourPrice(price) {
    this.__stats_price_time = new Date();
    this.updateLog(`Stats price set to: ${this.__stats_price}`, LOG_INFO);
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
          case PP_LOW:
            this.__stats_low_energy = (!this.__stats_low_energy) ? this.__stats_energy : ((+this.__stats_low_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_low_energy', this.__stats_low_energy);
            break;
          case PP_NORM:
            this.__stats_norm_energy = (!this.__stats_norm_energy) ? this.__stats_energy : ((+this.__stats_norm_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_norm_energy', this.__stats_norm_energy);
            break;
          case PP_HIGH:
            this.__stats_high_energy = (!this.__stats_high_energy) ? this.__stats_energy : ((+this.__stats_high_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_high_energy', this.__stats_high_energy);
            break;
          case PP_EXTREME:
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

  /** ****************************************************************************************************
   *  LOGGING
   ** **************************************************************************************************** */

  logInit() {
    this.homeyLog = new Log({ homey: this.homey });
    // Reset logging
    this.homey.settings.set('diagLog', '');
    this.homey.settings.set('sendLog', '');
    this.homey.settings.set('showState', '');
    this.homey.settings.set('showCaps', '');
    this.homey.settings.set('showPriceApi', '');

    // When sendLog is clicked, send the log
    this.homey.settings.on('set', async setting => {
      if (setting === 'diagLog') return;
      const diagLog = this.homey.settings.get('diagLog');
      const sendLog = this.homey.settings.get('sendLog');
      const showState = this.homey.settings.get('showState');
      const showCaps = this.homey.settings.get('showCaps');
      const showPriceApi = this.homey.settings.get('showPriceApi');
      const LOG_ALL = LOG_ERROR; // Send as ERROR just to make it visible regardless
      if (setting === 'sendLog' && (sendLog === 'send') && (diagLog !== '')) {
        this.sendLog();
      }
      if (setting === 'showState' && (showState === '1')) {
        const frostList = this.homey.settings.get('frostList');
        const numControlledDevices = Array.isArray(frostList) ? Object.keys(frostList).length : 0;
        this.updateLog('========== INTERNAL STATE ==========', LOG_ALL);
        this.updateLog(`Number of devices under control: ${numControlledDevices}`, LOG_ALL);
        this.updateLog(`Current operating mode: ${this.homey.settings.get('operatingMode')}`, LOG_ALL);
        this.updateLog(`Current price mode: ${this.homey.settings.get('priceMode')}`, LOG_ALL);
        this.updateLog(`Current price point: ${this.homey.settings.get('pricePoint')}`, LOG_ALL);
        this.updateLog(`Total signal failures On:${this.__stats_failed_turn_on} Off:${this.__stats_failed_turn_off} Temp:${this.__stats_failed_temp_change}`, LOG_ALL);
        this.updateLog(`Total number of monitor errors: ${this.__monitorError}`, LOG_ALL);
        this.updateLog('Device Name               | Location        | Is On      | Temperature | Com errors | Ongoing', LOG_ALL);
        for (const deviceId in frostList) {
          if (!(deviceId in this.__deviceList) || this.__deviceList[deviceId].use === false) continue;
          const { name, room } = this.__deviceList[deviceId];
          const { isOn, nComError } = this.__current_state[deviceId];
          const { temp, ongoing, confirmed } = this.__current_state[deviceId];
          const { __monitorError, __monitorFixTemp, __monitorFixOn } = this.__current_state[deviceId];
          this.homeyApi.devices.getDevice({ id: deviceId })
            .then(device => {
              const isOnActual = (this.__deviceList[deviceId].onoff_cap === undefined) ? undefined : device.capabilitiesObj[this.__deviceList[deviceId].onoff_cap].value;
              const tempActualTarget = ('target_temperature' in device.capabilitiesObj) ? device.capabilitiesObj['target_temperature'].value : 'undef';
              const tempActualMeasure = ('measure_temperature' in device.capabilitiesObj) ? device.capabilitiesObj['measure_temperature'].value : 'undef';
              this.updateLog(`${String(name).padEnd(25)} | ${String(room).padEnd(15)} | ${String(isOn).padEnd(10)} | ${
                String(temp).padStart(11)} | ${String(nComError).padStart(10)} | ${String(ongoing).padEnd(7)}`, LOG_ALL);
              this.updateLog(`${String('--->Actual').padEnd(13)} - Errs: ${String(__monitorError).padEnd(3)} | ${
                String(__monitorFixOn).padEnd(7)},${String(__monitorFixTemp).padEnd(7)} | ${String(isOnActual).padEnd(10)} | ${
                String(tempActualMeasure).padStart(5)}/${String(tempActualTarget).padStart(5)} | ${''.padStart(10)} | ${String(confirmed).padEnd(7)}`, LOG_ALL);
            })
            .catch(err => {
              this.log(`Error log failed for device with name: ${name}`);
            });
        }
        this.updateLog('======== INTERNAL STATE END ========', LOG_ALL);
        this.homey.settings.set('showState', '');
      }
      if (setting === 'showCaps' && (showCaps === '1')) {
        this.updateLog('========== LIST OF IGNORED DEVICES ==========', LOG_ALL);
        await this.homeyApi.devices.getDevices()
          .then(devices => {
            // Loop all devices
            for (const device of Object.values(devices)) {
              const onoffCap = device.capabilities.includes('onoff') ? 'onoff' : device.capabilities.find(cap => cap.includes('onoff'));
              if (onoffCap === undefined) {
                this.updateLog(`Device: ${device.name}`, LOG_ALL);
                this.updateLog(`Capabilities: ${String(device.capabilities)}`, LOG_ALL);
              }
            }
          })
          .catch(err => {
            this.log(`Failed to fetch devicelist: ${err}`);
          });
        this.updateLog('======== IGNORED DEVICES END ========', LOG_ALL);
        this.homey.settings.set('showCaps', '');
      }

      if (setting === 'showPriceApi' && (showPriceApi === '1')) {
        this.updateLog('========== UTILITYCOST INTEGRATION ==========', LOG_ALL);
        const apiState = await this._checkApi();
        const installed = await this.elPriceApi.getInstalled();
        const version = await this.elPriceApi.getVersion();
        const prices = await this.elPriceApi.get('/prices');
        const gridcosts = await this.elPriceApi.get('gridcosts');
        if (this.apiState === c.PRICE_API_NO_APP) this.updateLog('No Api or wrong version');
        if (this.apiState === c.PRICE_API_NO_DEVICE) this.updateLog('No device found');
        this.updateLog(`ApiState: ${apiState}`, LOG_ALL);
        this.updateLog(`Installed: ${installed}`, LOG_ALL);
        this.updateLog(`Version: ${version}`, LOG_ALL);
        this.updateLog(`Prices: ${JSON.stringify(prices)}`, LOG_ALL);
        this.updateLog(`GridCosts: ${JSON.stringify(gridcosts)}`, LOG_ALL);
        this.updateLog('======== UTILITYCOST INTEGRATION END ========', LOG_ALL);
        this.homey.settings.set('showPriceApi', '');
      }
    });
  }

  updateLog(newMessage, ignoreSetting = LOG_INFO) {
    let logLevel = +this.homey.settings.get('logLevel');
    if (!Number.isInteger(logLevel)) logLevel = 0;
    if (ignoreSetting > logLevel) {
      return;
    }

    this.log(newMessage);

    let oldText = this.homey.settings.get('diagLog') || '';
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

    this.homey.settings.set('diagLog', oldText);
    this.homeyLog.setExtra({
      diagLog: this.homey.settings.get('diagLog')
    });
    this.homey.settings.set('sendLog', '');
  }

  async sendLog() {
    let tries = 5;

    while (tries-- > 0) {
      try {
        this.updateLog('Sending log', LOG_ERROR);
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
        const info = await transporter.sendMail(
          {
            from: `"Homey User" <${Homey.env.MAIL_USER}>`, // sender address
            to: Homey.env.MAIL_RECIPIENT, // list of receivers
            subject: 'Sparegris log', // Subject line
            text: this.homey.settings.get('diagLog') // plain text body
          }
        );

        this.updateLog(`Message sent: ${info.messageId}`, LOG_INFO);

        // Preview only available when sending through an Ethereal account
        this.log('Preview URL: ', nodemailer.getTestMessageUrl(info));
        return '';
      } catch (err) {
        this.updateLog(`Send log error: ${err.stack}`, LOG_ERROR);
      }
    }
    this.updateLog('Send log FAILED', LOG_ERROR);
    return '';
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
      low_price_limit: this.__low_price_limit,
      high_price_limit: this.__high_price_limit,
      extreme_price_limit: this.__extreme_price_limit,
      savings_yesterday: this.__stats_savings_yesterday,
      savings_all_time_use: this.__stats_savings_all_time_use,
      savings_all_time_power_part: this.__stats_savings_all_time_power_part,

      appState
    };
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
          : 'must be installed'}. Data ${dataOk ? 'was returned' : 'was not returned'}.`, LOG_INFO);
        return dataOk ? c.PRICE_API_OK : deviceOk ? c.PRICE_API_NO_DATA : apiOk ? c.PRICE_API_NO_DEVICE : c.PRICE_API_NO_APP;
      }
      this.updateLog('Electricity price api not installed', LOG_ERROR);
    } catch (err) {
      this.updateLog(`Failed checking electricity price API: ${err.message}`, LOG_ERROR);
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
      this.updateLog(`Electricity price api failed: ${err.message}`, LOG_ERROR);
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
    if (!this.app_is_configured
      || !Number.isInteger(+futurePriceOptions.minCheapTime)
      || !Number.isInteger(+futurePriceOptions.minExpensiveTime)
      || !Number.isInteger(+futurePriceOptions.lowPriceModifier)
      || !Number.isInteger(+futurePriceOptions.highPriceModifier)) { // Do not check for extremePriceModifier because it was added later and may be missing
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
    }
    if (this.__high_price_limit > orderedPriceTable[highPriceIndex]) {
      this.__high_price_limit = orderedPriceTable[highPriceIndex];
      if (this.__low_price_limit > this.__high_price_limit) {
        this.__low_price_limit = this.__high_price_limit;
      }
    }

    // Trigger new Price points
    const isLowPrice = (this.__current_prices[this.__current_price_index] < this.__low_price_limit);
    const isHighPrice = (this.__current_prices[this.__current_price_index] > this.__high_price_limit);
    const isExtremePrice = (this.__current_prices[this.__current_price_index] > this.__extreme_price_limit) && Number.isInteger(+futurePriceOptions.extremePriceModifier);
    const mode = isLowPrice ? PP_LOW
      : isExtremePrice ? PP_EXTREME
        : isHighPrice ? PP_HIGH
          : PP_NORM;
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
    this.apiState = await this._checkApi();
    if (this.apiState === c.PRICE_API_OK) {
      const gridFromApi = await this.elPriceApi.get('/gridcosts');
      if (Array.isArray(gridFromApi) && gridFromApi.length > 0) {
        return gridFromApi;
      }
    }
    // Could not fetch the table, using tensio price table instead.
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
