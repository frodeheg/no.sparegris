/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */

'use strict';

const fs = require('fs');
const d = require('../common/devices');
const c = require('../common/constants');
const { HomeyAPIApp } = require('./homey-api');

const { MAIN_OP, TARGET_OP } = c;

// Disables timers in order to allow high speed-out-of-time testing.
async function disableTimers(app) {
  if (app.__intervalID !== undefined) {
    clearInterval(app.__intervalID);
    app.__intervalID = undefined;
  }
  if (app.__powerProcessID !== undefined) {
    clearTimeout(app.__powerProcessID);
    app.__powerProcessID = undefined;
  }
  if (app.__pulseCheckerID !== undefined) {
    clearTimeout(app.__pulseCheckerID);
    app.__pulseCheckerID = undefined;
  }
  if (app.__statsIntervalID !== undefined) {
    clearInterval(app.__statsIntervalID);
    app.__statsIntervalID = undefined;
  }
}

async function applyBasicConfig(app) {
  app.homey.settings.set('operatingMode', c.MODE_NORMAL);
  app.homey.settings.set('maxPower', [Infinity, 5000, Infinity, Infinity]);
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
    {id_a: { operation: c.EMERGENCY_OFF },
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': { operation: c.DELTA_TEMP },
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': { operation: c.DELTA_TEMP }},
    {id_a: { operation: c.EMERGENCY_OFF },
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': { operation: c.DELTA_TEMP },
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': { operation: c.DELTA_TEMP }},
    {id_a: { operation: c.EMERGENCY_OFF },
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': { operation: c.DELTA_TEMP },
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': { operation: c.DELTA_TEMP }},
    {id_a: { operation: c.EMERGENCY_OFF },
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': { operation: c.DELTA_TEMP },
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': { operation: c.DELTA_TEMP }},
    {id_a: { operation: c.EMERGENCY_OFF },
      'b4788083-9606-49a2-99d4-9efce7a4656d-3': { operation: c.DELTA_TEMP },
      'b4788083-9606-49a2-99d4-9efce7a4656d-2': { operation: c.DELTA_TEMP }}
  ]);
  app.__deviceList = {
    id_a: { name: 'DeviceNamenamenamenamename 1', room: 'Stue', image: 'x.jpg', use: true, priority: 0, thermostat_cap: true, reliability: 1.0, driverId: 'no.thermofloor:TF_Thermostat' },
    id_b: { name: 'DeviceName 2', room: 'Kjøkken', image: 'x.jpg', use: true, priority: 1, thermostat_cap: true, reliability: 0.5, driverId: 'no.thermofloor:Z-TRM2fx' },
    id_c: { name: 'DeviceName 3', room: 'Bad', image: 'x.jpg', use: true, priority: 0, thermostat_cap: false, reliability: 0.6, driverId: 'no.thermofloor:Z-TRM3' },
    id_d: { name: 'DeviceName 4', room: 'Bad', image: 'x.jpg', use: false, priority: 1, thermostat_cap: true, reliability: 0.7, driverId: 'se.husdata:H60' },
    id_e: { name: 'DeviceName 3', room: 'Bad', image: 'x.jpg', use: true, priority: 0, thermostat_cap: false, reliability: 0.6, driverId: 'com.everspring:AN179' },
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

  app.__all_prices = [
    { time: 1672095600, price: 1.6749716800000003 },
    { time: 1672099200, price: 1.7764168000000002 },
    { time: 1672102800, price: 1.7714555200000002 },
    { time: 1672106400, price: 1.759444 },
    { time: 1672110000, price: 1.8159764800000002 },
    { time: 1672113600, price: 1.9013627200000003 },
    { time: 1672117200, price: 2.10305024 },
    { time: 1672120800, price: 2.20945664 },
    { time: 1672124400, price: 2.21376512 },
    { time: 1672128000, price: 2.22642944 },
    { time: 1672131600, price: 2.2409216 },
    { time: 1672135200, price: 2.24562176 },
    { time: 1672138800, price: 2.2705587200000004 },
    { time: 1672142400, price: 2.23400192 },
    { time: 1672146000, price: 2.25632768 },
    { time: 1672149600, price: 2.31351296 },
    { time: 1672153200, price: 2.37056768 },
    { time: 1672156800, price: 2.50804736 },
    { time: 1672160400, price: 2.5846860800000004 },
    { time: 1672164000, price: 2.4968192 },
    { time: 1672167600, price: 2.34458624 },
    { time: 1672171200, price: 2.14378496 },
    { time: 1672174800, price: 1.78516432 },
    { time: 1672178400, price: 1.60916944 },
  ];
  app.homey.settings.set('all_prices', app.__all_prices);
  app.__current_price_index = 0;
  await app.doPriceCalculations(new Date(1672095600));
}

/**
 * Reads the full state dump from a file
 * @param {*} app The app instance to load the state to
 * @param {*} file The file to load the state from
 * @param {*} poweredOn if true then the state is loaded as if the app is in active mode, false when offline
 */
async function applyStateFromFile(app, file, poweredOn = true) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    });
  }).then(data => {
    const parsed = JSON.parse(data);
    // Settings are always loaded
    app.homey.settings.values = parsed.settings;
    if (poweredOn) {
      // These variables are only set by onInit so should only be loaded
      // when trying to reproduce a state in the app
      for (const v in parsed.state) {
        switch (v) {
          case '__intervalID':
          case '__newHourID':
          case '__statsIntervalID':
            break;
          case '__current_power_time':
            app[v] = new Date(parsed.state[v]);
            break;
          default:
            app[v] = parsed.state[v];
            break;
        }
      }
    }
    // Create fake devices to match the loaded state
    const devInput = {...parsed.state.__meterReaders, ...parsed.settings.deviceList};
    const devices = [];
    for (const deviceId in devInput) {
      const devInfo = devInput[deviceId];
      const fileName = `${devInfo.driverId}.txt`;
      // NB! A new instance of HomeyAPIApp here will not create a duplicate version
      //     of the zone and device list because it's unique and global to all instances
      const homeyApi = new HomeyAPIApp({ homey: app.homey });
      const zones = homeyApi.zones.getZones();
      if (!('memberOf' in devInfo)) devInfo.memberOf = ['none'];
      if (!('roomId' in devInfo)) devInfo.roomId = 'none';
      for (let idx = devInfo.memberOf.length - 1; idx >= 0; idx--) {
        const zoneId = devInfo.memberOf[idx];
        const zoneName = (idx === 0) ? devInfo.room : `${devInfo.room}_parent_${idx}`;
        const parentId = devInfo.memberOf[idx + 1] || null;
        if (!(zoneId in zones)) homeyApi.zones.addZone(zoneName, zoneId, parentId);
        else if (idx === 0) homeyApi.zones.zones[zoneId].name = devInfo.room;
      }
      devices.push(new Promise((resolve, reject) => {
        let fakeDev;
        try {
          fakeDev = homeyApi.devices.addFakeDevice(fileName, devInfo.roomId, deviceId);
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
            fakeDev = homeyApi.devices.addFakeDevice(dummyDevice, devInfo.roomId);
            fakeDev.driverUri = `homey:app:${devInfo.driverId.slice(0, devInfo.driverId.indexOf(':'))}`;
            fakeDev.driverId = devInfo.driverId.slice(devInfo.driverId.indexOf(':') + 1);
          } catch (err2) {
            reject(err2);
          }
        }
        if (poweredOn) {
          // app.__current_state is only available when the app is running
          const onOffCap = (deviceId in app.__deviceList) ? app.getOnOffCap(deviceId) : null;
          if (onOffCap) {
            const { lastCmd } = app.__current_state[deviceId];
            const isOn = (lastCmd === TARGET_OP.TURN_ON) || (lastCmd === TARGET_OP.DELTA_TEMP);
            const setValue = isOn ? app.getOnOffTrue(deviceId) : app.getOnOffFalse(deviceId);
            fakeDev.capabilitiesObj[onOffCap].value = setValue;
          }
        }
        fakeDev.name = devInfo.name;
        fakeDev.iconObj = { url: devInfo.image };
        fakeDev.reliability = devInfo.reliability;
        if ('target_temperature' in fakeDev.capabilitiesObj) {
          fakeDev.capabilitiesObj['target_temperature'].value = devInfo.targetTemp;
        }
        resolve(fakeDev);
      }));
    }
    return Promise.all(devices);
  });
}

