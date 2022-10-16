/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

const d = require('../common/devices');
const c = require('../common/constants');
const prices = require('../common/prices');
const Homey = require('./homey');
const PiggyBank = require('../app');
const { toLocalTime, fromLocalTime, timeToNextHour } = require('../common/homeytime');

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

// Test OnNewHour
async function testNewHour(numTests) {
  console.log('Testin onNewHour');
  const app = new PiggyBank();
  await app.onInit();
  let testAccum = 0;
  const now = new Date();
  console.log(`Start: ${testAccum} ?= ${app.__accum_energy} ||| ${now}`);
  let oldPow = 0;
  for (let i = 0; i < numTests; i++) {
    const randomTime = Math.round((2 + (Math.random() * 30)) * 1000);
    const randomPow = 300 + (Math.random() * 5000);
    const hourBefore = now.getHours();
    now.setMilliseconds(now.getMilliseconds() + randomTime);
    const hourAfter = now.getHours();
    if (hourBefore !== hourAfter) {
      const marginLow = Math.floor(testAccum * 0.98);
      const marginHigh = Math.ceil(testAccum * 1.02);
      if ((app.__accum_energy < marginLow) || (app.__accum_energy > marginHigh)) {
        throw new Error(`Accumulated energy not within bounds: ${app.__accum_energy} not in [${marginLow}, ${marginHigh}]`);
      }
      await app.onNewHour(true, now);
      if (app.__power_last_hour === undefined) {
        throw new Error('Last hour power is undefined');
      }
      testAccum = 0;
    } else {
      await app.onPowerUpdate(randomPow, now);
      testAccum += (oldPow * randomTime) / (1000 * 60 * 60);
      oldPow = randomPow;
    }
  }
  console.log(`End: ${testAccum} ?= ${app.__accum_energy} ||| ${now}`);
  await app.onUninit();
  console.log('Testin onNewHour - Passed');
}

async function applyBasicConfig(app) {
  app.homey.settings.set('operatingMode', c.MODE_NORMAL);
  app.homey.settings.set('maxPower', 5000);
  app.homey.settings.set('frostList', { id_a: { minTemp: 3 } });
  app.homey.settings.set('modeList', [
    // Normal
    [{ id: 'id_a', operation: c.CONTROLLED, targetTemp: 24 }],
    [{ id: 'id_a', operation: c.CONTROLLED, targetTemp: 24 }], // Night
    [{ id: 'id_a', operation: c.CONTROLLED, targetTemp: 24 }], // Away
  ]);
  app.homey.settings.set('priceActionList', [
    {id_a: {operation: c.EMERGENCY_OFF}}, {id_a: {operation: c.EMERGENCY_OFF}}, {id_a: {operation: c.EMERGENCY_OFF}}, {id_a: {operation: c.EMERGENCY_OFF}}, {id_a: {operation: c.EMERGENCY_OFF}}
  ]);
  app.homey.settings.set('priceMode', c.PRICE_MODE_INTERNAL);
  const futureData = app.homey.settings.get('futurePriceOptions');
  futureData.priceKind = c.PRICE_KIND_SPOT;
  app.homey.settings.set('futurePriceOptions', futureData);
  app.app_is_configured = app.validateSettings();
  await app.doPriceCalculations();
}

// Test Charging
async function testCharging() {
  console.log('Testin charging');
  const app = new PiggyBank();
  await app.onInit();
  await applyBasicConfig(app);
  const now = new Date();
  console.log(`Start: ${now}`);

  app.onChargingCycleStart(10, '08:00');

  console.log(`End: ${now}`);
  await app.onUninit();
  console.log('Testin charging - Passed');
}

// Start all tests
async function startAllTests() {
  try {
/*    await testCurrencyConverter();
    await testApp();
    await testEntsoe();
    await testNewHour(20000);*/
    await testCharging();
  } catch (err) {
    console.log(`Testing failed: ${err}`);
  }
}

// Run all the testing
startAllTests();
