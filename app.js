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
const Mutex = require('async-mutex').Mutex;
const { HomeyAPIApp } = require('homey-api');
const { stringify } = require('querystring');

const WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF = 5*60*1000;

// Operations for controlled devices
const ALWAYS_OFF = 0;
const ALWAYS_ON = 1;
const CONTROLLED = 2;

const TURN_ON = 0;
const TURN_OFF = 1;
const DELTA_TEMP = 2;

class PiggyBank extends Homey.App {

  /**
   * Returns the number of milliseconds until next hour
   */
   timeToNextHour(input_time) {
     return 60*60*1000
     - input_time.getMinutes() * 60 * 1000 +
     - input_time.getSeconds() * 1000 +
     - input_time.getMilliseconds()
   }

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.__intervalID = undefined
    this.__newHourID = undefined
    this.__current_power = undefined
    this.__current_power_time = undefined
    this.__accum_energy = undefined
    this.__reserved_energy = 0
    this.__last_power_off_time = new Date();
    this.__last_power_on_time = new Date();
    this.mutex = new Mutex();
    this.elPriceApi = this.homey.api.getApiApp('no.almli.utilitycost');
    this.homeyApi = new HomeyAPIApp({
      homey: this.homey,
    });

    // Check that settings has been updated
    const maxPower = this.homey.settings.get('maxPowerList')
    if (typeof maxPower == "undefined") {
      throw("Please configure the app before continuing");
    }

    // Create list of devices
    await this.createDeviceList();
    this.homey.settings.set('deviceList', this.__deviceList);

    // Enable action cards
    const cardActionEnergyUpdate = this.homey.flow.getActionCard('update-meter-energy') // Remove?
    cardActionEnergyUpdate.registerRunListener(async (args) => {
      const newTotal  = args.TotalEnergyUsage;
      this.log("Total energy changed to: " + String(newTotal))
    })
    const cardActionPowerUpdate = this.homey.flow.getActionCard('update-meter-power')
    cardActionPowerUpdate.registerRunListener(async (args) => {
      this.onPowerUpdate(args.CurrentPower);
    })
    const cardActionModeUpdate = this.homey.flow.getActionCard('change-piggy-bank-mode')
    cardActionModeUpdate.registerRunListener(async (args) => {
      this.onModeUpdate(args.mode);
    })
    const cardActionPricePointUpdate = this.homey.flow.getActionCard('change-piggy-bank-price-point')
    cardActionPricePointUpdate.registerRunListener(async (args) => {
      this.onPricePointUpdate(args.mode);
    })
    const cardActionSafetyPowerUpdate = this.homey.flow.getActionCard('change-piggy-bank-safety-power')
    cardActionSafetyPowerUpdate.registerRunListener(async (args) => {
      this.onSafetyPowerUpdate(args.mode);
    })

    // Monitor energy usage every 5 minute:
    await this.onNewHour()
    await this.onMonitor()
    this.__intervalID = setInterval(() => {
      this.onMonitor()
    }, 1000*60*5)
    
