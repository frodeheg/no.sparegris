/* eslint-disable node/no-unsupported-features/es-syntax */
/* eslint-disable comma-dangle */

'use strict';

// ===== CONTROLLABLE DEVICES =====
// All controllable devices has the following parameters:
//   type           - Device type
//   setOnOffCap    - Capability for turning on and off
//   setOnValue     - Value for setOnOffCap to turn device on
//   setOffValue    - Value for setOnOffCap to turn devie off
//   beta           - true if not fully supported yet, undefined otherwise
//   default        - true if the device is default, undefined otherwise
//   workaround     - undefined except if the device is known to be unreliable and have a workaround
// Special case devices may have these parameters:
//   identifierCap  - A capability that need to be present in order to identify the device.
//                    This is used in case multiple devices are represented in the same driver.
//                    These will be represented in the table with an array index in the driverId.
// HEATER : Additional parameters
//   readTempCap    - Capability for reading temperature
//   setTempCap     - Capability for setting temperature
//   tempMin        - Minimum temperature
//   tempMax        - Maximum temperature
//   tempStep       - Temperature step
// AC : Additional paramteres
//   setModeCap         - Capability for setting mode
//   setModeHeatValue   - Value for setModeCap to enter heat mode
//   setModeCoolValue   - Value for setModeCap to enter cool mode
//   setModeAutoValue   - Value for setModeCap to enter auto mode
//   setModeDryValue    - undefined if unavailable value for setModeCap to enter dry mode else
//   setModeFanValue    - undefined if unavailable value for setModeCap to enter fan mode else
//   +all HEATER parameters
// CHARGER : Additional parameters
//   getBatteryCap     - Capability to read battery level (if present)
//   setCurrentCap     - Capability for changing the offered current (in Amps)
//   minCurrent        - The offered current should never be lower than this
//   measurePowerCap   - Capability for reading used power
//   measureVoltageCap - Capability for reading voltage
//   statusCap         - Capability for reading charger state
// CHARGE_CONTROLLER
//   setOnOffCap       - This is not present here, onoff for this device means controlled by piggy vs. not controlled by piggy
//   setPowerCap       - To set target power
//
// ===== INPUT DEVICES =====
// All input devices has the following parameters:
//   type          - Device type
// METERREADER : Additional parameters
//   readPowerCap       - Capability for reading imported power (W)
//   readPowerExportCap - Capability for reading exported power (W) (Defaults to negative portion of readPowerCap when undefined)
//   readMeterCap       - Capability for reading imported energy (kWh) (it can be reset every day/hour, this is auto-detected, the important part is to use one that updates often)
//   readMeterExportCap - Capability for reading exported energy (kWh) (can be undefined)

// Device types
// Note for CHARGER:
// - A charger device will when power is too high or too low try to increase/decrease
//   the charging current rather than turning the device on/off.
const DEVICE_TYPE = {
  SWITCH: 0,
  HEATER: 1,
  WATERHEATER: 2,
  AC: 3,
  CHARGER: 4,
  IGNORE: 5,
  METERREADER: 6,
  CHARGE_CONTROLLER: 7
};

// Default onoff device:
const DEFAULT_SWITCH = {
  type: DEVICE_TYPE.SWITCH,
  setOnOffCap: 'onoff',
  setOnValue: true,
  setOffValue: false,
  default: true
};

// Default heating device:
const DEFAULT_HEATER = {
  type: DEVICE_TYPE.HEATER,
  setOnOffCap: 'onoff',
  setOnValue: true,
  setOffValue: false,
  readTempCap: 'measure_temperature',
  setTempCap: 'target_temperature',
  tempMin: 5,
  tempMax: 40,
  tempStep: 0.5,
  default: true
};

// Default AC
const DEFAULT_AC = {
  type: DEVICE_TYPE.AC,
  setOnOffCap: 'onoff',
  setOnValue: true,
  setOffValue: false,
  readTempCap: 'measure_temperature',
  setTempCap: 'target_temperature',
  tempMin: 10,
  tempMax: 30,
  tempStep: 1,
  setModeCap: 'thermostat_mode',
  setModeHeatValue: 'heat',
  setModeCoolValue: 'cool',
  setModeAutoValue: 'auto',
  default: true
};

