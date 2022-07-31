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
// TODO

const Homey = require('homey');
const nodemailer = require('nodemailer');
const { Log } = require('homey-log');
const { Mutex } = require('async-mutex');
const { HomeyAPIApp } = require('homey-api');
const { resolve } = require('path');

const WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF = 5 * 60 * 1000;

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

// Price points
const PP_LOW = 0;
const PP_NORM = 1;
const PP_HIGH = 2;

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
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.logInit();
    this.__intervalID = undefined;
    this.__newHourID = undefined;
    this.__current_power = undefined;
    this.__current_power_time = undefined;
    this.__accum_energy = undefined;
    this.__reserved_energy = 0;
    this.__last_power_off_time = new Date();
    this.__last_power_on_time = new Date();
    this.__power_last_hour = undefined;
    this.__power_estimated = undefined;
    this.__alarm_overshoot = false;
    this.__free_capacity = 0;
    this.__num_off_devices = 0;
    this.mutex = new Mutex();
    this.elPriceApi = this.homey.api.getApiApp('no.almli.utilitycost');
    this.homeyApi = new HomeyAPIApp({
      homey: this.homey
    });
    this.statsInit();

    // Check that settings has been updated
    const maxPower = this.homey.settings.get('maxPowerList');
    if (typeof maxPower === 'undefined') {
      return Promise.reject(new Error('Please configure the app before continuing'));
    }

    // Create list of devices
    await this.createDeviceList();
    this.homey.settings.set('deviceList', this.__deviceList);

    // Enable action cards
    const cardActionEnergyUpdate = this.homey.flow.getActionCard('update-meter-energy'); // Marked as deprecated so nobody will see it yet
    cardActionEnergyUpdate.registerRunListener(async args => {
      const newTotal = args.TotalEnergyUsage;
      this.updateLog(`Total energy changed to: ${String(newTotal)}`, LOG_INFO);
    });
    const cardActionPowerUpdate = this.homey.flow.getActionCard('update-meter-power');
    cardActionPowerUpdate.registerRunListener(async args => {
      this.onPowerUpdate(args.CurrentPower);
    });
    const cardActionModeUpdate = this.homey.flow.getActionCard('change-piggy-bank-mode');
    cardActionModeUpdate.registerRunListener(async args => {
      this.onModeUpdate(args.mode);
    });
    const cardActionPricePointUpdate = this.homey.flow.getActionCard('change-piggy-bank-price-point');
    cardActionPricePointUpdate.registerRunListener(async args => {
      this.onPricePointUpdate(args.mode);
    });
    const cardActionSafetyPowerUpdate = this.homey.flow.getActionCard('change-piggy-bank-safety-power');
    cardActionSafetyPowerUpdate.registerRunListener(async args => {
      this.onSafetyPowerUpdate(args.reserved);
    });
    const cardZoneUpdate = this.homey.flow.getActionCard('change-zone-active');
    cardZoneUpdate.registerArgumentAutocompleteListener(
      'zone',
      async (query, args) => this.generateZoneList(query, args)
    );
    cardZoneUpdate.registerRunListener(async args => {
      this.onZoneUpdate(args.zone, args.enabled);
    });

    await this.onNewHour(); // The function distinguish between being called at a new hour and at app-init
    // TBD: Monitor energy usage every 5 minute
    /* await this.onMonitor();
    this.__intervalID = setInterval(() => {
      this.onMonitor();
    }, 1000 * 60 * 5); */

    this.updateLog('PiggyBank has been initialized', LOG_INFO);
    return Promise.resolve();
  }

  /**
   * Warning: homey does not report any errors if this function crashes, so make sure it doesn't crash
   */
  async generateZoneList(query, args) {
    // Count how many devices there are in every zone
    const zones = await this.homeyApi.zones.getZones();// devices.getDevices();
    // {"id":"9919ee1e-ffbc-480b-bc4b-77fb047e9e68","name":"Hjem","order":1,"parent":null,"active":false,"activeLastUpdated":null,"icon":"home"}
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
   */
  async onUninit() {
    // Make sure the interval is cleared if it was started, otherwise it will continue to
    // trigger but on an unknown app.
    if (this.__intervalID !== undefined) {
      clearInterval(this.__intervalID);
    }
    if (this.__newHourID !== undefined) {
      clearTimeout(this.__newHourID);
    }
    this.statsUnInit();
    this.updateLog('PiggyBank has been uninitialized', LOG_INFO);
  }

  /**
   * Create a list of relevant devices
   */
  async createDeviceList() {
    const devices = await this.homeyApi.devices.getDevices();

    const relevantDevices = {};

    // Loop all devices
    for (const device of Object.values(devices)) {
      // Relevant Devices must have an onoff capability
      // Unfortunately some devices like the SensiboSky heat pump controller invented their own onoff capability
      // so unless specially handled the capability might not be detected. The generic detection mechanism below
      // has only been tested on SensiboSky devices so there might be problems with other devices with custom onoff capabilities
      const onoffCap = device.capabilities.includes('onoff') ? 'onoff' : device.capabilities.find(cap => cap.includes('onoff'));
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
      const zones = await this.homeyApi.zones.getZones();
      let zoneId = device.zone;
      const memberOfZones = [];
      while (zoneId !== null) {
        memberOfZones.push(zoneId);
        zoneId = zones[zoneId].parent;
      }

      this.updateLog(`Device: ${String(priority)} ${device.id} ${device.name} ${device.class}`, LOG_DEBUG);
      const thermostatCap = device.capabilities.includes('target_temperature')
        && device.capabilities.includes('measure_temperature');
      const relevantDevice = {
        priority: (priority > 0) ? 1 : 0,
        name: device.name,
        room: device.zoneName,
        roomId: device.zone,
        memberOf: memberOfZones,
        image: device.iconObj == null ? null : device.iconObj.url,
        onoff_cap: onoffCap,
        thermostat_cap: thermostatCap,
        use: useDevice,
        nComError: 0 // Number of communication errors since last time it worked - Used to depriorotize devices so we don't get stuck in an infinite retry loop
      };
      relevantDevices[device.id] = relevantDevice;
    }
    this.__deviceList = relevantDevices;
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
  async changeDeviceState(deviceId, newState, modelistIdx = undefined) {
    const promiseDevice = this.homeyApi.devices.getDevice({ id: deviceId });
    const actionLists = this.homey.settings.get('priceActionList');
    const actionListIdx = this.homey.settings.get('pricePoint');
    const currentAction = actionLists[actionListIdx][deviceId]; // Action state: .operation
    const currentActionOp = parseInt(currentAction.operation, 10);
    const modeLists = this.homey.settings.get('modeList');
    const currentMode = this.homey.settings.get('operatingMode');
    const currentModeList = modeLists[currentMode - 1];
    const currentModeIdx = (modelistIdx === undefined) ? this.findModeIdx(deviceId) : modelistIdx;
    const currentModeState = parseInt(currentModeList[currentModeIdx].operation, 10); // Mode state

    // Do not attempt to control any devices if the app is disabled
    if (currentMode === 0) { // App is disabled
      return Promise.resolve();
    }

    let device;
    try {
      device = await promiseDevice;
    } catch (err) {
      this.updateLog(`Device not found? ${String(err)}`, LOG_ERROR);
      this.__deviceList[deviceId].nComError += 10; // Big error so wait more until retry than smaller errors
      return Promise.resolve([false, false]); // The unhandled device is solved by the later nComError handling
    }
    const frostList = this.homey.settings.get('frostList');
    const frostGuardActive = this.__deviceList[deviceId].thermostat_cap
      ? (device.capabilitiesObj['measure_temperature'].value < frostList[deviceId].minTemp) : false;

    const isOn = (this.__deviceList[deviceId].onoff_cap === undefined) ? undefined : device.capabilitiesObj[this.__deviceList[deviceId].onoff_cap].value;
    const activeZones = this.homey.settings.get('zones');
    const newStateOn = frostGuardActive
      || (currentActionOp !== TURN_OFF
        && !this.__deviceList[deviceId].memberOf.some(z => (activeZones.hasOwnProperty(z) && !activeZones[z].enabled))
        && ((newState === TURN_ON && currentModeState !== ALWAYS_OFF) || (newState === TURN_OFF && currentModeState === ALWAYS_ON)));

    if (newStateOn && !isOn) {
      // Turn on
      const deviceName = this.__deviceList[deviceId].name;
      this.updateLog(`Turning on device: ${deviceName}`, LOG_INFO);
      return device.setCapabilityValue({ capabilityId: this.__deviceList[deviceId].onoff_cap, value: true })
        .then(() => {
          this.__deviceList[deviceId].nComError = 0;
          // In case the device has a delayed temperature change action then change the temperature
          if (currentAction.delayTempChange) {
            return device.setCapabilityValue({ capabilityId: 'target_temperature', value: currentAction.delayTempValue });
          }
          return Promise.resolve();
        })
        .then(() => {
          currentAction.delayTempChange = false;
          this.__num_off_devices--; return [newState === TURN_ON, false];
        })
        .catch(error => {
          this.statsCountFailedTurnOn();
          this.__deviceList[deviceId].nComError += 1;
          this.updateLog(`Failed to turn on/set temperature for device ${deviceName}, will retry later`, LOG_ERROR);
          return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
        });
    } // ignore case !wantOn && isOn

    if (!newStateOn && isOn) {
      // Turn off
      const deviceName = this.__deviceList[deviceId].name;
      this.updateLog(`Turning off device: ${deviceName}`, LOG_INFO);
      return device.setCapabilityValue({ capabilityId: this.__deviceList[deviceId].onoff_cap, value: false })
        .then(() => {
          this.__deviceList[deviceId].nComError = 0;
          this.__num_off_devices++; return [newState === TURN_OFF, false];
        })
        .catch(error => {
          this.statsCountFailedTurnOff();
          this.__deviceList[deviceId].nComError += 1;
          this.updateLog(`Failed to turn off device ${deviceName}, will try to turn off other devices instead.`, LOG_ERROR);
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
    try {
      if (this.__current_power === undefined) {
        // First hour after app was started
        // Reserve energy for the time we have no data on
        let maxPower = this.homey.settings.get('maxPower');
        if (maxPower === undefined) {
          maxPower = 5000;
        }
        const lapsedTime = 1000 * 60 * 60 - this.timeToNextHour(now);
        this.__reserved_energy = (maxPower * lapsedTime) / (1000 * 60 * 60);
      } else {
        // Add up last part of previous hour
        const lapsedTime = now - this.__current_power_time;
        const energyUsed = (this.__current_power * lapsedTime) / (1000 * 60 * 60);
        this.__accum_energy += energyUsed;
        this.__reserved_energy = 0;
        if (this.__power_last_hour !== undefined) {
          // The first time the data is not for a full hour, so skip adding to statistics
          this.statsSetLastHourEnergy(this.__accum_energy);
        }
        this.__power_last_hour = this.__accum_energy;
        this.updateLog(`Hour finalized: ${String(this.__accum_energy)} Wh`, LOG_INFO);
      }
      this.__current_power_time = now;
      this.__accum_energy = 0;
    } finally {
      // Start timer to start exactly when a new hour starts
      const timeToNextTrigger = this.timeToNextHour(now);
      this.__newHourID = setTimeout(() => this.onNewHour(), timeToNextTrigger);
      this.updateLog(`New hour in ${String(timeToNextTrigger)} ms (now is: ${String(now)})`, LOG_DEBUG);
    }
  }

  /**
   * onMonitor runs regurarly to monitor the actual power usage
   */
  async onMonitor() {
    this.updateLog('onMonitor()', LOG_DEBUG);
    // TBD additional monitoring will be added here later
  }

  /**
   * onPowerUpdate is the action called whenever the power is updated from the power meter
   */
  async onPowerUpdate(newPower) {
    if (Number.isNaN(newPower)) {
      // If newPower is invalid just ignore it
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
    this.__current_power_time = now;
    this.__current_power = newPower;
    this.__power_estimated = this.__accum_energy + (newPower * remainingTime) / (1000 * 60 * 60);

    // Check if power can be increased or reduced
    const errorMargin = this.homey.settings.get('errorMargin') ? (parseInt(this.homey.settings.get('errorMargin'), 10) / 100) : 1;
    const maxPowerList = this.homey.settings.get('maxPowerList');
    const currentMode = this.homey.settings.get('operatingMode');
    const trueMaxPower = maxPowerList[currentMode - 1];
    const errorMarginWatts = trueMaxPower * errorMargin;
    const maxPower = trueMaxPower - errorMarginWatts;
    const safetyPower = this.homey.settings.get('safetyPower');

    this.updateLog(`${'onPowerUpdate: '
      + 'Using: '}${String(newPower)}W, `
      + `Accum: ${String(this.__accum_energy.toFixed(2))} Wh, `
      + `Limit: ${String(maxPower)} Wh, `
      + `Reserved: ${String(Math.ceil(this.__reserved_energy + safetyPower))}W, `
      + `(Estimated end: ${String(this.__power_estimated.toFixed(2))})`, LOG_DEBUG);

    // Do not attempt to control any devices if the app is disabled
    if (this.homey.settings.get('operatingMode') === 0) { // App is disabled
      return Promise.resolve();
    }

    // Try to control devices if the power is outside of the preferred bounds
    let powerDiff = (((maxPower - this.__accum_energy - this.__reserved_energy) * (1000 * 60 * 60)) / remainingTime) - newPower - safetyPower;
    const mainFuse = this.homey.settings.get('mainFuse'); // Amps
    const maxDrain = Math.round(1.732050808 * 230 * mainFuse);
    const maxFreeDrain = ((isNumber(maxDrain) && (maxDrain > trueMaxPower)) ? maxDrain : (trueMaxPower * 10)) - newPower;
    if (powerDiff > maxFreeDrain) {
      powerDiff = maxFreeDrain;
    }
    this.__free_capacity = powerDiff;
    let promise;
    if (powerDiff < 0) {
      promise = this.onAbovePowerLimit(-powerDiff)
        .catch(() => resolve()); // Ignore failures
    } else if (powerDiff > 0) {
      promise = this.onBelowPowerLimit(powerDiff, errorMarginWatts)
        .catch(() => resolve()); // Ignore failures
    }
    return promise;
  }

  /**
   * onModeUpdate is called whenever the operation mode is changed
   */
  async onModeUpdate(newMode) {
    const oldMode = this.homey.settings.get('operatingMode');
    if (newMode === oldMode) {
      return Promise.resolve();
    }
    this.updateLog(`Changing the current mode to: ${String(newMode)}`, LOG_INFO);
    this.homey.settings.set('operatingMode', newMode);
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
        promises.push(this.changeDeviceState(deviceId, enabled ? TURN_ON : TURN_OFF));
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
    const oldPricePoint = this.homey.settings.get('pricePoint');
    this.statsSetLastHourPricePoint(oldPricePoint);
    if (newMode === oldPricePoint) {
      return Promise.resolve();
    }
    this.updateLog(`Changing the current price point to: ${String(newMode)}`, LOG_INFO);
    this.homey.settings.set('pricePoint', newMode);
    return this.refreshAllDevices();
  }

  /**
   * onSafetyPowerUpdate is called whenever the safety power is changed
   */
  async onSafetyPowerUpdate(newVal) {
    this.updateLog(`Changing the current safety power to: ${String(newVal)}`, LOG_INFO);
    this.homey.settings.set('safetyPower', newVal);
  }

  /**
   * onBelowPowerLimit is called whenever power changed and we're allowed to use more power
   */
  async onBelowPowerLimit(morePower) {
    morePower = Math.round(morePower);
    // Reset the power alarm as we now have sufficient power available
    this.__alarm_overshoot = false;

    // If power was turned _OFF_ within the last 5 minutes then abort turning on anything
    // This is to avoid excessive on/off cycles of high power devices such as electric car chargers
    this.__last_power_on_time = new Date();
    const timeSincePowerOff = this.__last_power_on_time - this.__last_power_off_time;
    if (timeSincePowerOff < WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF) {
      this.updateLog(`Could use ${String(morePower)} W more power but was aborted due to recent turn off activity. Remaining wait = ${String((5 * 60 * 1000 - timeSincePowerOff) / 1000)} s`,
        LOG_DEBUG);
      return Promise.resolve();
    }
    this.updateLog(`Can use ${String(morePower)}W more power`, LOG_DEBUG);

    const modeList = this.homey.settings.get('modeList');
    const currentMode = this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    const numDevices = currentModeList.length;
    const reorderedModeList = [...currentModeList]; // Make sure all devices with communication errors are handled last (e.g. in case nothing else was possible)
    reorderedModeList.sort((a, b) => { // Err last
      return this.__deviceList[a.id].nComError
        - this.__deviceList[b.id].nComError;
    });
    // Turn on devices from top down in the priority list
    // Only turn on one device at the time
    let numForcedOffDevices = 0;
    for (let idx = 0; idx < numDevices; idx++) {
      const deviceId = reorderedModeList[idx].id;
      // Check if the on state complies with the settings
      switch (reorderedModeList[idx].operation) {
        case CONTROLLED:
        case ALWAYS_ON:
          // Always on is overridden by price actions
          try {
            const [success, noChange] = await this.changeDeviceState(deviceId, TURN_ON, idx);
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
    return Promise.resolve();
  }

  /**
   * onAbovePowerLimit is called whenever power changed and we can use more power
   */
  async onAbovePowerLimit(lessPower, errorMarginWatts) {
    lessPower = Math.ceil(lessPower);

    // Do not care whether devices was just recently turned on
    this.__last_power_off_time = new Date();

    const modeList = this.homey.settings.get('modeList');
    const currentMode = this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    const numDevices = currentModeList.length;
    const reorderedModeList = [...currentModeList]; // Make sure all devices with communication errors are handled last (e.g. in case nothing else was possible)
    reorderedModeList.sort((a, b) => { // Err first
      return this.__deviceList[b.id].nComError
        - this.__deviceList[a.id].nComError;
    });
    // Turn off devices from bottom and up in the priority list
    // Only turn off one device at the time
    let numForcedOnDevices = 0;
    for (let idx = numDevices - 1; idx >= 0; idx--) {
      const deviceId = reorderedModeList[idx].id;
      // Try to turn the device off regardless, it might be blocked by the state
      try {
        const [success, noChange] = await this.changeDeviceState(deviceId, TURN_OFF, idx);
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

    // If this point was reached then all devices are off and still above power limit
    const errorString = `Failed to reduce power usage by ${String(lessPower)}W (number of forced on devices: ${String(numForcedOnDevices)})`;
    this.updateLog(errorString, LOG_ERROR);
    // Alert the user, but not if first hour since app was started or we are within the error margin. Only send one alert before it has been resolved
    const firstHourEver = this.__reserved_energy > 0;
    if (!firstHourEver && (lessPower > errorMarginWatts) && !this.__alarm_overshoot) {
      this.__alarm_overshoot = true;
      this.homey.notifications.createNotification({ excerpt: `Alert: The power must be reduced by ${String(lessPower)} W immediately or the hourly limit will be breached` });
    }
    this.__num_off_devices = Object.keys(this.homey.settings.get('frostList')).length - numForcedOnDevices; // Reset off counter in case it was wrong
    return Promise.reject(new Error(errorString));
  }

  findModeIdx(deviceId) {
    const modeList = this.homey.settings.get('modeList');
    const currentMode = this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    for (let i = 0; i < currentModeList.length; i++) {
      if (currentModeList[i].id === deviceId) {
        return i;
      }
    }
    return null; // Nothing found
  }

  async refreshAllDevices() {
    const modeList = this.homey.settings.get('modeList');
    const currentMode = this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    const currentPricePoint = this.homey.settings.get('pricePoint');

    // Go through all actions for this new mode;
    const actionLists = this.homey.settings.get('priceActionList');
    const currentActions = actionLists[currentPricePoint];
    const promises = [];
    for (const deviceId in currentActions) {
      let device;
      try {
        device = await this.homeyApi.devices.getDevice({ id: deviceId });
      } catch (error) {
        this.__deviceList[deviceId].nComError += 10; // Big error so wait more until retry than smaller errors
        promises.push(Promise.resolve([false, false])); // The unhandled device is solved by the later nComError handling
        continue; // Skip this device
      }
      switch (currentActions[deviceId].operation) {
        case TURN_ON:
          promises.push(this.changeDeviceState(deviceId, TURN_ON));
          break;
        case TURN_OFF:
          promises.push(this.changeDeviceState(deviceId, TURN_OFF));
          break;
        case DELTA_TEMP: {
          const modeIdx = this.findModeIdx(deviceId);
          const oldTemp = parseInt(currentModeList[modeIdx].targetTemp, 10);
          const deltaTemp = parseInt(currentActions[deviceId].delta, 10);
          const newTemp = oldTemp + deltaTemp;
          const isOn = await (this.__deviceList[deviceId].onoff_cap === undefined) ? undefined : device.capabilitiesObj[this.__deviceList[deviceId].onoff_cap].value;
          if (isOn) {
            promises.push(device.setCapabilityValue({ capabilityId: 'target_temperature', value: newTemp })
              .then(() => {
                currentActions[deviceId].delayTempChange = false;
                this.__deviceList[deviceId].nComError = 0;
                return Promise.resolve([true, false]);
              }).catch(error => {
                this.statsCountFailedTempChange();
                currentActions[deviceId].delayTempChange = true;
                this.__deviceList[deviceId].nComError += 1;
                return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
              }));
          } else {
            // Delay the action until the device turns on
            currentActions[deviceId].delayTempChange = true;
            currentActions[deviceId].delayTempValue = newTemp;
            promises.push(Promise.resolve([true, false]));
          }
        }
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
      .catch(error => Promise.reject(new Error(`Unknown error: ${error}`)));
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
    this.__stats_last_day_max = undefined;
    this.__stats_tmp_max_power_today = this.homey.settings.get('stats_tmp_max_power_today'); // Todo: reject if the time is too far away
    this.__stats_this_month_maxes = this.homey.settings.get('stats_this_month_maxes'); // Todo: reject if the time is too far away
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
    this.homey.settings.set('stats_failed_turn_on', this.__stats_failed_turn_on);
  }

  statsCountFailedTurnOff() {
    this.__stats_failed_turn_off += 1;
    this.homey.settings.set('stats_failed_turn_off', this.__stats_failed_turn_off);
  }

  statsCountFailedTempChange() {
    this.__stats_failed_temp_change += 1;
    this.homey.settings.set('stats_failed_temp_change', this.__stats_failed_temp_change);
  }

  statsSetLastMonthPower(energy) {
    this.__stats_last_month_max = energy;
    this.homey.settings.set('stats_last_month_max', this.__stats_last_month_max);
  }

  statsSetLastDayMaxEnergy(energy) {
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
    const dayOfMonth = this.__stats_last_day_time.getDate();
    if (dayOfMonth === 0) {
      this.statsSetLastMonthPower(this.__stats_this_month_average);
      this.__stats_this_month_maxes = [];
      this.__stats_app_restarts = 0;
      this.homey.settings.set('stats_app_restarts', 0);
    }
    this.homey.settings.set('stats_this_month_maxes', this.__stats_this_month_maxes);
    this.homey.settings.set('stats_this_month_average', this.__stats_this_month_average);
  }

  statsSetLastHourEnergy(energy) {
    this.__stats_energy_time = this.roundToNearestHour(new Date());
    this.__stats_energy = energy;

    // Find todays max
    if (this.__stats_tmp_max_power_today === null || energy > +this.__stats_tmp_max_power_today) {
      this.__stats_tmp_max_power_today = energy;
    }

    // If new day has begun
    if (this.__stats_energy_time.getHours() === 0) {
      this.statsSetLastDayMaxEnergy(this.__stats_tmp_max_power_today);
      this.__stats_tmp_max_power_today = 0;
    }

    this.homey.settings.set('stats_tmp_max_power_today', this.__stats_tmp_max_power_today);
  }

  statsSetLastHourPrice(price) {
    this.__stats_price_time = new Date();
    this.__stats_price = price;
  }

  statsSetLastHourPricePoint(pp) {
    this.__starts_price_point_time = new Date();
    this.__stats_price_point = pp;
  }

  statsNewHour() {
    const now = new Date();

    // Check that all new stats has been reported
    const timeSinceEnergy = this.__stats_energy_time - now;
    const timeSincePrice = this.__stats_price_time - now;
    const tenMinutes = 10 * 60 * 1000;
    if ((timeSinceEnergy > tenMinutes)
      || (timeSincePrice > tenMinutes)) {
      return;
    }

    let pricePointLastHour;
    const timeSincePricePoint = this.__starts_price_point_time - now;
    if (timeSincePricePoint > tenMinutes) {
      pricePointLastHour = this.__stats_price_point;
    } else {
      pricePointLastHour = +this.homey.settings.get('pricePoint');
    }
    switch (pricePointLastHour) {
      case PP_LOW:
        this.__stats_low_energy = (this.__stats_low_energy === null) ? this.__stats_energy : ((+this.__stats_low_energy * 99 + this.__stats_energy) / 100);
        this.homey.settings.set('stats_low_energy', this.__stats_low_energy);
        break;
      case PP_NORM:
        this.__stats_norm_energy = (this.__stats_norm_energy === null) ? this.__stats_energy : ((+this.__stats_norm_energy * 99 + this.__stats_energy) / 100);
        this.homey.settings.set('stats_norm_energy', this.__stats_norm_energy);
        break;
      case PP_HIGH:
        this.__stats_high_energy = (this.__stats_high_energy === null) ? this.__stats_energy : ((+this.__stats_high_energy * 99 + this.__stats_energy) / 100);
        this.homey.settings.set('stats_high_energy', this.__stats_high_energy);
        break;
      default:
    }

    // Start timer to start exactly 5 minutes after the next hour starts
    const timeToNextTrigger = this.timeToNextHour(now) + 5 * 60 * 1000;
    this.__statsIntervalID = setTimeout(() => this.statsNewHour(), timeToNextTrigger);
  }

  /** ****************************************************************************************************
   *  LOGGING
   ** **************************************************************************************************** */

  logInit() {
    this.homeyLog = new Log({ homey: this.homey });
    // Reset logging
    this.homey.settings.set('diagLog', '');
    this.homey.settings.set('sendLog', '');

    // When sendLog is clicked, send the log
    this.homey.settings.on('set', setting => {
      if (setting === 'diagLog') return;
      const diagLog = this.homey.settings.get('diagLog');
      const sendLog = this.homey.settings.get('sendLog');
      if (setting === 'sendLog' && (sendLog === 'send') && (diagLog !== '')) {
        this.sendLog();
      }
    });
  }

  updateLog(newMessage, ignoreSetting = LOG_INFO) {
    let logLevel = this.homey.settings.get('logLevel');
    if (!logLevel || logLevel === '') {
      logLevel = 1;
    }
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
      oldText = 'Log ID: ';
      oldText += nowTime.toJSON();
      oldText += '\r\n';
      oldText += 'App version ';
      oldText += Homey.manifest.version;
      oldText += '\r\n\r\n';
      this.logLastTime = nowTime;
    }

    if (this.logLastTime === undefined) {
      this.logLastTime = nowTime;
    }

    // const dt = new Date(nowTime.getTime() - this.logLastTime.getTime());
    this.logLastTime = nowTime;

    oldText += '+';
    oldText += nowTime.getHours();
    oldText += ':';
    oldText += nowTime.getMinutes();
    oldText += ':';
    oldText += nowTime.getSeconds();
    oldText += '.';

    const milliSeconds = nowTime.getMilliseconds().toString();
    if (milliSeconds.length === 2) {
      oldText += '0';
    } else if (milliSeconds.length === 1) {
      oldText += '00';
    }

    oldText += milliSeconds;
    oldText += ': ';
    oldText += newMessage;
    oldText += '\r\n';

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
  getState() {
    let listOfUsedDevices = this.homey.settings.get('frostList');
    if (listOfUsedDevices === null) {
      listOfUsedDevices = {};
    }
    return {
      power_last_hour: parseInt(this.__power_last_hour, 10),
      power_estimated: this.__power_estimated === undefined ? undefined : parseInt(this.__power_estimated.toFixed(2), 10),
      price_point: this.homey.settings.get('pricePoint'),
      operating_mode: this.homey.settings.get('operatingMode'),
      alarm_overshoot: this.__alarm_overshoot,
      free_capacity: this.__free_capacity,
      num_devices: Object.keys(listOfUsedDevices).length,
      num_devices_off: this.__num_off_devices,
      safety_power: parseInt(this.homey.settings.get('safetyPower'), 10),
      num_fail_on: this.__stats_failed_turn_on,
      num_fail_off: this.__stats_failed_turn_off,
      num_fail_temp: this.__stats_failed_temp_change,
      low_price_energy_avg: this.__stats_low_energy,
      norm_price_energy_avg: this.__stats_norm_energy,
      high_price_energy_avg: this.__stats_high_energy,
      power_yesterday: this.__stats_last_day_max,
      power_average: this.__stats_this_month_average,
      power_last_month: this.__stats_last_month_max,
      num_restarts: this.__stats_app_restarts
    };
  }

  /** ****************************************************************************************************
   *  EXTERNAL API's
   ** **************************************************************************************************** */
  /* async _checkApi() {
    try {
      const isInstalled = await this.elPriceApi.getInstalled();
      const version = await this.elPriceApi.getVersion();
      if (isInstalled && !!version) {
        const split = version.split('.');
        let apiOk = (Number(split[0]) >= 1 && Number(split[1]) >= 4);
        this.log(`Electricity price api version ${version} installed${apiOk ? ' and version is ok' : ', but wrong version'}`, split);
        return apiOk;
      } else {
        this.log(`Electricity price api not installed`);
      }
    } catch (err) {
      this.log(`Failed checking electricity price API: ${err.message}`);
    }
    return false;
  }

  async fetchPrices() {
    if (await this._checkApi()) {
      try {
        return await this.elPriceApi.get('/prices');
      } catch (err) {
        this.log('Electricity price api failed: ', err);
      }
    } else {
      // Can not fetch prices
    }
  } */

} // class

module.exports = PiggyBank;
