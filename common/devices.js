/* eslint-disable comma-dangle */

'use strict';

// All device types has the following parameters:
//   type           - Device type
//   setOnOffCap    - Capability for turning on and off
//   setOnValue     - Value for setOnOffCap to turn device on
//   setOffValue    - Value for setOnOffCap to turn devie off
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
// CHARGER : TBD

// Device types
const DEVICE_TYPE = {
  SWITCH: 0,
  HEATER: 1,
  AC: 2,
  CHARGER: 3
};

// Default onoff device:
const DEFAULT_SWITCH = {
  type: DEVICE_TYPE.SWITCH,
  setOnOffCap: 'onoff',
  setOnValue: true,
  setOffValue: false
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
  tempStep: 0.5
};

// Supported devices and how to use them
// Devices marked with beta=true are not fully supported yet
const DEVICE_CMD = {
  'no.easee:charger': {
    type: DEVICE_TYPE.CHARGER,
    beta: true
  },
  'no.hoiax:hiax-connected-200': {
    type: DEVICE_TYPE.HEATER,
    setOnOffCap: 'onoff',
    setOnValue: true,
    setOffValue: false,
    readTempCap: 'measure_temperature',
    setTempCap: 'target_temperature',
    tempMin: 20,
    tempMax: 85,
    tempStep: 0.5
  },
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
  'no.thermofloor:Z-TRM3': DEFAULT_HEATER,
  default_heater: DEFAULT_HEATER,
  default_switch: DEFAULT_SWITCH
};

module.exports = {
  DEVICE_TYPE,
  DEVICE_CMD
};