// Default charger
const DEFAULT_CHARGER = {
  type: DEVICE_TYPE.CHARGER,
  setOnOffCap: 'onoff',
  setOnValue: true,
  setOffValue: false,
  default: true
};

// Default Ignored device:
const DEFAULT_IGNORED = {
  type: DEVICE_TYPE.IGNORE
};

// Default Meter reader device:
const DEFAULT_METER = {
  type: DEVICE_TYPE.METERREADER,
  readPowerCap: 'measure_power',
  readMeterCap: 'meter_power',
  default: true
};

// Default Solar devices:
const DEFAULT_SOLAR = {
  type: DEVICE_TYPE.IGNORE
}

// Supported devices and how to use them
const DEVICE_CMD = {
  'ady.smartthings:stDevice': {
    ...DEFAULT_AC,
    tempMin: 4,
    tempMax: 35,
    tempStep: 0.5,
    setModeCap: 'aircon_mode',
    setModeDryValue: 'dry',
    setModeFanValue: 'wind',
    default: false
  },
  'climate.onecta.daikin:altherma3_geo:0': {
    identifierCap: 'hotwatertank_onoff_altherma3',
    type: DEVICE_TYPE.SWITCH,
    setOnOffCap: 'hotwatertank_onoff_altherma3',
    setOnValue: 'on',
    setOffValue: 'off',
    default: false
  },
  'climate.onecta.daikin:altherma3_geo:1': {
    identifierCap: 'onoff',
    type: DEVICE_TYPE.SWITCH,
    setOnOffCap: 'onoff',
    setOnValue: true,
    setOffValue: false
  },
  'climate.onecta.daikin:perfera_floor_fvxm': {
    ...DEFAULT_AC,
    tempStep: 0.5,
    setModeCap: 'operation_mode',
    setModeHeatValue: 'heating',
    setModeCoolValue: 'cooling',
    setModeAutoValue: 'auto',
    setModeDryValue: 'dry',
    setModeFanValue: 'fanOnly',
    default: false
  },
  'climate.onecta.daikin:stylish_ftxa': {
    ...DEFAULT_AC,
    tempStep: 0.5,
    setModeCap: 'operation_mode',
    setModeHeatValue: 'heating',
    setModeCoolValue: 'cooling',
    setModeDryValue: 'dry',
    setModeFanValue: 'fanOnly',
    default: false
  },
  'cloud.shelly:shelly': DEFAULT_SWITCH,
  'com.aeotec:ZW078': DEFAULT_SWITCH,
  'com.arjankranenburg.virtual:mode': DEFAULT_SWITCH,
  'com.arjankranenburg.virtual:virtual_switch': { // Similar to Vthermo
    ...DEFAULT_AC,
    note: 'This device has no onOff capability and will have to emulate On by turning the mode into heat. '
      + 'For cool mode please wait until the app supports cooling (after winter).',
    setOnOffCap: 'thermostat_mode',
    setOnValue: 'heat', // This is unfortunate
    setOffValue: 'off',
    tempMin: undefined, // This depends on what is connected
    tempMax: undefined, // --- " ---
    beta: true, // Need to be in beta until fan modes is supported otherwise it's heating only
    tempStep: 0.5,
    default: false
  },
  'com.balboa:Balboa': {
    type: DEVICE_TYPE.HEATER,
    note: 'This device has no onOff capability and will emulate Off by turning the temperature to absolute minimum',
    setOnOffCap: null,
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 26.5,
    tempMax: 40,
    tempStep: 0.5
  },
  'com.Coderax.MillHeating:mill': {
    ...DEFAULT_HEATER,
    tempMin: 4,
    tempMax: 35,
    tempStep: 0.5,
    default: false
  },
  'com.ctmlyng.op:mtouch-one': {
    ...DEFAULT_HEATER,
    setOnOffCap: 'operationMode',
    setOnValue: '3',
    setOffValue: '0',
    default: false
  },
  'com.datek.eva:meter-reader': DEFAULT_METER,
  'com.datek.eva:smart-plug': DEFAULT_SWITCH,
  'com.DevelcoProducts:EMIZB-132': DEFAULT_METER,
  'com.elko:ESHSUPERTR': {
    ...DEFAULT_HEATER,
    note: 'Please note that the vendor of this device only expose the capability to set temperature in case the device is '
      + 'configured as a thermostat. When in regulator mode this app will only be able to control it as a switch. You may '
      + 'have to reinstall the device in Homey if you ever change this setting in order to make the device appear correctly '
      + 'in Piggy.',
    readTempCap: 'measure_temperature.floor', // measure_temperature can be null if set to regulator mode
    setOnOffCap: 'power_status',
    tempMax: 50,
    default: false
  },
  'com.elko:SmartDimPir': DEFAULT_SWITCH,
  'com.everspring:AN179': DEFAULT_SWITCH,
  'com.fibaro:FGS-213': DEFAULT_SWITCH,
  'com.fibaro:FGWPE-101': DEFAULT_SWITCH,
  'com.fibaro:FGWPx-102-PLUS': DEFAULT_SWITCH,
  'com.gardena:water-control': DEFAULT_IGNORED,
  'com.gree:gree_cooper_hunter_hvac': {
    ...DEFAULT_AC,
    tempMin: 16,
    setModeDryValue: 'dry',
    setModeFanValue: 'fan_only',
    default: false
  },
  'com.gruijter.powerhour:power': DEFAULT_IGNORED,
  'com.home-connect:dishwasher': DEFAULT_IGNORED,
  'com.home-connect:dryer': DEFAULT_IGNORED,
  'com.homewizard:energy': {
    ...DEFAULT_METER,
    readPowerCap: 'measure_power', // Combination of import and export, negative when export
    readMeterCap: 'meter_power.consumed',
    readMeterExportCap: 'meter_power.returned',
    default: false
  },
  'com.ikea.tradfri:control_outlet': DEFAULT_SWITCH, // Not confirmed
  'com.mecloud:melcloud': {
    ...DEFAULT_AC,
    tempMax: 38,
    tempStep: 0.5,
    default: false
  },
  'com.mennovanhout.smartthings:air_conditioning': {
    ...DEFAULT_AC,
    tempMin: 4,
    tempMax: 35,
    tempStep: 0.5,
    setModeCap: 'air_conditioning_mode',
    setModeHeatValue: 'heat',
    setModeCoolValue: 'cool',
    setModeAutoValue: 'auto',
    setModeDryValue: 'dry',
    setModeFanValue: 'wind',
    default: false
  },
  'com.mill:mill': {
    type: DEVICE_TYPE.HEATER,
    setOnOffCap: 'onoff',
    setOnValue: true,
    setOffValue: false,
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 4,
    tempMax: 35,
    tempStep: 0.5
  },
  'com.neo:NAS-WR02ZE': DEFAULT_SWITCH,
  'com.nibeuplink:com.nibeuplink.system': {
    ...DEFAULT_SWITCH,
    note: 'OnOff for this device control temporary lux.',
    setOnOffCap: 'temporary_lux',
    setOnValue: true,
    setOffValue: false,
    default: false
  },
  'com.panasonic.PCC:comfortcloud': {
    ...DEFAULT_AC,
    tempMin: 4,
    tempMax: 35,
    tempStep: 0.5, // Actually 0.01 but this is pointless
    setModeCap: 'operationMode',
    setModeHeatValue: 'Heat',
    setModeCoolValue: 'Cool',
    setModeAutoValue: 'Auto',
    setModeDryValue: 'Dry',
    setModeFanValue: 'Fan',
    default: false
  },
  'com.philips.hue.zigbee:LCL001': DEFAULT_SWITCH,
  'com.qubino:ZMNKID': {
    ...DEFAULT_HEATER,
    setOnOffCap: 'offAutoThermostatMode',
    setOnValue: 'auto',
    setOffValue: 'off',
    setTempCap: 'target_temperature',
    tempMin: -25,
    tempMax: 85,
    default: false
  },
  'com.samsung.smart:Samsung': DEFAULT_IGNORED, // TV
  'com.sensibo:Sensibo': {
    ...DEFAULT_AC,
    note: 'In case your AC device makes a beeping sound whenever signaled by a remote control, please consult your AC device '
      + 'service manual how to disable the sound before this app makes your head go crazy.',
    setOnOffCap: 'se_onoff',
    default: false
  },
  'com.swttt.devicegroups:light': DEFAULT_SWITCH,
  'com.tado2:valve': {
    ...DEFAULT_HEATER,
    type: DEVICE_TYPE.HEATER,
    setOnOffCap: 'power_mode',
    setOnValue: 'ON',
    setOffValue: 'OFF',
    tempMax: 25,
    default: false
  },
  'com.tesla.charger:Tesla': {
    type: DEVICE_TYPE.CHARGER,
    setOnOffCap: 'charge_mode',
    setOnValue: 'charge_now',
    setOffValue: 'off',
    getBatteryCap: 'measure_battery',
    measurePowerCap: 'measure_power',
    statusCap: 'charging_state',
    statusUnavailable: ['Complete', 'Disconnected', 'Error????'], // Other observed: Charging, Stopped
    statusProblem: ['Error????'],
    note: 'In order to control this device, please install and enable the Charge controller device',

    onChargeStart: {
      target_circuit_current: Infinity
    },
    onChargeEnd: {
      target_circuit_current: 0
    },
    onAdd: {
      target_charger_current: 0,
      target_circuit_current: 0
    },
    onRemove: {
      target_charger_current: Infinity,
      target_circuit_current: Infinity
    },
    setCurrentCap: 'target_charger_current',
    getOfferedCap: 'measure_current.offered',
    startCurrent: 11,
    minCurrent: 7,
    pauseCurrent: 4
  },
  'com.tibber:home': DEFAULT_IGNORED,
  'com.tibber:pulse': DEFAULT_METER,
  'com.toshiba:ac': { // Note! Has power-step modes (target_power_mode)
    ...DEFAULT_AC,
    tempMin: 5,
    setModeCap: 'target_ac_mode1',
    setModeHeatValue: 'Heat',
    setModeCoolValue: 'Cool',
    setModeAutoValue: 'Auto',
    setModeDryValue: 'Dry',
    setModeFanValue: 'Fan',
    default: false
  },
  'com.tuya.cloud:tuyalight': DEFAULT_SWITCH,
  'com.xiaomi-mi:plug.maeu01': DEFAULT_SWITCH,
  'com.xiaomi-mi:sensor_motion.aq2': DEFAULT_IGNORED,
  'com.zaptec:go': {
    type: DEVICE_TYPE.CHARGER,
    setOnOffCap: 'charging_button',
    setOnValue: true,
    setOffValue: false,
    measurePowerCap: 'measure_power',
    statusCap: 'charge_mode',
    statusUnavailable: ['Charging finished', 'Disconnected', 'Unknown'],
    statusProblem: ['Unknown'],
    note: 'In order to control this device, please install and enable the Charge controller device',
    // setCurrentCap: 'target_charger_current',  // Not available
    // getOfferedCap: 'measure_current.offered', // Available, but ignore when not setable
    default: false
  },
  'fi.taelek.ecocontrol:oled': {
    type: DEVICE_TYPE.HEATER,
    note: 'This device has no onOff capability and will emulate Off by turning the temperature to absolute minimum',
    setOnOffCap: null,
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 5,
    tempMax: 30,
    tempStep: 0.5
  },
  'it.diederik.solar:growatt': DEFAULT_SOLAR,
  'me.nanoleaf:shapes': DEFAULT_SWITCH,
  'net.filllip-namron:4512725': {
    ...DEFAULT_HEATER,
    tempMin: 4,
    tempMax: 35,
    default: false
  },
  'net.filllip-namron:4512744': {
    ...DEFAULT_HEATER,
    tempMin: 4,
    tempMax: 35,
    default: false
  },
  'net.filllip-namron:4512746': DEFAULT_SWITCH,
  'net.filllip-namron:4512749': DEFAULT_SWITCH,
  'net.filllip-namron:540139x': {
    ...DEFAULT_HEATER,
    tempMax: 35,
    default: false
  },
  'nl.climate.daikin:airairhp': {
    ...DEFAULT_AC,
    note: 'This device has no onOff capability and will have to emulate On by turning the mode into heat. '
      + 'Please contact the developer of the Daikin app and request that the onOff capability is added and report back when done. This will fix the Piggy Bank integration.',
    setOnOffCap: 'thermostat_mode_std',
    setOnValue: 'heat', // This is unfortunate
    setOffValue: 'off',
    tempMax: 32,
    setModeCap: 'thermostat_mode_std',
    setModeDryValue: 'dehumid',
    setModeFanValue: 'fan',
    beta: true, // Need to be in beta until fan modes is supported otherwise it's heating only
    default: false
  },
  'nl.hdg.mqtt:device': {
    ...DEFAULT_METER,
    readMeterCap: 'meter_power.day',
    default: false
  },
  'nl.klikaanklikuit:ACC-250': DEFAULT_SWITCH,
  'nl.klikaanklikuit:AWMR-210': DEFAULT_SWITCH,
  'nl.philips.hue:bulb': DEFAULT_SWITCH,
  'no.adax.smart-heater.homey-app:heater-wt': {
    ...DEFAULT_HEATER,
    tempMax: 35,
    tempStep: 1,
    default: false
  },
  'no.almli.thermostat:VThermo': {
    ...DEFAULT_HEATER,
    tempMin: undefined, // For vthermo this depends on what is connected
    tempMax: undefined, // --- " ---
    default: false
  },
  'no.connecte:puck_relay': DEFAULT_SWITCH,
  'no.connecte:smart_socket': DEFAULT_SWITCH,
  'no.connecte:thermostat': {
    ...DEFAULT_HEATER,
    tempMax: 35,
    tempStep: 1,
    default: false
  },
  'no.connecte:thermostat_pm': {
    ...DEFAULT_HEATER,
    tempMax: 35,
    tempStep: 1,
    default: false
  },
  'no.easee:charger': {
    ...DEFAULT_CHARGER,
    onChargeStart: {
      target_circuit_current: Infinity
    },
    onChargeEnd: {
      target_circuit_current: 0
    },
    onAdd: {
      target_charger_current: 0,
      target_circuit_current: 0
    },
    onRemove: {
      target_charger_current: Infinity,
      target_circuit_current: Infinity
    },
    setCurrentCap: 'target_charger_current',
    getOfferedCap: 'measure_current.offered',
    startCurrent: 11,
    minCurrent: 7,
    pauseCurrent: 4,
    measurePowerCap: 'measure_power',
    statusCap: 'charger_status',
    statusUnavailable: ['Completed', 'Standby', 'Error'],
    statusProblem: ['Error'],
    note: 'In order to control this device, please install and enable the Charge controller device',
    default: false
  },
  'no.easee:equalizer': {
    ...DEFAULT_METER,
    readPowerExportCap: 'measure_power.surplus',
    readMeterExportCap: 'meter_power.surplus',
    default: false
  },
  'no.elko:smart_plus_thermostat': {
    type: DEVICE_TYPE.HEATER,
    note: 'This device has no onOff capability and will emulate Off by turning the temperature to absolute minimum',
    setOnOffCap: null, // There is no such capability for this device
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 4,
    tempMax: 30,
    tempStep: 0.5
  },
  'no.elko:super_tr_thermostat': {
    ...DEFAULT_HEATER
  },
  'no.hoiax:hiax-connected-200': {
    type: DEVICE_TYPE.WATERHEATER,
    setOnOffCap: 'onoff',
    setOnValue: true,
    setOffValue: false,
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 20,
    tempMax: 85,
    tempStep: 0.5
  },
  'no.sparegris:piggy-bank-insights': DEFAULT_IGNORED,
  'no.sparegris:piggy-charger': {
    type: DEVICE_TYPE.CHARGE_CONTROLLER,
    setPowerCap: 'target_power'
  },
  'no.thermofloor:TF_Thermostat': {
    type: DEVICE_TYPE.HEATER,
    setOnOffCap: 'thermofloor_mode',
    setOnValue: 'Heat',
    setOffValue: 'Off',
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 5,
    tempMax: 40,
    tempStep: 0.5
  },
  'no.thermofloor:ZM-Single-Relay-16A': DEFAULT_SWITCH,
  'no.thermofloor:ZM-Thermostat-16A': {
    ...DEFAULT_HEATER,
    setOnOffCap: 'thermostat_mode_13570',
    setOnValue: 'heat',
    setOffValue: 'off',
    tempMin: 4,
    tempMax: 35,
    tempStep: 0.5, // Actually 0.01
    default: false
  },
  'no.thermofloor:Z-Relay': DEFAULT_SWITCH,
  'no.thermofloor:Z-TRM2fx': {
    type: DEVICE_TYPE.HEATER,
    setOnOffCap: 'thermofloor_mode',
    setOnValue: 'Heat',
    setOffValue: 'Off',
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 5,
    tempMax: 40,
    tempStep: 0.5
  },
  'no.thermofloor:Z-TRM3': {
    ...DEFAULT_HEATER,
    workaround: 'The Z-TRM3 devices are known to lose connection with homey when using encryption. You can try to pair it again with code 0000 to make it unencrypted as this is much more reliable.',
    default: false
  },
  'org.knx:knx_dimmer': DEFAULT_SWITCH,
  'org.knx:knx_thermostat': {
    type: DEVICE_TYPE.HEATER,
    note: 'This device has no onOff capability and will emulate Off by turning the temperature to absolute minimum',
    setOnOffCap: null, // There is no such capability for this device
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 4,
    tempMax: 35,
    tempStep: 0.5
  },
  'se.ebeco.connect:thermostat': {
    type: DEVICE_TYPE.HEATER,
    note: 'This device has no onOff capability and will emulate Off by turning the temperature to absolute minimum',
    setOnOffCap: null, // There is no such capability for this device
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 4,
    tempMax: 35,
    tempStep: 1
  },
  'se.husdata:H60': {
    type: DEVICE_TYPE.HEATER,
    note: 'This device has no onOff capability and will emulate Off by turning the temperature to absolute minimum',
    setOnOffCap: null, // There is no such capability for this device
    readTempCap: 'RADIATOR_RETURN_TEMP', // Indoor temp does not work on the device in question...
    setTempCap: 'target_temperature',
    tempMin: 4,
    tempMax: 35,
    tempStep: 0.5,
    beta: true
  },
  'se.nexa:EYCR-2300': DEFAULT_SWITCH,
  'se.nexa:MYC-2300S': DEFAULT_SWITCH,
  'tesla.wall.connector:twc': DEFAULT_IGNORED, // Tesla charger, gen 3
  'vdevice:homey': DEFAULT_IGNORED, // Under homey:manager, not homey:app:
  'vdevice:virtual_socket': DEFAULT_SWITCH, // Under homey:manager, not homey:app:
  'vdevice:zwavebasic': DEFAULT_SWITCH, // Under homey:manager, not homey:app:
  'vdevice:zigbeebasic': DEFAULT_SWITCH, // Under homey:manager, not homey:app:
  default_heater: DEFAULT_HEATER,
  default_switch: DEFAULT_SWITCH,
};

/**
 * Generate a driverId to be used for lookups in the table above
 */
function generateDriverId(device) {
  let driverId = device.driverId.split(':').slice(2).join(':');
  if (!(driverId in DEVICE_CMD)) {
    let idx = 0;
    let checkForOddDriver = !(driverId in DEVICE_CMD);
    while (checkForOddDriver) {
      const newDriverId = `${driverId}:${idx}`;
      if (newDriverId in DEVICE_CMD) {
        if (device.capabilities.includes(DEVICE_CMD[newDriverId].identifierCap)) {
          driverId = newDriverId;
          checkForOddDriver = false;
        } else {
          idx++;
          checkForOddDriver = true;
        }
      } else {
        checkForOddDriver = false;
      }
    }
  }
  return driverId;
}

module.exports = {
  DEVICE_TYPE,
  DEVICE_CMD,
  generateDriverId
};

// When including this file in a web-page, inform the main page that loading is complete
if (typeof onScriptLoaded === 'function') {
  onScriptLoaded('devices.js');
} // else the script is not used in a web-page