/**
 * Dumps the full state to a file
 * @param {*} app The app instance to load the state to
 * @param {*} file The file to load the state from
 */
async function dumpStateToFile(app, outFile) {
  return app.getFullState()
    .then(state => {
      fs.writeFile(outFile, JSON.stringify(state, null, 2), err => {
        if (err) {
          return Promise.reject(err);
        }
        return Promise.resolve(true);
      });
    });
}

async function getAllDeviceId(app) {
  const deviceIdList = [];
  for (const idx in app.homey.settings.get('deviceList')) {
    deviceIdList.push(idx);
  }
  return deviceIdList;
}

async function writePowerStatus(app, devices, additional = '', verbose = false) {
  let line = '';
  for (let i = 0; i < devices.length; i++) {
    const deviceId = devices[i];
    const device = await app.getDevice(deviceId);
    const isOn = await app.getIsOn(device, deviceId);
    if (verbose && isOn) {
      console.log(`Device ${device.id} ${device.name} is on`);
    }
    line += `${isOn ? 'X' : '-'}`;
  }
  console.log(`${line} ${additional}`);
}

async function setAllDeviceState(app, devices, wantOn) {
  for (let i = 0; i < devices.length; i++) {
    const deviceId = devices[i];
    const device = await app.getDevice(deviceId);
    const onOffCap = await app.getOnOffCap(deviceId);
    if (onOffCap === null) {
      // Using heating as onoff
    } else if (onOffCap === undefined) {
      // There is no onoff capability
    } else {
      const onValue = await app.getOnOffTrue(deviceId);
      const offValue = await app.getOnOffFalse(deviceId);
      const newState = { capabilityId: onOffCap, value: wantOn ? onValue : offValue };
      await device.overrideDeviceState(newState);
    }
  }
}

