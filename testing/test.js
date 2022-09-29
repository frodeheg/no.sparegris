/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

const d = require('../common/devices');
const c = require('../common/constants');
const prices = require('../common/prices');
const Homey = require('./homey');
const PiggyBank = require('../app');
const { toLocalTime } = require('../common/homeytime');

// Test Currency Converter
// * Test that the date for the last currency fetched is recent... otherwise the API could have changed
async function testCurrencyConverter() {
  console.log('Testing Currency Converter');
  const currencyTable = await prices.fetchCurrencyTable('EUR');
  const now = new Date();
  for (const currency in currencyTable) {
    const sampleTime = new Date(currencyTable[currency].date);
    if ((currency === 'NOK') || (currency === 'RUB')) continue;
    if (now - sampleTime > 4 * 24 * 60 * 60 * 1000) {
      throw new Error(`No recent samples for currency ${currency}, last sample time: ${sampleTime}`);
    }
  }
  console.log('Testing Currency Converter - Passed');
}

// Test App
async function testApp() {
  console.log('Testing App init');
  const app = new PiggyBank();
  await app.onInit();
  await app.onUninit();
  console.log('Testing App init - Passed');
}

// Test Entsoe Integration
async function testEntsoe() {
  console.log('Testing Entsoe');
  const app = new PiggyBank();
  await app.onInit();
  await prices.entsoeApiInit(Homey.env.ENTSOE_TOKEN);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const priceData = await prices.entsoeGetData(todayStart, 'NOK');
  // console.log(priceData);
  const surcharge = 0.0198;// Network provider provision
  const VAT = 0.25; // 25% moms
  const gridTaxDay = 0.3626; // Between 6-22
  const gridTaxNight = 0.2839; // Between 22-6
  const finalPrices = await prices.applyTaxesOnSpotprice(priceData, surcharge, VAT, gridTaxDay, gridTaxNight, app.homey);
  console.log(finalPrices);

  await app.onUninit();
  console.log('Testing Entsoe - Passed');
}

// Start all tests
async function startAllTests() {
  try {
    await testCurrencyConverter();
    await testApp();
    await testEntsoe();
  } catch (err) {
    console.log(`Testing failed: ${err}`);
  }
}

// Run all the testing
startAllTests();
