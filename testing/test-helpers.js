/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */

'use strict';

const fs = require('fs');
const d = require('../common/devices');
const c = require('../common/constants');

const { MAIN_OP, TARGET_OP } = c;

// Disables timers in order to allow high speed-out-of-time testing.
async function disableTimers(app) {
  if (app.__intervalID !== undefined) {
    clearInterval(app.__intervalID);
    app.__intervalID = undefined;
  }
  if (app.__newHourID !== undefined) {
    clearTimeout(app.__newHourID);
    app.__newHourID = undefined;
  }
  if (app.__statsIntervalID !== undefined) {
    clearInterval(app.__statsIntervalID);
    app.__statsIntervalID = undefined;
  }
}

async function applyBasicConfig(app) {
  app.homey.settings.set('operatingMode', c.MODE_NORMAL);
  app.homey.settings.set('maxPower', 5000);
  app.homey.settings.set('zones', {});
  app.homey.settings.set('frostList', { id_a: { minTemp: 3 },
    'b4788083-9606-49a2-99d4-9efce7a4656d-3': { minTemp: 5 },
    'b4788083-9606-49a2-99d4-9efce7a4656d-2': { minTemp: 5 }});
  app.homey.settings.set('modeList', [
    // Normal
    [{ id: 'id_a', operation: c.CONTROLLED, targetTemp: 24 },
      { id: 'b4788083-9606-49a2-99d4-9efce7a4656d-3', operation: c.CONTROLLED, targetTemp: 24 },
      { id: 'b4788083-9606-49a2-99d4-9efce7a4656d-2', operation: c.CONTROLLED, targetTemp: 24 }],
    [{ id: 'id_a', operation: c.CONTROLLED, targetTemp: 24 },
      { id: 'b4788083-9606-49a2-99d4-9efce7a4656d-3', operation: c.CONTROLLED, targetTemp: 24 },
      { id: 'b4788083-9606-49a2-99d4-9efce7a4656d-2', operation: c.CONTROLLED, targetTemp: 24 }], // Night
    [{ id: 'id_a', operation: c.CONTROLLED, targetTemp: 24 },
      { id: 'b4788083-9606-49a2-99d4-9efce7a4656d-3', operation: c.CONTROLLED, targetTemp: 24 },
      { id: 'b4788083-9606-49a2-99d4-9efce7a4656d-2', operation: c.CONTROLLED, targetTemp: 24 }], // Away
  ]);
  app.homey.settings.set('priceActionList', [
    {id_a: {operation: c.EMERGENCY_OFF},
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': {operation: c.DELTA_TEMP},
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': {operation: c.DELTA_TEMP}},
    {id_a: {operation: c.EMERGENCY_OFF},
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': {operation: c.DELTA_TEMP},
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': {operation: c.DELTA_TEMP}},
    {id_a: {operation: c.EMERGENCY_OFF},
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': {operation: c.DELTA_TEMP},
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': {operation: c.DELTA_TEMP}},
    {id_a: {operation: c.EMERGENCY_OFF},
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': {operation: c.DELTA_TEMP},
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': {operation: c.DELTA_TEMP}},
    {id_a: {operation: c.EMERGENCY_OFF},
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': {operation: c.DELTA_TEMP},
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': {operation: c.DELTA_TEMP}}
  ]);
  app.__deviceList = {
    id_a: { name:"DeviceNamenamenamenamename 1", room: "Stue",    image: "x.jpg", use: true, priority: 0, thermostat_cap: true, reliability: 1.0, driverId: 'no.thermofloor:TF_Thermostat' },
    id_b: { name:"DeviceName 2", room: "Kjøkken", image: "x.jpg", use: true, priority: 1, thermostat_cap: true, reliability: 0.5, driverId: 'no.thermofloor:Z-TRM2fx' },
    id_c: { name:"DeviceName 3", room: "Bad",     image: "x.jpg", use: true, priority: 0, thermostat_cap: false, reliability: 0.6, driverId: 'no.thermofloor:Z-TRM3' },
    id_d: { name:"DeviceName 4", room: "Bad",     image: "x.jpg", use: false, priority: 1, thermostat_cap: true, reliability: 0.7, driverId: 'se.husdata:H60' },
    id_e: { name:"DeviceName 3", room: "Bad",     image: "x.jpg", use: true, priority: 0, thermostat_cap: false, reliability: 0.6, driverId: 'com.everspring:AN179' },
  };
  app.homey.settings.set('priceMode', c.PRICE_MODE_INTERNAL);
  const futureData = app.homey.settings.get('futurePriceOptions');
  futureData.priceKind = c.PRICE_KIND_SPOT;
  futureData.averageTime = 2;
  app.homey.settings.set('futurePriceOptions', futureData);
  const fakeDevices = [
    'com.mill:mill.txt',
    'com.mill:mill.txt',
    'com.sensibo:Sensibo.txt',
    'com.sensibo:Sensibo.txt',
    { id: 'id_a', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
    { id: 'id_b', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
    { id: 'id_c', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
    { id: 'id_d', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
    { id: 'id_e', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
  ];
  const zoneHomeId = app.homeyApi.zones.addZone('Home');
  const zoneGangId = app.homeyApi.zones.addZone('Gang', null, zoneHomeId);
  await app.homeyApi.devices.addFakeDevices(fakeDevices, zoneGangId);
  await app.createDeviceList(); // To initialize app.__current_state[...]
  app.app_is_configured = app.validateSettings();
  await app.doPriceCalculations();
}

async function applyStateFromFile(app, file) {
  return new Promise((resolve, reject) => {
    fs.readFile(`testing/${file}`, (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    });
  }).then(data => {
    const parsed = JSON.parse(data);
    app.homey.settings.values = parsed.settings;
    for (const v in parsed.state) {
      switch (v) {
        case '__intervalID':
        case '__newHourID':
        case '__statsIntervalID':
          break;
        case '__current_power_time':
        case '__accum_since':
          app[v] = new Date(parsed.state[v]);
          break;
        default:
          app[v] = parsed.state[v];
          break;
      }
    }
    // Create fake devices to match the loaded state
    const devices = [];
    for (const deviceId in parsed.settings.deviceList) {
      const devInfo = parsed.settings.deviceList[deviceId];
      const fileName = `${devInfo.driverId}.txt`;
      const zones = app.homeyApi.zones.getZones();
      for (let idx = devInfo.memberOf.length - 1; idx >= 0; idx--) {
        const zoneId = devInfo.memberOf[idx];
        const zoneName = (idx === 0) ? devInfo.room : `${devInfo.room}_parent_${idx}`;
        const parentId = devInfo.memberOf[idx + 1] || null;
        if (!(zoneId in zones)) app.homeyApi.zones.addZone(zoneName, zoneId, parentId);
        else if (idx === 0) app.homeyApi.zones.zones[zoneId].name = devInfo.room;
      }
      devices.push(new Promise((resolve, reject) => {
        let fakeDev;
        try {
          fakeDev = app.homeyApi.devices.addFakeDevice(fileName, devInfo.roomId, deviceId);
        } catch (err) {
          app.log(`Missing file: ${fileName} - overriding with defaults`);
          const dummyCap = {};
          if (devInfo.thermostat_cap) {
            dummyCap.measure_temperature = { value: 10 };
            dummyCap.target_temperature = { value: 20 };
          }
          if (devInfo.onoff_cap || !devInfo.use) {
            dummyCap[devInfo.onoff_cap || 'onoff'] = { value: false };
          }
          const dummyDevice = { id: deviceId, capabilitiesObj: dummyCap };
          try {
            fakeDev = app.homeyApi.devices.addFakeDevice(dummyDevice, devInfo.roomId);
            fakeDev.driverUri = `homey:app:${devInfo.driverId.slice(0, devInfo.driverId.indexOf(':'))}`;
            fakeDev.driverId = devInfo.driverId.slice(devInfo.driverId.indexOf(':') + 1);
          } catch (err2) {
            reject(err2);
          }
        }
        const onOffCap = app.getOnOffCap(deviceId);
        if (onOffCap) {
          const { lastCmd } = app.__current_state[deviceId];
          const isOn = (lastCmd === TARGET_OP.TURN_ON) || (lastCmd === TARGET_OP.DELTA_TEMP);
          const setValue = isOn ? app.getOnOffTrue(deviceId) : app.getOnOffFalse(deviceId);
          fakeDev.capabilitiesObj[onOffCap].value = setValue;
        }
        fakeDev.name = devInfo.name;
        resolve(fakeDev);
      }));
    }
    return Promise.all(devices);
  });
}

async function getAllDeviceId(app) {
  const deviceIdList = [];
  for (const idx in app.__deviceList) {
    deviceIdList.push(idx);
  }
  return deviceIdList;
}

async function writePowerStatus(app, devices) {
  let line = '';
  for (let i = 0; i < devices.length; i++) {
    const deviceId = devices[i];
    const device = await app.getDevice(deviceId);
    const isOn = await app.getIsOn(device, deviceId);
    line += `${isOn ? 'X' : '-'}`;
  }
  console.log(line);
}

module.exports = {
  disableTimers,
  applyBasicConfig,
  applyStateFromFile,
  getAllDeviceId,
  writePowerStatus,
};