    this.log('PiggyBank has been initialized');
  }


  /**
   * onUninit() is called when the app is destroyed
   */
   async onUninit() {
    // Make sure the interval is cleared if it was started, otherwise it will continue to
    // trigger but on an unknown app.
    if (this.__intervalID != undefined) {
      clearInterval(this.__intervalID)
    }
    if (this.__newHourID != undefined) {
      clearTimeout(this.__newHourID)
    }
    this.log('PiggyBank has been uninitialized');
  }


  /**
   * Create a list of relevant devices
   */
  async createDeviceList() {
    const devices = await this.homeyApi.devices.getDevices();

    var relevantDevices = {};

    // Loop all devices
    for(var device of Object.values(devices)) {
      // Relevant Devices must have an onoff capability
      // Unfortunately some devices like the SensiboSky heat pump controller invented their own onoff capability
      // so unless specially handled the capability might not be detected. The generic detection mechanism below
      // has only been tested on SensiboSky devices so there might be problems with other devices with custom onoff capabilities
      var onoff_cap = device.capabilities.includes("onoff") ? "onoff" : device.capabilities.find(cap => { if (cap.includes("onoff")) { return cap;}});
      if (onoff_cap === undefined) {
        this.log("ignoring: " + device.name)
        if (device.name == "Varmepumpe") {
          this.log("Capabilities ======");
          this.log(String(device.capabilities));
        }
        continue;
      }
      // Priority 1 devices has class = thermostat & heater - capabilities ['target_temperature' + 'measure_temperature']
      const priority =
        (device.capabilities.includes("target_temperature") ?1:0) +
        (device.capabilities.includes("measure_temperature")?1:0) +
        ((device.class == "thermostat" || device.class == "heater")?1:0);

      // Filter out irrelevant devices (check old device list if possible)
      var useDevice = false;
      var oldDeviceList = this.homey.settings.get('deviceList');
      if (device.id in oldDeviceList) {
        useDevice = oldDeviceList[device.id].use;
      } else {
        // Never seen before device, set usage based on priority
        useDevice = (priority > 0) ? true : false;
      }

      this.log("Device: " + String(priority) + " " + device.id + " " + device.name + " " + device.class)
      var thermostat_cap = device.capabilities.includes("target_temperature")
        && device.capabilities.includes("measure_temperature");
      var relevantDevice = {
        priority: (priority > 0) ? 1 : 0,
        name: device.name,
        room: device.zoneName,
        image: device.iconObj.url,
        onoff_cap: onoff_cap,
        thermostat_cap: thermostat_cap,
        use: useDevice
      };
      relevantDevices[device.id] = relevantDevice;
    }
    this.__deviceList = relevantDevices;
    return;
  }


  /**
   * Changes the state of a device.
   * The state cannot always be changed, as a priority of states follows.
   * - Below frost-guard results in always on and highest priority
   * - Device always off from mode
   * - Device turns off from price action
   * - Device always on from mode
   * - Device turns off due to power control
   * - Device turns on from price action
   * - Device turns on due to power control
   */
  async changeDeviceState(deviceId, newState, modelist_idx = undefined) {

    const promise_device = this.homeyApi.devices.getDevice({id: deviceId });
    const actionLists = this.homey.settings.get("priceActionList");
    const actionListIdx = this.homey.settings.get("pricePoint");
    const currentAction = actionLists[actionListIdx][deviceId]; // Action state: .operation
    const modeLists = this.homey.settings.get('modeList');
    const currentMode = this.homey.settings.get('operatingMode');
    const currentModeList = modeLists[currentMode-1];
    const currentModeIdx = (modelist_idx === undefined) ? this.findModeIdx(deviceId) : modelist_idx;
    const currentModeState = currentModeList[currentModeIdx].operation; // Mode state

    const device = await promise_device;
    const frostList = this.homey.settings.get("frostList");
    const frostGuardActive = this.__deviceList[deviceId].thermostat_cap 
      ? (device.capabilitiesObj["measure_temperature"].value < frostList[deviceId].minTemp) : false;

    const isOn = (this.__deviceList[deviceId].onoff_cap === undefined) ? undefined : device.capabilitiesObj[this.__deviceList[deviceId].onoff_cap].value;
    const newStateOn =
      frostGuardActive
      || (newState === TURN_ON  && currentModeState !== ALWAYS_OFF && currentAction.operation !== TURN_OFF)
      || (newState === TURN_OFF && currentModeState === ALWAYS_ON  && currentAction.operation !== TURN_OFF);
    
    if (newStateOn && !isOn) {
      // Turn on
      const deviceName = this.__deviceList[deviceId].name;
      this.log("Turning on device: " + deviceName)
      return device.setCapabilityValue({ capabilityId: this.__deviceList[deviceId].onoff_cap, value: true })
        .then(() => {
          // In case the device has a delayed temperature change action then change the temperature
          if (currentAction.delayTempChange) {
            currentAction.delayTempChange = false;
            return device.setCapabilityValue({ capabilityId: "target_temperature", value: currentAction.delayTempValue });
          }
        })
        .then(() => newState === TURN_ON)
        .catch(error => { throw error });
    } // ignore case !wantOn && isOn

    if (!newStateOn && isOn) {
      // Turn off
      const deviceName = this.__deviceList[deviceId].name;
      this.log("Turning off device: " + deviceName)
      return device.setCapabilityValue({ capabilityId: this.__deviceList[deviceId].onoff_cap, value: false })
        .then(() => newState === TURN_OFF)
        .catch(error => { throw error });
    }
    return new Promise((resolve) => { resolve(newStateOn == (newState == TURN_ON)) });
  }

  /**
   * onNewHour runs whenever a new hour starts
   * - Whenever called it calculates the time until next hour and starts a timeout function
   */
  async onNewHour() {
    var now = new Date();
    if (this.__current_power == undefined) {
      // First hour after app was started
      // Reserve energy for the time we have no data on
      const maxPower = this.homey.settings.get('maxPower')
      if (maxPower == undefined) {
        maxPower = 5000
      }
      const lapsed_time = 1000*60*60 - this.timeToNextHour(now);
      this.__reserved_energy = maxPower * lapsed_time / (1000*60*60);
    } else {
      // Add up last part of previous hour
      const lapsed_time = now - this.__current_power_time;
      const energy_used = this.__current_power * lapsed_time / (1000*60*60);
      this.__accum_energy += energy_used;
      this.__reserved_energy = 0;
      this.log("Hour finalized: " + String(this.__accum_energy) + " Wh");
    }
    this.__current_power_time = now;
    this.__accum_energy  = 0;

    // Start timer to start exactly when a new hour starts
    var timeToNextTrigger = this.timeToNextHour(now);
    this.__newHourID = setTimeout(() => { this.onNewHour() }, timeToNextTrigger)
    this.log("New hour in " + String(timeToNextTrigger) + " ms (now is:" + String(now) + ")")
  }


  /**
   * onMonitor runs regurarly to monitor the actual power usage
   * 
   */
  async onMonitor() {
    this.log("onMonitor()")
  }


  /**
   * onPowerUpdate is the action called whenever the power is updated from the power meter
   */
  async onPowerUpdate(newPower) {
    if (isNaN(newPower)) {
      return
    }
    var now = new Date();
    var remaining_time = this.timeToNextHour(now);
    if (this.__current_power == undefined) {
      // First time called ever
      this.__accum_energy = 0;
      this.__current_power = 0;
    } else {
      var lapsed_time = now - this.__current_power_time;
      var energy_used = this.__current_power * lapsed_time / (1000*60*60);
      this.__accum_energy += energy_used;
    }
    this.__current_power_time = now;
    this.__current_power = newPower;
    this.__estimated_end_usage = this.__accum_energy + newPower*remaining_time/(1000*60*60);

    // Check if power can be increased or reduced
    const errorMargin = this.homey.settings.get('errorMargin') ? (parseInt(this.homey.settings.get('errorMargin'))/100.) : 1.;
    const maxPowerList = this.homey.settings.get('maxPowerList');
    var currentMode = this.homey.settings.get('operatingMode');
    const trueMaxPower = maxPowerList[currentMode-1];
    const errorMarginWatts = trueMaxPower * errorMargin;
    const maxPower = trueMaxPower - errorMarginWatts;
    const safetyPower = this.homey.settings.get("safetyPower");

    this.log("onPowerUpdate: "
      + "Using: " + String(newPower) + "W, "
      + "Accum: " + String(this.__accum_energy.toFixed(2)) + " Wh, "
      + "Limit: " + String(maxPower) + " Wh, "
      + "Reserved: " + String(Math.ceil(this.__reserved_energy + safetyPower)) + "W, "
      + "(Estimated end: " + String(this.__estimated_end_usage.toFixed(2)) + ")")

    // Do not attempt to control any devices if the app is disabled
    if (this.homey.settings.get("operatingMode") == 0) { // App is disabled
        return;
    }

    // Try to control devices if the power is outside of the preferred bounds
    var power_diff = ((maxPower - this.__accum_energy - this.__reserved_energy) * (1000*60*60) / remaining_time) - newPower - safetyPower;
    if (power_diff < 0) {
      this.onAbovePowerLimit(-power_diff)
    } else if (power_diff > 0) {
      this.onBelowPowerLimit(power_diff, errorMarginWatts)
    }
  }


  /**
   * onModeUpdate is called whenever the operation mode is changed
   */
  async onModeUpdate(newMode) {
    this.log("Changing the current mode to: " + String(newMode));
    this.homey.settings.set("operatingMode", newMode, function (err) {
      if (err) return this.homey.alert(err);
    });
  }


  /**
   * onPricePointUpdate is called whenever the price point is changed
   */
  async onPricePointUpdate(newMode) {
    var oldPricePoint = this.homey.settings.get("pricePoint");
    if (newMode == oldPricePoint) {
      return;
    }
    this.log("Changing the current price point to: " + String(newMode));
    this.homey.settings.set("pricePoint", newMode, function (err) {
      if (err) return this.homey.alert(err);
    });

    var modeList = this.homey.settings.get('modeList');
    var currentMode = this.homey.settings.get('operatingMode');
    var currentModeList = modeList[currentMode-1];

    // Go through all actions for this new mode;
    var actionLists = this.homey.settings.get("priceActionList");
    var currentActions = actionLists[newMode];
    for (var deviceId in currentActions) {
      const device = await this.homeyApi.devices.getDevice({id: deviceId });
      switch (currentActions[deviceId].operation) {
        case TURN_ON:
          changeDeviceState(deviceId, TURN_ON)
          break;
        case TURN_OFF:
          changeDeviceState(deviceId, TURN_OFF)
          break;
        case DELTA_TEMP:
          const modeIdx = this.findModeIdx(deviceId);
          const old_temp = parseInt(currentModeList[modeIdx].targetTemp);
          const delta_temp = parseInt(currentActions[deviceId].delta);
          const new_temp = old_temp + delta_temp;
          const isOn = await (this.__deviceList[deviceId].onoff_cap === undefined) ? undefined : device.capabilitiesObj[this.__deviceList[deviceId].onoff_cap].value;
          if (isOn) {
            currentActions[deviceId].delayTempChange = false;
            device.setCapabilityValue({ capabilityId: "target_temperature", value: new_temp });
          } else {
            // Delay the action until the device turns on
            currentActions[deviceId].delayTempChange = true;
            currentActions[deviceId].delayTempValue = new_temp;
          }
          break;
      }
    }
  }


  /**
   * onSafetyPowerUpdate is called whenever the safety power is changed
   */
   async onSafetyPowerUpdate(newVal) {
    this.log("Changing the current safety power to: " + String(newVal));
    this.homey.settings.set("safetyPower", newVal, function (err) {
      if (err) return this.homey.alert(err);
    });
  }


  /**
   * onBelowPowerLimit is called whenever power changed and we're allowed to use more power
   */
  async onBelowPowerLimit(morePower) {
    morePower = Math.round(morePower);
    // If power was turned _OFF_ within the last 5 minutes then abort turning on anything
    // This is to avoid excessive on/off cycles of high power devices such as electric car chargers
    this.__last_power_on_time = new Date();
    var time_since_poweroff = this.__last_power_on_time - this.__last_power_off_time;
    if (time_since_poweroff < WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF) {
      this.log("Could use " + String(morePower) + " W more power but was aborted due to recent turn off activity. Remaining wait = " + String((5*60*1000-time_since_poweroff)/1000) + " s");
      return new Promise((resolve) => { resolve(); });
    } else {
      this.log("Can use " + String(morePower) + "W more power")
    }

    var modeList = this.homey.settings.get('modeList');
    var currentMode = this.homey.settings.get('operatingMode');
    var currentModeList = modeList[currentMode-1];
    var numDevices = currentModeList.length;
    // Turn on devices from top down in the priority list
    // Only turn on one device at the time
    for (var idx = 0; idx < numDevices; idx++) {
      const deviceId = currentModeList[idx].id;
      // Check if the on state complies with the settings
      switch (currentModeList[idx].operation) {
        case CONTROLLED:
        case ALWAYS_ON:
          // Always on is overridden by price actions
          if (await this.changeDeviceState(deviceId, TURN_ON, idx)) {
            return new Promise((resolve) => { resolve(); });
          } // else try to modify another device
          break;
        case ALWAYS_OFF:
          // Keep off / let it be on if it has been overridden by a user
          break;
      }
      //"measure_power"
      //this.log("Num: " + String(idx) + " on: " + String(isOn) + "    | " + deviceName + " op: " + String(currentMode) + " " + String(wantOn))
    }
    // If this point was reached then all devices are on and still below power limit
    return new Promise().resolve();
  }


  /**
   * onReducePower is called whenever power changed and we use too much
   */
  async onAbovePowerLimit(lessPower, errorMarginWatts) {
    lessPower = Math.ceil(lessPower);

    // Do not care whether devices was just recently turned on
    this.__last_power_off_time = new Date();

    var modeList = this.homey.settings.get('modeList');
    var currentMode = this.homey.settings.get('operatingMode');
    var currentModeList = modeList[currentMode-1];
    var numDevices = currentModeList.length;
    // Turn off devices from bottom and up in the priority list
    // Only turn off one device at the time
    var numForcedOnDevices = 0;
    for (var idx = numDevices-1; idx >= 0; idx--) {
      const deviceId = currentModeList[idx].id;
      // Try to turn the device off regardless, it might be blocked by the state
      if (await this.changeDeviceState(deviceId, TURN_OFF, idx)) {
        // Sucessfully Turned off
        return new Promise((resolve) => { resolve(); });
      } else {
        numForcedOnDevices++;
      }
      //"measure_power"
      //this.log("Num: " + String(idx) + " on: " + String(isOn) + "    | " + deviceName + " op: " + String(currentMode) + " " + String(wantOn))
    }

    // If this point was reached then all devices are off and still above power limit
    const errorString = "Failed to reduce power usage by " + String(lessPower) + "W (number of forced on devices: " + String(numForcedOnDevices) + ")";
    this.log(errorString);
    // Alert the user, but not if first hour since app was started or we are within the error margin
    var firstHourEver = this.__reserved_energy > 0;
    if (!firstHourEver && (lessPower > errorMarginWatts))
      this.homey.notifications.createNotification({excerpt: "Alert: The power must be reduced by " + String(lessPower) + " W immediately or the hourly limit will be breached"})
    return new Promise(() => { throw new Error(errorString); });
  }


  findModeIdx(deviceId) {
    var modeList = this.homey.settings.get('modeList');
    var currentMode = this.homey.settings.get('operatingMode');
    var currentModeList = modeList[currentMode-1];
    for (var i = 0; i < currentModeList.length; i++) {
      if (currentModeList[i].id == deviceId) {
        return i;
      }
    }
    return null; // Nothing found
  }

  /*********************************************************************************************************
   * EXTERNAL API's
   *********************************************************************************************************/
  /*async _checkApi() {
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
  }*/

} // class

