/* eslint-disable no-multi-spaces */
/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

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
  let app;
  let chargeDriver;
  let chargeDevice;
  try {
    app = new PiggyBank();
    chargeDriver = new ChargeDriver('piggy-charger', app);
    chargeDevice = new ChargeDevice(chargeDriver);
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
  let app;
  let chargeDriver;
  let chargeDevice;
  try {
    app = new PiggyBank();
    chargeDriver = new ChargeDriver('piggy-charger', app);
    chargeDevice = new ChargeDevice(chargeDriver);
    await app.disableLog();
    await app.onInit();
    await applyBasicConfig(app);
    await chargeDevice.onInit();
  } finally {
    chargeDevice.onUninit();
    app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Start all tests
async function startAllTests() {
  try {
    await testDeviceInit();
    await testChargePlan();
  } catch (err) {
    console.log('\x1b[1A[\x1b[31mFAILED\x1b[0m]');
    console.log(err);
  }
}

// Run all the testing
startAllTests();
// testState('testing/states/Anders_0.18.31_err.txt', 100);
