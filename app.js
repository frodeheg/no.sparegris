'use strict';

const Homey = require('homey');
const Mutex = require('async-mutex').Mutex;
const { HomeyAPIApp } = require('homey-api');
const { stringify } = require('querystring');

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
    this.mutex = new Mutex();

    // Check that settings has been updated
    const maxPower = this.homey.settings.get('maxPower')
    if (isNaN(maxPower)) {
      throw("Please configure the app before continuing");
    }

    // Create list of devices
    this.__deviceList = await this.createDeviceList();

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
    const api = new HomeyAPIApp({
      homey: this.homey,
    });
    const devices = await api.devices.getDevices();

    var relevantDevices = [];

    // Loop all devices
    for(var device of Object.values(devices)) {
      // Relevant Devices must have onoff capability
      if (!device.capabilities.includes("onoff")) {
        //this.log("ignoring: " + device.name)
        continue;
      }
      // Priority 1 devices has class = thermostat & heater - capabilities ['target_temperature' + 'measure_temperature']
      const priority =
        (device.capabilities.includes("target_temperature") ?1:0) +
        (device.capabilities.includes("measure_temperature")?1:0) +
        ((device.class == "thermostat" || device.class == "heater")?1:0);

      // Filter out irrelevant devices (preferably done by settings in the future)
      var isRelevant = (priority > 0) ? true : false;

      if (isRelevant) {
        this.log("Device: " + String(priority) + " " + device.name + " " + device.class)
        var relevantDevice = { "device": device, "priority": priority }
        relevantDevices.push(relevantDevice)
      }
    }
    // Turn device on
    return relevantDevices
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

    this.log("onPowerUpdate: "
      + String(newPower) + "W, "
      + String(this.__accum_energy.toFixed(2)) + " Wh (Estimated end: " 
      + String(this.__estimated_end_usage.toFixed(2)) + ")")

    // Check if power can be increased or reduced
    const maxPower = this.homey.settings.get('maxPower')
    this.log("Jadda: " + String(maxPower) + ", " + String(this.__accum_energy) + ", " + String(this.__reserved_energy) + ", " + String(newPower))
    var power_diff = ((maxPower - this.__accum_energy - this.__reserved_energy) * (1000*60*60) / remaining_time) - newPower;
    if (power_diff < 0) {
      this.onAbovePowerLimit(-power_diff)
    } else if (power_diff > 0) {
      this.onBelowPowerLimit(power_diff)
    }
  }


  /**
   * onModeUpdate is called whenever the operation mode is changed
   */
  async onModeUpdate(newMode) {
    this.log("The current mode changed to: " + String(newMode))
  }


  /**
   * onBelowPowerLimit is called whenever power changed and we're allowed to use more power
   */
  async onBelowPowerLimit(morePower) {
    this.log("Can use " + String(morePower) + "W more power")

//    this.log("hmmm devicelist")
//    await this.__deviceList[0].device.setCapabilityValue({ capabilityId: 'onoff', value: true }); 
//    this.log("jadda")

    var numDevices = this.__deviceList.length;
    for (var idx = 0; idx < numDevices; idx++) {
      const device = this.__deviceList[idx].device;
      const isOn = await (!device.capabilities.includes("onoff")) ? undefined : device.capabilitiesObj['onoff'].value;
      //await device.setCapabilityValue({ capabilityId: 'onoff', value: true }); 
      //"measure_power"
      this.log("Num: " + String(idx) + " on: " + String(isOn))
    }
  }


  /**
   * onReducePower is called whenever power changed and we use too much
   */
  async onAbovePowerLimit(lessPower) {
    this.log("Must reduce power usage by " + String(lessPower) + "W")
  }


}

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