module.exports = PiggyBank;

/*
[ { "device":
    { "id":"33fa2e27-a8cb-4e65-87f8-13545305101a",
      "name":"Varmekabler Stue",
      "driverUri":"homey:app:no.thermofloor",
      "driverId":"Z-TRM3",
      "zone":"9eb2975d-49ea-4033-8db0-105a3e982117",
      "zoneName":"Stue",
      "icon":null,
      "iconObj":
        { "id":"c79d8f5496a2a2d7a1767d70adca9fd3",
          "url":"/icon/c79d8f5496a2a2d7a1767d70adca9fd3/icon.svg"},
      "iconOverride":null,
      "settings":
        { "zw_node_id":"21",
          "zw_manufacturer_id":"411",
          "zw_product_type_id":"3",
          "zw_product_id":"515",
          "zw_secure":"⨯",
          "zw_battery":"⨯",
          "zw_device_class_basic":"BASIC_TYPE_ROUTING_SLAVE",
          "zw_device_class_generic":"GENERIC_TYPE_THERMOSTAT",
          "zw_device_class_specific":"SPECIFIC_TYPE_THERMOSTAT_GENERAL_V2",
          "zw_firmware_id":"771",
          "zw_application_version":"4",
          "zw_application_sub_version":"0",
          "zw_hardware_version":"3",
          "zw_wakeup_interval":0,
          "zw_wakeup_enabled":false,
          "zw_application_version_1":"4",
          "zw_application_sub_version_1":"0",
          "zw_group_1":"1.1",
          "zw_group_2":"",
          "zw_group_3":"",
          "zw_group_4":"",
          "zw_group_5":"",
          "operation_mode":"0",
          "HEAT_setpoint":100,
          "Temperature_display":"0",
          "Button_brightness_dimmed":50,
          "Button_brightness_active":100,
          "Display_brightness_dimmed":50,
          "Display_brightness_active":100,
          "Temperature_report_interval":300,
          "Temperature_report_threshold":10,
          "Meter_report_interval":90,
          "Meter_report_threshold":10,
          "Temperature_thermostat":"internal",
          "Sensor_mode":"1",
          "Floor_sensor_type":"0",
          "Temperature_control_hysteresis_DIFF_I":5,
          "Floor_minimum_temperature_limit_FLo":50,
          "Floor_maximum_temperature_limit_FHi":400,
          "Air_minimum_temperature_limit_ALo":50,
          "Air_maximum_temperature_limit_AHi":400,
          "Internal_sensor_calibration":0,
          "Floor_sensor_calibration":0,
          "External_sensor_calibration":0,
          "zw_configuration_value":""},
      "settingsObj":true,
      "class":"thermostat",
      "energy":null,
      "energyObj":
        { "W":0.09,
          "batteries":null,
          "cumulative":null,
          "generator":null},
      "virtualClass":null,
      "capabilities":
        [ "measure_temperature",
          "measure_temperature.internal",
          "measure_temperature.external",
          "measure_temperature.floor",
          "thermostat_mode_single",
          "thermostat_state",
          "onoff",
          "measure_power",
          "measure_voltage",
          "meter_power",
          "target_temperature",
          "button.reset_meter"],
      "capabilitiesObj":
        { "measure_temperature":
            { "value":26.2,
              "lastUpdated":"2022-06-24T10:50:30.181Z",
              "type":"number",
              "getable":true,
              "setable":false,
              "title":"temperature",
              "desc":"Temperatur i grader Celsius (°C)",
              "units":"°C",
              "decimals":2,
              "chartType":"spline",
              "id":"measure_temperature",
              "options":{"title":"temperature"}},
          "measure_temperature.internal":
            { "value":26.2,
              "lastUpdated":"2022-06-24T10:50:30.187Z",
              "type":"number",
              "getable":true,
              "setable":false,
              "title":"internal temperature",
              "desc":"Temperatur i grader Celsius (°C)",
              "units":"°C",
              "decimals":2,
              "chartType":"spline",
              "id":"measure_temperature.internal",
              "options":{"title":"internal temperature"}},
          "measure_temperature.external":
            { "value":0,
              "lastUpdated":"2022-06-24T08:55:29.671Z",
              "type":"number",
              "getable":true,
              "setable":false,
              "title":"external temperature",
              "desc":"Temperatur i grader Celsius (°C)",
              "units":"°C",
              "decimals":2,
              "chartType":"spline",
              "id":"measure_temperature.external",
              "options":{"title":"external temperature"}},
          "measure_temperature.floor":
            { "value":22.6,
              "lastUpdated":"2022-06-24T10:05:30.100Z",
              "type":"number",
              "getable":true,
              "setable":false,
              "title":"floor temperature",
              "desc":"Temperatur i grader Celsius (°C)",
              "units":"°C",
              "decimals":2,
              "chartType":"spline",
              "id":"measure_temperature.floor",
              "options":{"title":"floor temperature"}},
          "thermostat_mode_single":
            { "value":"Off",
              "lastUpdated":"2022-06-24T10:00:43.752Z",
              "type":"enum",
              "getable":true,
              "setable":true,
              "title":"Thermostat mode",
              "desc":"Mode of the thermostat",
              "units":null,
              "values":[{"id":"Heat","title":"Heating"},{"id":"Off","title":"Off"}],
              "id":"thermostat_mode_single",
              "options":{}},
          "thermostat_state":{
            "value":false,
            "lastUpdated":"2022-06-24T02:56:54.302Z",
            "type":"boolean",
            "getable":true,
            "setable":false,
            "title":"Heating",
            "desc":"State of the thermostat",
            "units":null,
            "iconObj":{
              "id":"2b11a93d77f014679e78fc46222143c7",
              "url":"/icon/2b11a93d77f014679e78fc46222143c7/icon.svg"},
            "id":"thermostat_state",
            "options":{
              "greyout":true,
              "titleTrue":{"en":"Active","nl":"Actief"},
              "titleFalse":{"en":"Idle","nl":"Uit"}},
            "titleTrue":"Active",
            "titleFalse":"Idle"},
          "onoff":{
            "value":false,
            "lastUpdated":"2022-06-24T10:00:43.556Z",
            "type":"boolean",
            "getable":true,
            "setable":true,
            "title":"Slått på",
            "desc":null,
            "units":null,
            "id":"onoff",
            "options":{
              "titleTrue":{"en":"mode `Heating`","nl":"modus `Verwarmen`"},
              "titleFalse":{"en":"mode `Off`","nl":"modus `Off`"},
              "insightsTitleTrue":{"en":"Thermostat mode `Heating` activated","nl":"Thermostat modus `Verwarmen` ingeschakeld"},
              "insightsTitleFalse":{"en":"Thermostat mode `Off` activated","nl":"Thermostat modus `Uit` ingeschakeld"}},
            "titleTrue":"mode `Heating`",
            "titleFalse":"mode `Off`"},
          "measure_power":{
            "value":0.09,
            "lastUpdated":"2022-06-24T10:53:30.144Z",
            "type":"number",
            "getable":true,
            "setable":false,
            "title":"Effekt",
            "desc":"Effekt i watt (W)",
            "units":"W",
            "decimals":2,
            "chartType":"stepLine",
            "id":"measure_power",
            "options":{"approximated":true}},
          "measure_voltage":{
            "value":235.1,
            "lastUpdated":"2022-06-24T10:53:30.168Z",
            "type":"number",
            "getable":true,
            "setable":false,
            "title":"Spenning",
            "desc":"Spenning (V)",
            "units":"V",
            "decimals":2,
            "chartType":"stepLine",
            "id":"measure_voltage",
            "options":{}},
          "meter_power":{
            "value":955.9,
            "lastUpdated":"2022-06-24T02:54:57.284Z",
            "type":"number",
            "getable":true,
            "setable":false,
            "title":"Energi",
            "desc":"Energiforbruk i kilowattimer (kWh)",
            "units":"kWh",
            "decimals":2,
            "chartType":"spline",
            "id":"meter_power",
            "options":{}}
          "target_temperature":{
            "value":null,
            "lastUpdated":"2022-06-24T10:00:43.137Z",
            "type":"number",
            "getable":true,
            "setable":true,
            "title":"Ønsket temperatur",
            "desc":null,
            "units":"°C",
            "decimals":2,
            "min":5,
            "max":40,
            "step":0.5,
            "chartType":"stepLine",
            "id":"target_temperature",
            "options":{"min":5,"max":40,"step":0.5}},
          "button.reset_meter":{
            "value":null,
            "lastUpdated":null,
            "type":"boolean",
            "getable":false,
            "setable":true,
            "title":"Reset power meter"
            "desc":"Reset the accumulated power usage (kWh), note that this can not be reversed.",
            "units":null,
            "id":"button.reset_meter",
            "options":{
              "maintenanceAction":true,
              "title":{"en":"Reset power meter","nl":"Stel stroomverbuik opnieuw in"},
              "desc":{
                "en":"Reset the accumulated power usage (kWh), note that this can not be reversed.",
                "nl":"Stel geaccumuleerde stroomverbruik (kWh) opnieuw in, dit kan niet worden teruggedraaid."
              }
            }
          }
        },
      "flags":["zwave","zwaveRoot"],
      "ui":{
        "quickAction":"onoff",
        "components":[
          {"id":"thermostat","capabilities":["measure_temperature","target_temperature"]},
          {"id":"toggle","capabilities":["onoff"]},
          {"id":"picker","capabilities":["thermostat_mode_single"]},
          {"id":"sensor","capabilities":["measure_temperature.internal","measure_temperature.external","measure_temperature.floor","thermostat_state","measure_power","measure_voltage","meter_power"]}],
        "componentsStartAt":0},
      "uiIndicator":null,
      "ready":true,
      "available":true,
      "repair":false,
      "unpair":true,
      "unavailableMessage":null,
      "images":[],
      "insights":[
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"measure_temperature",
        "type":"number",
        "title":"temperature",
        "titleTrue":null,
        "titleFalse":null,
        "units":"°C",
        "decimals":2},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"measure_temperature.internal",
        "type":"number",
        "title":"internal temperature",
        "titleTrue":null,
        "titleFalse":null,
        "units":"°C",
        "decimals":2},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"measure_temperature.external",
        "type":"number",
        "title":"external temperature",
        "titleTrue":null,
        "titleFalse":null,
        "units":"°C",
        "decimals":2},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"measure_temperature.floor",
        "type":"number",
        "title":"floor temperature",
        "titleTrue":null,
        "titleFalse":null,
        "units":"°C",
        "decimals":2},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"thermostat_state",
        "type":"boolean",
        "title":"Heating",
        "titleTrue":"Heating active",
        "titleFalse":"Heating idle",
        "units":null,
        "decimals":null},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"onoff",
        "type":"boolean",
        "title":"Slått på",
        "titleTrue":"Thermostat mode `Heating` activated",
        "titleFalse":"Thermostat mode `Off` activated",
        "units":null,
        "decimals":null},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"measure_power",
        "type":"number",
        "title":"Effekt",
        "titleTrue":null,
        "titleFalse":null,
        "units":"W",
        "decimals":2},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"measure_voltage",
        "type":"number",
        "title":"Spenning",
        "titleTrue":null,
        "titleFalse":null,
        "units":"V",
        "decimals":2},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"meter_power",
        "type":"number",
        "title":"Energi",
        "titleTrue":null,
        "titleFalse":null,
        "units":"kWh",
        "decimals":2},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"target_temperature",
        "type":"number",
        "title":"Ønsket temperatur",
        "titleTrue":null,
        "titleFalse":null,
        "units":"°C",
        "decimals":2},
        {"uri":"homey:device:33fa2e27-a8cb-4e65-87f8-13545305101a",
        "id":"energy_power",
        "type":"number",
        "title":"Strømbruk",
        "units":"W",
        "decimals":2}],
      "color":"#cc3333",
      "data":{"token":"5e586ca7-b39b-4a8f-a510-729a498a4adf"}
    },
    "priority":3
  },
*/