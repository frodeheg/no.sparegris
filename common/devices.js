/* eslint-disable node/no-unsupported-features/es-syntax */
/* eslint-disable comma-dangle */

'use strict';

// All device types has the following parameters:
//   type           - Device type
//   setOnOffCap    - Capability for turning on and off
//   setOnValue     - Value for setOnOffCap to turn device on
//   setOffValue    - Value for setOnOffCap to turn devie off
//   beta           - true if not fully supported yet, undefined otherwise
//   default        - true if the device is default, undefined otherwise
//   workaround     - undefined except if the device is known to be unreliable and have a workaround
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
//   +all HEATER parameters
// CHARGER : Additional parameters
//   setCurrentCap - Capability for changing the charging current (in Amps)

// Device types
const DEVICE_TYPE = {
  SWITCH: 0,
  HEATER: 1,
  WATERHEATER: 2,
  AC: 3,
  CHARGER: 4,
  IGNORE: 5
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

// Default Ignored device:
const DEFAULT_IGNORED = {
  type: DEVICE_TYPE.IGNORE
};

// Supported devices and how to use them
const DEVICE_CMD = {
  'cloud.shelly:shelly': DEFAULT_SWITCH,
  'com.aeotec:ZW078': DEFAULT_SWITCH,
  'com.arjankranenburg.virtual:mode': DEFAULT_SWITCH,
  'com.everspring:AN179': DEFAULT_SWITCH,
  'com.fibaro:FGS-213': DEFAULT_SWITCH,
  'com.gardena:water-control': DEFAULT_IGNORED,
  'com.ikea.tradfri:control_outlet': DEFAULT_SWITCH, // Not confirmed
  'com.neo:NAS-WR02ZE': DEFAULT_SWITCH,
  'com.philips.hue.zigbee:LCL001': DEFAULT_SWITCH,
  'com.sensibo:Sensibo': {
    type: DEVICE_TYPE.AC,
    setOnOffCap: 'se_onoff',
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
    setModeAutoValue: 'auto'
  },
  'com.tuya.cloud:tuyalight': DEFAULT_SWITCH,
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
  'me.nanoleaf:shapes': DEFAULT_SWITCH,
  'net.filllip-namron:4512744': {
    ...DEFAULT_HEATER,
    tempMin: 4,
    tempMax: 35,
    default: false
  },
  'nl.klikaanklikuit:ACC-250': DEFAULT_SWITCH,
  'nl.klikaanklikuit:AWMR-210': DEFAULT_SWITCH,
  'no.almli.thermostat:VThermo': {
    ...DEFAULT_HEATER,
    tempMin: 4,
    tempMax: 35,
    default: false
  },
  'no.connecte:smart_socket': DEFAULT_SWITCH,
  'no.easee:charger': {
    type: DEVICE_TYPE.CHARGER,
    setOnOffCap: 'onoff',
    setOnValue: true,
    setOffValue: false,
    setCurrentCap: 'target_circuit_current',
    beta: true
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
  'no.thermofloor:ZM-Single-Relay-16A': DEFAULT_SWITCH,
  'se.nexa:EYCR-2300': DEFAULT_SWITCH,
  'vdevice:homey': DEFAULT_IGNORED, // Under homey:manager, not homey:app:
  'vdevice:virtual_socket': DEFAULT_SWITCH, // Under homey:manager, not homey:app:
  'vdevice:zwavebasic': DEFAULT_SWITCH, // Under homey:manager, not homey:app:
  'vdevice:zigbeebasic': DEFAULT_SWITCH, // Under homey:manager, not homey:app:
  default_heater: DEFAULT_HEATER,
  default_switch: DEFAULT_SWITCH,
};

module.exports = {
  DEVICE_TYPE,
  DEVICE_CMD
};
