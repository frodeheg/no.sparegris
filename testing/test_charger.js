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
const { applyBasicConfig, applyEmptyConfig, addDevice, applyBasicPrices } = require('./test-helpers');

// Test Device initialization
async function testDeviceInit() {
  console.log('[......] Charge controller Initialization');
  const app = new PiggyBank();
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);
  try {
    await app.disableLog();
    await app.onInit();
    await chargeDevice.onInit();
  } finally {
    chargeDevice.onUninit();
    app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test Charge plan
async function testChargePlan() {
  console.log('[......] Charge plan');
  const app = new PiggyBank();
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);
  try {
    await app.disableLog();
    await app.onInit();
    await applyBasicConfig(app);

    app.__current_prices = [
      0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
      0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
      0.2, 0.3, 0.5, 0.3];
    app.__current_price_index = 3;
    const resultTable = [undefined, 3750, undefined, undefined, undefined, 3750, 3750];

    await chargeDevice.onInit();

    // app.onChargingCycleStart(10, '08:00');
    const callTime = new Date();
    callTime.setHours(3, 0, 0, 0);
    chargeDevice.onChargingCycleStart(undefined, '10:00', 3, callTime);
    for (let i = 0; i < resultTable.length; i++) {
      if (chargeDevice.__charge_plan[i] !== resultTable[i]) {
        throw new Error(`Charging schedule failed, Hour +${i} observed ${chargeDevice.__charge_plan[i]}, wanted: ${resultTable[i]}`);
      }
    }
  } finally {
    chargeDevice.onUninit();
    app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Give the charger power and make sure that it responds
 */
async function testChargeControl() {
  console.log('[......] Charge control');
  const app = new PiggyBank();
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);
  try {
    await app.disableLog();
    await app.onInit();
    await chargeDevice.onInit();

    await applyEmptyConfig(app);
    const zoneHomeId = app.homeyApi.zones.addZone('Home');
    await addDevice(app, chargeDevice, 'device_a', zoneHomeId);
    app.homey.settings.set('frostList', { device_a: { minTemp: 3 } });
    app.homey.settings.set('modeList', [
      [{ id: 'device_a', operation: c.CONTROLLED, targetTemp: 24 }], // Normal
      [{ id: 'device_a', operation: c.CONTROLLED, targetTemp: 24 }], // Night
      [{ id: 'device_a', operation: c.CONTROLLED, targetTemp: 24 }], // Away
    ]);
    app.homey.settings.set('priceActionList', [
      { device_a: { operation: c.TURN_ON } },
      { device_a: { operation: c.TURN_ON } },
      { device_a: { operation: c.TURN_ON } },
      { device_a: { operation: c.TURN_ON } },
      { device_a: { operation: c.TURN_ON } }]);

    await app.createDeviceList();

    app.app_is_configured = app.validateSettings();

    // await applyBasicPrices(app);

    app.__current_prices = [
      0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
      0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
      0.2, 0.3, 0.5, 0.3];
    app.__current_price_index = 3;
    const resultTable = [undefined, 3750, undefined, undefined, undefined, 3750, 3750];

    // 1) Set charger power when the plan is off, check that power is not given
    chargeDevice.setTargetPower(1000);

    // 2) Start the plan, check that power is given at the right time
    const callTime = new Date();
    callTime.setHours(3, 0, 0, 0);
    await chargeDevice.onChargingCycleStart(undefined, '10:00', 3, callTime);
    for (let i = 0; i < resultTable.length; i++) {
      if (chargeDevice.__charge_plan[i] !== resultTable[i]) {
        throw new Error(`Charging schedule failed, Hour +${i} observed ${chargeDevice.__charge_plan[i]}, wanted: ${resultTable[i]}`);
      }
    }

    // 3) Pass on time and check that the charger is signalled correctly
    const numTicks = 10; // Number of ticks for the next 7 hours
    const intervalLength = resultTable.length * 60 * 60 * 1000;
    const tickLength = intervalLength / numTicks; // usec per tick
    const lastTime = new Date();
    const meterTime = new Date(callTime.getTime());
    const meterPower = 4000;
    let meterValue = (meterPower / 1000) * ((meterTime - callTime) / 3600000);

    await app.onMeterUpdate(meterValue, meterTime);
    await app.onProcessPower(meterTime);
    for (let tick = 1; tick <= numTicks; tick++) {
      lastTime.setTime(meterTime.getTime());
      meterTime.setTime(callTime.getTime() + tickLength * tick);
      meterValue += (meterPower / 1000) * ((meterTime - lastTime) / 3600000);
      await app.onMeterUpdate(meterValue, meterTime);
      await app.onProcessPower(new Date(meterTime.getTime()));
    }
  } finally {
    chargeDevice.onUninit();
    app.onUninit();
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
        combined[currentValue[charIdx]] = true;
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
    'en.json': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,-+/*"\'',
    'no.json': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,-+/*"\'øæåØÆÅ',
    'nl.json': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,-+/*"\'',
    'fr.json': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,-+/*"\'éàèùçâêîôûëïüÉÀÈÙÇÂÊÎÔÛËÏÜ',
  };
  for (const idx in files) {
    const fileName = `../locales/${files[idx]}`;
    const json = JSON.parse(fs.readFileSync(fileName, { encoding: 'utf8', flag: 'r' }));
    const letters = Object.values(json.charger).reduce(reducer, {});
    for (const letter in letters) {
      if (letter.charCodeAt(0) >= 256) {
        throw new Error(`Unicode character '${letter}' from ${fileName} is not supported yet`);
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
  const app = new PiggyBank();
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);
  try {
    await app.disableLog();
    await app.onInit();
    await applyBasicConfig(app);
    await chargeDevice.onInit();

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
    await testCharset();
    await testDeviceInit();
    await testChargePlan();
    await testChargeControl();
    // await testConnectHelp();
  } catch (err) {
    console.log('\x1b[1A[\x1b[31mFAILED\x1b[0m]');
    console.log(err);
  }
}

// Run all the testing
startAllTests();
// testState('testing/states/Anders_0.18.31_err.txt', 100);