/**
 * Check that the modeList is completely valid
 */
async function validateModeList(app) {
  const deviceList = app.__deviceList;
  const modeList = app.homey.settings.get('modeList');
  // Make sure that all modes has the same devices listed
  for (const list in modeList) {
    if (modeList[0].length !== modeList[list].length) {
      throw new Error('Modelist length is not consistent');
    }
    for (const idx in modeList[list]) {
      const idCurrent = modeList[list][idx].id;
      let found = false;
      for (const idxOrig in modeList[0]) {
        if (modeList[0][idxOrig].id === idCurrent) {
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error(`Device ${idCurrent} is not consistent in modeList`);
      }
    }
  }
  // Check that all devices marked with Use are within the modelist
  for (const deviceId in deviceList) {
    if (deviceList[deviceId].use) {
      let found = false;
      for (const idxOrig in modeList[0]) {
        if (modeList[0][idxOrig].id === deviceId) {
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error(`Device ${deviceId} was marked with use but not in modeList`);
      }
    }
  }
  // Check that all devices in the modelist is marked as Used
  for (const deviceidx in modeList[0]) {
    const deviceId = modeList[0][deviceidx].id;
    if (!deviceList[deviceId].use) {
      throw new Error(`Device ${deviceId} was in modeList but not marked with use`);
    }
  }
}

/**
 * Applies the onUnit function on the state as if it were on the dump that was created:
 */
async function applyUnInit(app) {
  const dumpVersion = app.homey.settings.get('settingsVersion');
  switch (dumpVersion) {
    case 7:
      app.homey.settings.set('safeShutdown__accum_energy', app.__accum_energy);
      app.homey.settings.set('safeShutdown__current_power', app.__current_power);
      app.homey.settings.set('safeShutdown__current_power_time', app.__current_power_time);
      app.homey.settings.set('safeShutdown__power_last_hour', app.__power_last_hour);
      app.homey.settings.set('safeShutdown__offeredEnergy', app.__offeredEnergy);
      app.homey.settings.set('safeShutdown_missing_power_this_hour', app.__missing_power_this_hour);
      app.homey.settings.set('safeShutdown__fakePower', app.__fakePower);
      app.homey.settings.set('safeShutdown__pendingOnNewHour', app.__pendingOnNewHour);
      break;
    default:
      console.log(`Cannot Apply onUninit, dump version ${dumpVersion} not supported`);
      break;
  }
}

module.exports = {
  disableTimers,
  applyBasicConfig,
  applyStateFromFile,
  dumpStateToFile,
  getAllDeviceId,
  writePowerStatus,
  setAllDeviceState,
  validateModeList,
  applyUnInit,
};
