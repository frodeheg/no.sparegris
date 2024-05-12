/* eslint-disable comma-dangle */
/* eslint-disable no-multi-spaces */
/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

const fs = require('fs');

global.testing = true;

// eslint-disable-next-line import/no-extraneous-dependencies
// const seedrandom = require('seedrandom');
// const fs = require('fs');
const c = require('../common/constants');
// const prices = require('../common/prices');
// const { addToArchive, cleanArchive, getArchive, changeArchiveMode, clearArchive } = require('../common/archive');
// const Homey = require('./homey');
const PiggyBank = require('../app');
const ChargeDevice = require('../drivers/piggy-charger/device');
const ChargeDriver = require('../drivers/piggy-charger/driver');
// const { TIMESPAN, roundToStartOfDay, timeToNextHour, toLocalTime, fromLocalTime, timeToNextSlot, timeSinceLastSlot, timeSinceLastLimiter, hoursInDay } = require('../common/homeytime');
// const { disableTimers, applyStateFromFile, getAllDeviceId, writePowerStatus, setAllDeviceState, validateModeList, compareJSON, checkForTranslations } = require('./test-helpers');
const { HomeyAPI } = require('./homey-api');
const { applyBasicConfig, applyEmptyConfig, addDevice, applyPriceScheme2, sleep, validateCharger } = require('./test-helpers');
const { useUrlOverride, setUrlData } = require('./urllib');

