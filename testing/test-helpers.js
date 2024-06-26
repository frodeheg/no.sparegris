/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */

'use strict';

const fs = require('fs');
const d = require('../common/devices');
const c = require('../common/constants');
const { HomeyAPI } = require('./homey-api');
const Textify = require('../lib/framebuffer');

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

async function addDevice(app, newDevice, deviceId, zone = null, enable = true) {
  // NB! A new instance of HomeyAPIApp here will not create a duplicate version
  //     of the zone and device list because it's unique and global to all instances
  newDevice.deviceId = deviceId;
  const homeyApi = await HomeyAPI.createAppAPI({ homey: app.homey });
  homeyApi.devices.addRealDevice(newDevice, zone, deviceId);
  newDevice.homey = app.homey;
}

async function applyBasicPrices(app) {
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

async function applyPriceScheme2(app) {
  app.__all_prices = [
    { time: 1688248800, price: 0.2 },
    { time: 1688252400, price: 0.3 },
    { time: 1688256000, price: 0.5 },
    { time: 1688259600, price: 0.3 },
    { time: 1688263200, price: 0.2 },
    { time: 1688266800, price: 0.5 },
    { time: 1688270400, price: 0.9 },
    { time: 1688274000, price: 0.8 },
    { time: 1688277600, price: 0.1 },
    { time: 1688281200, price: 0.2 },
    { time: 1688284800, price: 0.2 },
    { time: 1688288400, price: 0.3 },
    { time: 1688292000, price: 0.5 },
    { time: 1688295600, price: 0.3 },
    { time: 1688299200, price: 0.2 },
    { time: 1688302800, price: 0.5 },
    { time: 1688306400, price: 0.9 },
    { time: 1688310000, price: 0.8 },
    { time: 1688313600, price: 0.1 },
    { time: 1688317200, price: 0.2 },
    { time: 1688320800, price: 0.2 },
    { time: 1688324400, price: 0.3 },
    { time: 1688328000, price: 0.5 },
    { time: 1688331600, price: 0.3 }
  ];
  /*app.__current_prices = [
    0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
    0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
    0.2, 0.3, 0.5, 0.3];
  app.__current_price_index = 3;*/
  app.homey.settings.set('all_prices', app.__all_prices);
  app.__current_price_index = 0;
  await app.doPriceCalculations(new Date(app.__free_power_trigger_time.getTime()));
}

async function applyEmptyConfig(app, devices = []) {
  app.homey.settings.set('operatingMode', c.MODE_NORMAL);
  app.homey.settings.set('maxPower', [Infinity, 5000, Infinity, Infinity]);
  app.homey.settings.set('zones', {});
  app.homey.settings.set('priceMode', c.PRICE_MODE_INTERNAL);
  const futureData = app.homey.settings.get('futurePriceOptions');
  futureData.priceKind = c.PRICE_KIND_SPOT;
  futureData.averageTime = 2;
  futureData.averageTimeFuture = 12;
  futureData.averageTimePast = 24;
  futureData.dirtCheapPriceModifier = -50;
  futureData.lowPriceModifier = -10;
  futureData.highPriceModifier = 10;
  futureData.extremePriceModifier = 100;
  app.homey.settings.set('futurePriceOptions', futureData);
  const fakeDevices = devices;
  const zoneHomeId = app.homeyApi.zones.addZone('Home');
  const zoneHereId = app.homeyApi.zones.addZone('Here', null, zoneHomeId);
  await app.homeyApi.devices.clearFakeDevices();
  await app.homeyApi.devices.addFakeDevices(fakeDevices, zoneHereId);

  app.homey.settings.set('frostList', {});
  app.homey.settings.set('modeList', [
    [], // Normal
    [], // Night
    [], // Away
  ]);
  app.homey.settings.set('priceActionList', [{}, {}, {}, {}, {}]);
  app.__deviceList = {};

  await app.createDeviceList(); // To initialize app.__current_state[...]
  app.app_is_configured = app.validateSettings();
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
  futureData.averageTimeFuture = 12;
  futureData.averageTimePast = 24;
  futureData.dirtCheapPriceModifier = -50;
  futureData.lowPriceModifier = -10;
  futureData.highPriceModifier = 10;
  futureData.extremePriceModifier = 100;
  app.homey.settings.set('futurePriceOptions', futureData);
  const fakeDevices = [
    'com.mill;mill.txt',
    'com.mill;mill.txt',
    'com.sensibo;Sensibo.txt',
    'com.sensibo;Sensibo.txt',
    { id: 'id_a', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
    { id: 'id_b', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
    { id: 'id_c', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
    { id: 'id_d', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
    { id: 'id_e', capabilitiesObj: { measure_temperature: { value: 10 }, target_temperature: { value: 20 }, onoff: { value: false } } },
  ];
  const zoneHomeId = app.homeyApi.zones.addZone('Home');
  const zoneGangId = app.homeyApi.zones.addZone('Gang', null, zoneHomeId);
  await app.homeyApi.devices.clearFakeDevices();
  await app.homeyApi.devices.addFakeDevices(fakeDevices, zoneGangId);
  await app.createDeviceList(); // To initialize app.__current_state[...]
  app.app_is_configured = app.validateSettings();

  await applyBasicPrices(app);
}

/**
 * Reads the full state dump from a file
 * @param {*} app The app instance to load the state to
 * @param {*} file The file to load the state from
 * @param {*} poweredOn if true then the state is loaded as if the app is in active mode, false when offline
 */
async function applyStateFromFile(app, file, poweredOn = true) {
  // NB! A new instance of HomeyAPIApp here will not create a duplicate version
  //     of the zone and device list because it's unique and global to all instances
  const homeyApi = await HomeyAPI.createAppAPI({ homey: app.homey });
  return new Promise((resolve, reject) => {
    fs.readFile(file, (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    });
  }).then((data) => {
    const parsed = JSON.parse(data, (key, value) => {
      return value === 'Infinity' ? Infinity : value;
    });
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
    const devInput = { ...parsed.state.__meterReaders, ...parsed.settings.deviceList };
    const devices = [];
    for (const deviceId in devInput) {
      const devInfo = devInput[deviceId];
      const fileName = `${devInfo.driverId.replace(':', ';')}.txt`; // Windows does not support : in filenames, use ;
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
          const onOffCap = (deviceId in app.__deviceList) ? app.getOnOffCap(fakeDev, deviceId) : null;
          if (onOffCap) {
            const { lastCmd } = app.__current_state[deviceId];
            const isOn = (lastCmd === TARGET_OP.TURN_ON) || (lastCmd === TARGET_OP.DELTA_TEMP);
            const setValue = isOn ? app.getOnOffTrue(deviceId) : app.getOnOffFalse(fakeDev, deviceId);
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
    .then((state) => {
      fs.writeFile(outFile, JSON.stringify(state, (key, value) => {
        return value === Infinity ? 'Infinity' : value;
      }, 2), (err) => {
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
    const onOffCap = await app.getOnOffCap(device, deviceId);
    if (onOffCap === null) {
      // Using heating as onoff
    } else if (onOffCap === undefined) {
      // There is no onoff capability
    } else {
      const onValue = await app.getOnOffTrue(deviceId);
      const offValue = await app.getOnOffFalse(device, deviceId);
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

/**
 * Checks if a JSON object has the same properties as a reference (and if it has more)
 * @param {*} ref Reference object
 * @param {*} obj Object to compare
 * @return true if they are equal
 */
function compareJSON(ref, obj, base = '') {
  // Check if all keys from ref is present
  for (const key in ref) {
    if (!(key in obj)) {
      throw new Error(`Could not find key ${base}.${key} in object`);
    }
    if (typeof ref[key] !== typeof obj[key]) {
      throw new Error(`Object type of key ${base}.${key} is invalid`);
    }
    if (Array.isArray(ref[key]) || Array.isArray(obj[key])) {
      throw new Error(`Cannot have array objects in json for key ${base}.${key} (HP2023 displays this incorrectly)`);
    }
    if (typeof ref[key] === 'object' && typeof obj[key] === 'object') {
      compareJSON(ref[key], obj[key], `${base}.${key}`);
    }
  }
  // Check obj has too many keys
  for (const key in obj) {
    if (!(key in ref)) {
      throw new Error(`Could not find key ${base}.${key} in reference`);
    }
  }
  return true;
}

function checkForTranslations(obj, languages, base = '') {
  let isTranslationString = false;
  const foundLanguages = [];
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      checkForTranslations(obj[key], languages, `${base}.${key}`);
    } else if (languages.includes(key)) {
      isTranslationString = true;
      foundLanguages.push(key);
    }
  }
  if (isTranslationString) {
    const missingTransOk = (Object.keys(obj).length === 1) && (obj['en'] === '%' || obj['en'] === '');
    if (!missingTransOk) {
      // Check for missing languages:
      if (foundLanguages.length !== languages.length) {
        throw new Error(`Translation string ${base} should include [${languages}], but could only find [${foundLanguages}]`);
      }
      // Check for too many languages
      if (Object.keys(obj).length !== languages.length) {
        throw new Error(`Translation string ${base} should include [${languages}], but found too many [${Object.keys(obj)}]`);
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

/**
 * Run through the charge validation procedure and respond as if a user was to follow the proceudre
 * Throws errors when the response is not as anticipated.
 */
async function validateCharger(app, chargeDevice) {
  // Check result of the validation test - should be invalid
  let notValidated = await chargeDevice.getCapabilityValue('alarm_generic.notValidated');
  if (!notValidated) {
    throw new Error('Device should not be marked as validated on init');
  }

  // Get hold of controlled device (if present)
  const controlledDevice = chargeDevice.targetId
    ? await app.getDevice(chargeDevice.targetId) : null;

  // Send validation commands: State
  const stateFeedback = app.homey.flow.getActionCard('charger-change-state');
  if (!chargeDevice.targetDriver || chargeDevice.targetDef.statusCap === null) {
    // Pretend to be a flow
    await stateFeedback.triggerAction({ device: chargeDevice, state: 0 /* STATE_FULL_CHARGE */ });
  } else {
    // Pretend to be a driver
    await controlledDevice.setCapabilityValue({ capabilityId: chargeDevice.targetDef.statusCap, value: 'Connected' });
  }

  // Send validation commands: Battery level
  const batteryFeedback = app.homey.flow.getActionCard('charger-change-batterylevel');
  if (!chargeDevice.targetDriver || chargeDevice.targetDef.getBatteryCap === null) {
    // Pretend to be a flow
    await batteryFeedback.triggerAction({ device: chargeDevice, level: 0 });
  } else {
    // Pretend to be a driver
  }

  // Register validation command: Watt trigger response
  await chargeDevice.registerTrigger('charger-change-target-power', (chargeDevice, tokens) => {
    // This is where:
    // 1) A flow would route the trigger to a charger
    // 2) The charger would change the power as instructed
    if (controlledDevice && chargeDevice.targetDef.measurePowerCap) {
      controlledDevice.setCapabilityValue({
        capabilityId: chargeDevice.targetDef.measurePowerCap,
        value: tokens.offeredPower
      });
    } else {
      // 3) The change of charger power will be noticed and sent back to piggy
      const powerFeedback = app.homey.flow.getActionCard('charger-change-power');
      powerFeedback.triggerAction({ device: chargeDevice, power: tokens.offeredPower });
    }
  });
  // Send validation command: Watt response
  if (!chargeDevice.targetDriver || chargeDevice.targetDef.measurePowerCap === null) {
    chargeDevice.setTargetPower(1000);
  }

  // Restart validation procedure
  // Note that the procedure is working in the background and need to be called over and over
  let count = 4;
  while (count > 0 && notValidated) {
    const tempImg = new Textify({ width: 500, height: 500, colorType: 2, bgColor: { red: 80, green: 80, blue: 80 }});
    await chargeDevice.validationProcedure(tempImg);
    await sleep(1000);
    if (count === 3) {
      await chargeDevice.setCapabilityValueUser('onoff', true);
    }
    count--;
    notValidated = await chargeDevice.getCapabilityValue('alarm_generic.notValidated');
    // console.log(`Not Valid: ${notValidated}`);
  }

  // Check result of the validation test - should be valid
  if (notValidated) {
    throw new Error('Device should be marked as valid now');
  }
  const isOn = await chargeDevice.getCapabilityValue('onoff');
  if (!isOn) {
    throw new Error('Device should be turned on now');
  }
}

module.exports = {
  disableTimers,
  addDevice,
  applyBasicPrices,
  applyPriceScheme2,
  applyEmptyConfig,
  applyBasicConfig,
  applyStateFromFile,
  dumpStateToFile,
  getAllDeviceId,
  writePowerStatus,
  setAllDeviceState,
  validateModeList,
  applyUnInit,
  compareJSON,
  checkForTranslations,
  sleep,
  validateCharger,
};
