/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

const d = require('../common/devices');
const c = require('../common/constants');
const prices = require('../common/prices');
const PiggyBank = require('../app');

// Test Currency Converter
// * Test that the date for the last currency fetched is recent... otherwise the API could have changed
async function testCurrencyConverter() {
  console.log('Testing Currency Converter');
  const currencyTable = await prices.fetchCurrencyTable('EUR');
  const now = new Date();
  for (const currency in currencyTable) {
    const sampleTime = new Date(currencyTable[currency].date);
    if (currency === 'NOK') continue;
    if (now - sampleTime > 4 * 24 * 60 * 60 * 1000) {
      throw new Error(`No recent samples for currency ${currency}`);
    }
  }
  console.log('Passed.');
}

// Test
async function testApp() {
  console.log('Testing App init');
  const app = new PiggyBank();
  await app.onInit();
  await app.onUninit();
  console.log('Passed');
}

// Start all tests
async function startAllTests() {
  try {
    await testCurrencyConverter();
    await testApp();
  } catch (err) {
    console.log(`Testing failed: ${err}`);
  }
}

// Run all the testing
startAllTests();