// Test Device initialization
async function testDeviceInit() {
  console.log('[......] Charge controller Initialization');
  const now = new Date('July 2, 2023, 03:00:00:000 GMT+2:00');
  const app = new PiggyBank();
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);
  try {
    await app.disableLog();
    await app.onInit(now);
    await chargeDevice.onInit(now);
  } finally {
    chargeDevice.onUninit();
    app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test Charge plan
async function testChargePlan() {
  console.log('[......] Charge plan');
  const now = new Date('July 2, 2023, 03:00:00:000 GMT+2:00');
  const app = new PiggyBank();
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);
  try {
    await app.disableLog();
    await app.onInit(now);
    await applyBasicConfig(app);
    await chargeDevice.onInit(now);

    app.__current_prices = [
      0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
      0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
      0.2, 0.3, 0.5, 0.3];
    app.__current_price_index = 3;
    const resultTable = [undefined, 3750, undefined, undefined, undefined, 3750, 3750];

    // app.onChargingCycleStart(10, '08:00');
    const callTime = new Date();
    callTime.setHours(3, 0, 0, 0);
    await chargeDevice.onChargingCycleStart(undefined, '10:00', 3, callTime);
    for (let i = 0; i < resultTable.length; i++) {
      if (!Array.isArray(chargeDevice.chargePlan.currentPlan)) {
        throw new Error('Unable to create a charge plan...');
      }
      if (chargeDevice.chargePlan.currentPlan[i] !== resultTable[i]) {
        throw new Error(`Charging schedule failed, Hour +${i} observed ${chargeDevice.chargePlan.currentPlan[i]}, wanted: ${resultTable[i]}`);
      }
    }
  } finally {
    chargeDevice.onUninit();
    app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testChargeValidation() {
  console.log('[......] Charge Validation');
  const now = new Date('July 2, 2023, 03:00:00:000 GMT+2:00');
  const app = new PiggyBank();
  const homeyApi = await HomeyAPI.createAppAPI({ homey: app.homey });
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const flowDeviceController = new ChargeDevice(chargeDriver);
  const teslaDeviceController = new ChargeDevice(chargeDriver);
  const zaptecDeviceController = new ChargeDevice(chargeDriver);
  const easeeDeviceController = new ChargeDevice(chargeDriver);

  try {
    await app.disableLog();
    await app.onInit(now);
    await applyBasicConfig(app);

    const zoneHomeId = app.homeyApi.zones.addZone('Home');
    const chargeZoneId = app.homeyApi.zones.addZone('ChargeZone');

    await addDevice(app, flowDeviceController, 'flowCharger', zoneHomeId);
    await addDevice(app, teslaDeviceController, 'teslaCharger', zoneHomeId);
    await addDevice(app, zaptecDeviceController, 'zaptecCharger', zoneHomeId);
    await addDevice(app, easeeDeviceController, 'easeeCharger', zoneHomeId);

    const teslaDevice = await homeyApi.devices.addFakeDevice('com.tesla.charger;Tesla.txt', chargeZoneId, 'TESLA-DEVICEID', {
      capname: () => { console.log('tesla capname changed value'); return Promise.resolve(); },
      capname2: () => { console.log('tesla cap2name changed'); return Promise.resolve(); }
    });
    const zaptecDevice = null;
    const easeeDevice = null;

    const testDevices = [
      { chargeDevice: flowDeviceController, fakeDevice: null, id: 'FLOW', name: 'Flow' },
      { chargeDevice: teslaDeviceController, fakeDevice: teslaDevice, id: 'TESLA-DEVICEID', name: 'Tesla' },
      { chargeDevice: zaptecDeviceController, fakeDevice: zaptecDevice, id: 'ZAPTEC-DEVICEID', name: 'Zaptec' },
      { chargeDevice: easeeDeviceController, fakeDevice: easeeDevice, id: 'EASEE-DEVICEID', name: 'Easee' }
    ];
    for (let deviceTest = 0; deviceTest < testDevices.length; deviceTest++) {
      const { chargeDevice, name, fakeDevice, id } = testDevices[deviceTest];
      const targetDriver = fakeDevice ? fakeDevice.driverId.substring(10) : null;
      console.log(`${(deviceTest === 0) ? '\x1b[1A' : ''}[......] Charge Validation - ${name}`);
      // Validation test is run on init (and on image refresh):
      await chargeDevice.setData({ targetDriver, id });
      await chargeDevice.setSettings({ startCurrent: 11, stopCurrent: 0, pauseCurrent: 4, minCurrent: 7, maxCurrent: 12 });
      await chargeDevice.setSettings({ phases: 1, voltage: 220 });
      await chargeDevice.onInit(now);
      await validateCharger(app, chargeDevice);
      chargeDevice.onUninit();
      console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
    }
  } finally {
    app.onUninit();
  }
}

/**
 * Give the charger power and make sure that it responds
 * This works even without validation
 */
async function testChargeControl() {
  console.log('[......] Charge control');
  const now = new Date('July 2, 2023, 03:00:00:000 GMT+2:00');
  const app = new PiggyBank();
  const homeyApi = await HomeyAPI.createAppAPI({ homey: app.homey });
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);

  const chargeZoneId = '1';
  homeyApi.zones.addZone('ChargeZone', chargeZoneId, null);

  const teslaDevice = await homeyApi.devices.addFakeDevice('com.tesla.charger;Tesla.txt', chargeZoneId, 'TESLA-DEVICEID',
    { capname: () => { console.log('tesla capname changed value'); return Promise.resolve(); },
      capname2: () => { console.log('tesla cap2name changed'); return Promise.resolve(); }
    });

  now.setHours(3, 0, 0, 0);
  try {
    await app.disableLog();
    await app.onInit(now);

    await chargeDevice.setData({ targetDriver: null, id: 'FLOW' });
    // await chargeDevice.setData({ targetDriver: 'com.tesla.charger:Tesla', id: 'TESLA-DEVICEID' });
    // await chargeDevice.setData({ targetDriver: 'com.zaptec:go', id: 'ZAPTEC-DEVICEID' });
    // await chargeDevice.setData({ targetDriver: 'no.easee:charger', id: 'EASEE-DEVICEID' });
    // await chargeDevice.setSettings({ startCurrent: 11, stopCurrent: 0, pauseCurrent: 4, minCurrent: 7, maxCurrent: 12 });
    await chargeDevice.setSettings({ phases: 1, voltage: 220 });
    await chargeDevice.onInit(now);
    clearTimeout(chargeDevice.__powerProcessID);
    chargeDevice.__powerProcessID = undefined;

    await applyEmptyConfig(app);
    app.homey.settings.set('maxPower', [Infinity, 10000, Infinity, Infinity]);
    const zoneHomeId = app.homeyApi.zones.addZone('Home');
    await addDevice(app, chargeDevice, 'device_a', zoneHomeId);
    app.homey.settings.set('frostList', { device_a: { minTemp: 3 } });
    app.homey.settings.set('modeList', [
      [{ id: 'device_a', operation: c.MAIN_OP.CONTROLLED, targetTemp: 24 }], // Normal
      [{ id: 'device_a', operation: c.MAIN_OP.CONTROLLED, targetTemp: 24 }], // Night
      [{ id: 'device_a', operation: c.MAIN_OP.CONTROLLED, targetTemp: 24 }], // Away
    ]);
    app.homey.settings.set('priceActionList', [
      { device_a: { operation: c.TARGET_OP.TURN_ON } },
      { device_a: { operation: c.TARGET_OP.TURN_ON } },
      { device_a: { operation: c.TARGET_OP.TURN_ON } },
      { device_a: { operation: c.TARGET_OP.TURN_ON } },
      { device_a: { operation: c.TARGET_OP.TURN_ON } }]);

    await app.createDeviceList();

    app.app_is_configured = app.validateSettings();

    await applyPriceScheme2(app);
    const correctPlan = [undefined, 7500, undefined, undefined, undefined, 7500, 7500];

    // 1) Set charger power when the plan is off, check that power is not given
    let chargerPower = 1000;
    await chargeDevice.registerTrigger('charger-change-target-power', (chargeDevice, tokens) => {
      // This is where:
      // 1) A flow would route the trigger to a charger
      // 2) The charger would change the power as instructed
      // 3) The change of charger power will be noticed and sent back to piggy
      const powerFeedback = app.homey.flow.getActionCard('charger-change-power');
      powerFeedback.triggerAction({ device: chargeDevice, power: tokens.offeredPower });
    });
    chargeDevice.setTargetPower(chargerPower);

    // 2) Start the plan, check that power is given at the right time
    const callTime = new Date(now);
    await chargeDevice.onChargingCycleStart(undefined, '10:00', 3, callTime);
    for (let i = 0; i < correctPlan.length; i++) {
      if (chargeDevice.chargePlan.currentPlan[i] !== correctPlan[i]) {
        throw new Error(`Charging schedule failed, Hour +${i} observed ${chargeDevice.__charge_plan[i]}, wanted: ${correctPlan[i]}`);
      }
    }

    // 3) Pass on time and check that the charger is signalled correctly
    const numTicks = 1000; // Number of ticks for the next 7 hours
    const intervalLength = correctPlan.length * 60 * 60 * 1000;
    const tickLength = intervalLength / numTicks; // usec per tick
    const lastTime = new Date();
    const meterTime = new Date(callTime.getTime());
    const baseMeterPower = 4000;
    let meterValue = ((baseMeterPower + chargerPower) / 1000) * ((meterTime - callTime) / 3600000);

    await app.onMeterUpdate(meterValue, meterTime);
    await app.onProcessPower(meterTime);
    for (let tick = 1; tick <= numTicks; tick++) {
      lastTime.setTime(meterTime.getTime());
      meterTime.setTime(callTime.getTime() + tickLength * tick);
      // console.log(`Tick ${tick}: ${meterTime}`);
      chargerPower = chargeDevice.getCapabilityValue('measure_power');
      // console.log(`chargepower: ${meterTime} : ${chargerPower} : ${baseMeterPower}`);
      meterValue += ((baseMeterPower + chargerPower) / 1000) * ((meterTime - lastTime) / 3600000);
      await app.onMeterUpdate(meterValue, meterTime);
      await app.onProcessPower(new Date(meterTime.getTime()));
      await chargeDevice.onProcessPower(new Date(meterTime.getTime()));
    }

    // Check the archive how much charging happened
    // Check keys: ["powUsage","charged"]
    const archive = app.homey.settings.get('archive');
    const hourKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const correctTotal = [undefined, undefined, undefined, 3983, 9955, 3994, 3988, 3992, 9991, 9935];
    const correctCharged = [undefined, undefined, undefined, 0, 5982, 0, 0, 0, 6018, 6001];
    for (let i = 0; i < correctPlan.length; i++) {
      if (archive.powUsage.hourly[hourKey][i] !== correctTotal[i]) {
        throw new Error(`Measured total power failed, Hour +${i} observed ${archive.powUsage.hourly[hourKey][i]}, wanted: ${correctTotal[i]}`);
      }
      if (archive.charged.hourly[hourKey][i] !== correctCharged[i]) {
        throw new Error(`Measured charged energy failed, Hour +${i} observed ${archive.charged.hourly[hourKey][i]}, wanted: ${correctCharged[i]}`);
      }
    }
  } finally {
    chargeDevice.onUninit();
    app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test the charge tokens
async function testChargeToken() {
  console.log('[......] Charge Token');
  const now = new Date('July 2, 2023, 03:00:00:000 GMT+2:00');
  const app = new PiggyBank();
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);

  now.setHours(3, 0, 0, 0);
  const correctToken = '{"cycleStart":"2023-07-02T01:00:00.000Z","cycleEnd":"2023-07-02T08:00:00.000Z","cycleType":2,"cycleRemaining":3,"cycleTotal":3,"currentPlan":[null,3750,null,null,null,3750,3750],"originalPlan":[null,3750,null,null,null,3750,3750],"actualCharge":[null,null,null,null,null,null,null],"actualPrices":[0.3,0.2,0.5,0.9,0.8,0.1,0.2],"currentIndex":0}';
  let chargeToken;
  try {
    await app.disableLog();
    await app.onInit(now);
    await chargeDevice.setData({ targetDriver: null, id: 'TestDeviceID' });
    await chargeDevice.setSettings({ phases: 1, voltage: 220 });
    await chargeDevice.onInit(now);
    clearTimeout(chargeDevice.__powerProcessID);
    chargeDevice.__powerProcessID = undefined;
    await applyBasicConfig(app);
    await applyPriceScheme2(app);

    const callTime = new Date(now);
    await chargeDevice.onChargingCycleStart(undefined, '10:00', 3, callTime);
  } finally {
    chargeToken = chargeDevice.homey.flow.getToken('chargeToken-TestDeviceID').value;
    chargeDevice.onUninit();
    app.onUninit();
  }

  if (chargeToken !== correctToken) {
    throw new Error(`Incorrect charge Token '${chargeToken}'`);
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test Characters and do not pass if it has not been validated with test-textify.js that it look allright
async function testCharset() {
  console.log('[......] Character set');
  // Helper function
  const reducer = (combined, currentValue) => {
    if (typeof (currentValue) === 'string') {
      for (const charIdx in currentValue) {
        combined[currentValue[charIdx]] = `${currentValue[charIdx]} (${charIdx}): ${currentValue}`;
      }
    } else if (typeof (currentValue) === 'object') {
      combined = Object.values(currentValue).reduce(reducer, combined);
    } else {
      console.log('Language string is not a string');
    }
    return combined;
  };
  // Find languages
  const files = fs.readdirSync('../locales/');
  const validLetters = {
    'en.json': '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,-+/*()<>!"\'',
    'no.json': '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,-+/*()<>!"\'øæåØÆÅ',
    'nl.json': '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,-+/*()<>!"\'',
    'fr.json': '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,-+/*()<>!"\'éàèùçâêîôûëïüÉÀÈÙÇÂÊÎÔÛËÏÜ',
  };
  // These characters has been tested and doesn't work:
  // ’ : replace with ' instead
  for (const idx in files) {
    const fileName = `../locales/${files[idx]}`;
    const json = JSON.parse(fs.readFileSync(fileName, { encoding: 'utf8', flag: 'r' }));
    const letters = Object.values(json.charger).reduce(reducer, {});
    for (const letter in letters) {
      const ref = letters[letter];
      if (letter.charCodeAt(0) >= 256) {
        throw new Error(`Unicode character '${letter}' from ${fileName} is not supported yet (ref: ${ref})`);
      }
      if (!(validLetters[files[idx]].includes(letter))) {
        throw new Error(`Letter '${letter}' from ${fileName} is not valid`);
      }
    }
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Test help images that the device is properly connected
 * 1) Test that the camera image is set
 */
async function testConnectHelp() {
  console.log('[......] Image generation (test not complete)');
  const now = new Date('July 2, 2023, 03:00:00:000 GMT+2:00');
  const app = new PiggyBank();
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);
  try {
    await app.disableLog();
    await app.onInit(now);
    await applyBasicConfig(app);
    await chargeDevice.onInit(now);

    if (chargeDevice.camera.front.image.data !== null) throw new Error('Image should not exist at this time');
    // TODO: Simulate a refresh image click

    // The code below crashes, don't know why
    // await chargeDevice.camera.front.image.update();
  } finally {
    chargeDevice.onUninit();
    app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Start all tests
async function startAllTests() {
  try {
    useUrlOverride(true);
    await testCharset();
    await testDeviceInit();
    await testChargePlan();
    await testChargeValidation();
    await testChargeControl();
    await testChargeToken();
    // await testConnectHelp();
  } catch (err) {
    console.log('\x1b[1A[\x1b[31mFAILED\x1b[0m]');
    console.log(err);
  }
}

// Run all the testing
startAllTests();
// testState('testing/states/Anders_0.18.31_err.txt', 100);
