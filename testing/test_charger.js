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
// const c = require('../common/constants');
// const prices = require('../common/prices');
// const { addToArchive, cleanArchive, getArchive, changeArchiveMode, clearArchive } = require('../common/archive');
// const Homey = require('./homey');
const PiggyBank = require('../app');
const ChargeDevice = require('../drivers/piggy-charger/device');
const ChargeDriver = require('../drivers/piggy-charger/driver');
// const { TIMESPAN, roundToStartOfDay, timeToNextHour, toLocalTime, fromLocalTime, timeToNextSlot, timeSinceLastSlot, timeSinceLastLimiter, hoursInDay } = require('../common/homeytime');
// const { disableTimers, applyStateFromFile, getAllDeviceId, writePowerStatus, setAllDeviceState, validateModeList, compareJSON, checkForTranslations } = require('./test-helpers');
const { applyBasicConfig } = require('./test-helpers');

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
    'fr.json': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,-+/*"\'éàèùçâêîôûëïüÉ',
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
  console.log('[......] Image generation');
  const app = new PiggyBank();
  const chargeDriver = new ChargeDriver('piggy-charger', app);
  const chargeDevice = new ChargeDevice(chargeDriver);
  try {
    await app.disableLog();
    await app.onInit();
    await applyBasicConfig(app);
    await chargeDevice.onInit();

    // TODO: check chargeDevice.camera.front.image
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
    await testConnectHelp();
  } catch (err) {
    console.log('\x1b[1A[\x1b[31mFAILED\x1b[0m]');
    console.log(err);
  }
}

// Run all the testing
startAllTests();
// testState('testing/states/Anders_0.18.31_err.txt', 100);
