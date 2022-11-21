/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

const c = require('../common/constants');
const prices = require('../common/prices');
const { addToArchive, cleanArchive, getArchive } = require('../common/archive');
const Homey = require('./homey');
const PiggyBank = require('../app');
const { toLocalTime, fromLocalTime, timeToNextHour, roundToStartOfDay } = require('../common/homeytime');
const { disableTimers, applyBasicConfig, applyStateFromFile, getAllDeviceId, writePowerStatus } = require('./test-helpers');

// Test Currency Converter
// * Test that the date for the last currency fetched is recent... otherwise the API could have changed
async function testCurrencyConverter() {
  console.log('[......] Currency Converter');
  const currencyTable = await prices.fetchCurrencyTable('EUR');
  const now = new Date();
  for (const currency in currencyTable) {
    const sampleTime = new Date(currencyTable[currency].date);
    if ((currency === 'NOK') || (currency === 'RUB')) continue;
    if (now - sampleTime > 4 * 24 * 60 * 60 * 1000) {
      throw new Error(`No recent samples for currency ${currency}, last sample time: ${sampleTime}`);
    }
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test App
async function testApp() {
  console.log('[......] App init');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test Entsoe Integration
async function testEntsoe() {
  console.log('[......] Entsoe');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await prices.entsoeApiInit(Homey.env.ENTSOE_TOKEN);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const biddingZone = '10YNO-3--------J';
  const priceData = await prices.entsoeGetData(todayStart, 'NOK', biddingZone);
  // console.log(priceData);
  const surcharge = 0.0198;// Network provider provision
  const VAT = 0.25; // 25% moms
  const gridTaxDay = 0.3626; // Between 6-22
  const gridTaxNight = 0.2839; // Between 22-6
  const finalPrices = await prices.applyTaxesOnSpotprice(priceData, surcharge, VAT, gridTaxDay, gridTaxNight, app.homey);
  if (finalPrices.length < 24) {
    console.log(finalPrices);
    throw new Error('Entsoe API is not returning the prices');
  }

  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test OnNewHour
async function testNewHour(numTests) {
  console.log('[......] onNewHour');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  let testAccum = 0;
  let now = new Date();
  // console.log(`Start: ${now}`);
  let oldPow = 0;
  for (let i = 0; i < numTests; i++) {
    const randomTime = Math.round((2 + (Math.random() * 30)) * 1000);
    const randomPow = 300 + (Math.random() * 5000);
    const hourBefore = now.getHours();
    now = new Date(now.getTime() + randomTime);
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
  // console.log(`End: ${now}`);
  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test Charging
async function testCharging() {
  console.log('[......] charging');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await applyBasicConfig(app);

  app.__current_prices = [
    0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
    0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2,
    0.2, 0.3, 0.5, 0.3];
  app.__current_price_index = 3;
  const resultTable = [undefined, 3750, undefined, undefined, undefined, 3750, 3750];
  // app.onChargingCycleStart(10, '08:00');
  const callTime = new Date();
  callTime.setHours(3, 0, 0, 0);
  app.onChargingCycleStart(undefined, '10:00', 3, callTime);
  for (let i = 0; i < app.__charge_plan.length; i++) {
    if (app.__charge_plan[i] !== resultTable[i]) {
      for (let j = 0; j < app.__charge_plan.length; j++) console.log(`Charge plan hour +${j}: plan ${app.__charge_plan[j]}, wanted: ${resultTable[j]}`);
      throw new Error('Charging schedule failed');
    }
  }

  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test reliability
async function testReliability() {
  console.log('[......] reliability');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await applyBasicConfig(app);

  if (Object.keys(app.__deviceList).length === 0) {
    throw new Error('No devices found');
  }
  for (const deviceId in app.__deviceList) {
    const device = app.__deviceList[deviceId];
    const oldReliability = device.reliability;
    app.updateReliability(deviceId, 0);
    app.updateReliability(deviceId, 1);
    // console.log(`Reliability: ${device.reliability}`);
    if (device.reliability !== (oldReliability * 0.99 * 0.99 + 0.01)) {
      throw new Error('Reliability test failed');
    }
  }

  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test Mail
async function testMail() {
  console.log('[......] mail');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await applyBasicConfig(app);
  app.updateLog('This is a test message from the validation script', c.LOG_ALL);
  await app.sendLog();
  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test price points
async function testPricePoints() {
  console.log('[......] price points');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await applyBasicConfig(app);
  app.__all_prices = [];
  app.__current_prices = [
    0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 1.8, 0.1, 0.2, 0.2, 0.3,
    0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2, 0.2, 0.3, 0.5, 0.3,
    0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2, 0.2, 0.3,
    0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2, 0.2, 0.3, 0.5, 0.3];
  const CorrectPP = [4, 0, 1, 0, 4, 1, 2, 3, 4, 4, 4, 0, 1, 0, 4, 1, 2, 2, 4, 4, 4, 0, 1, 0];
  //const sortedPrices = app.__current_prices.slice(0, 24).sort((a, b) => b - a);
  //console.log(`Sorted prices: ${sortedPrices}`); //High cap: 0.5, low cap: 0.2
  app.homey.settings.set('averagePrice', 0.6);

  const now = roundToStartOfDay(new Date(1666396747401), app.homey);
  for (let i = 0; i < app.__current_prices.length; i++) {
    const newPrice = { time: (now.getTime() / 1000) + (i * 60 * 60), price: app.__current_prices[i] };
    app.__all_prices.push(newPrice);
  }

  for (let hour = 0; hour < 24; hour++) {
    const curTime = new Date(now.getTime());
    curTime.setHours(now.getHours() + hour, 0, 0, 0);
    await app.onNewHour(true, curTime);
    if (app.__current_price_index !== hour) throw new Error('Current hour is not calculated correctly');
    if (app.homey.settings.get('pricePoint') !== CorrectPP[hour]) throw new Error(`Invalid Price point at hour ${hour}`);
    // console.log(`${String(hour).padStart(2, '0')}:00 Price: ${app.__current_prices[hour]} (${ppNames[app.homey.settings.get('pricePoint')]})`);
  }

  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Test Archive functions
 */
async function testArchive() {
  console.log('[......] Archive');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await applyBasicConfig(app);

  let now = roundToStartOfDay(new Date(1666396747401 + (1000*60*60*24*(8))), app.homey);
  for (let i = 0; i < 50; i++) {
    const data = {
      maxPower: 500 + Math.round(Math.random() * 4500),
      dataOk: (Math.random() > 0.001),
      powUsage: 500 + Math.round(Math.random() * 4500),
      moneySavedTariff: (Math.round(Math.random() * 10) - 2),
      moneySavedUsage: (i % (30 * 24) === 0) ? 70 : 0,
      price: 0.8 + (Math.random() * 1),
      pricePoints: Math.floor(Math.random() * 5),
      overShootAvoided: (Math.random() > 0.02),
    };
    await addToArchive(app.homey, data, now);
    //await cleanArchive(app.homey);
    now = new Date(now.getTime() + (60 * 60 * 1000));
  }
  const archive = await getArchive(app.homey);
  // TODO: TEST THE VALUES
  //console.log(archive['pricePoints']);
  //console.log(archive['pricePoints']['daily']['2022-10']);
  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/* async function testPricePoints2() {
  console.log('[......] Minimum number of cheap/expensive hours');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await applyBasicConfig(app);
  app.__all_prices = [];
  app.__current_prices = [
    0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 1.8, 0.1, 0.2, 0.2, 0.3,
    0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2, 0.2, 0.3, 0.5, 0.3,
    0.2, 0.3, 0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2, 0.2, 0.3,
    0.5, 0.3, 0.2, 0.5, 0.9, 0.8, 0.1, 0.2, 0.2, 0.3, 0.5, 0.3];
  const CorrectPP = [4, 0, 1, 0, 4, 1, 2, 3, 4, 4, 4, 0, 1, 0, 4, 1, 2, 2, 4, 4, 4, 0, 1, 0];
  //const sortedPrices = app.__current_prices.slice(0, 24).sort((a, b) => b - a);
  //console.log(`Sorted prices: ${sortedPrices}`); //High cap: 0.5, low cap: 0.2
  app.homey.settings.set('averagePrice', 0.6);

  const now = roundToStartOfDay(new Date(1666396747401), app.homey);
  for (let i = 0; i < app.__current_prices.length; i++) {
    const newPrice = { time: (now.getTime() / 1000) + (i * 60 * 60), price: app.__current_prices[i] };
    app.__all_prices.push(newPrice);
  }

  for (let hour = 0; hour < 24; hour++) {
    const curTime = new Date(now.getTime());
    curTime.setHours(now.getHours() + hour, 0, 0, 0);
    await app.onNewHour(true, curTime);
    if (app.__current_price_index !== hour) throw new Error('Current hour is not calculated correctly');
    if (app.homey.settings.get('pricePoint') !== CorrectPP[hour]) throw new Error(`Invalid Price point at hour ${hour}`);
    // console.log(`${String(hour).padStart(2, '0')}:00 Price: ${app.__current_prices[hour]} (${ppNames[app.homey.settings.get('pricePoint')]})`);
  }

  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
} */

/**
 * Test that all devices does power on in after a while
 */
async function testPowerOnAll() {
  console.log('[......] Test Power On after Failure');
  const stateDump = 'states/Anders_0.18.31_err.txt';
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  app.setLogLevel(c.LOG_DEBUG);
  await disableTimers(app);
  await applyStateFromFile(app, stateDump);
  const devices = await getAllDeviceId(app);
  await app.onZoneUpdate({ name: 'Zone 1', id: '5a54cb5a-0628-49d3-be36-6f0a29a5e954' }, true);
  await app.onZoneUpdate({ name: 'Zone 2', id: '630d051c-ad8d-47b8-b2e2-1b8dc9e2c2f2' }, true);
  // Simulate time going forward
  const curTime = app.__current_power_time;
  for (let i = 0; i < 10; i++) {
    curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
    await app.onPowerUpdate(0, curTime);
  }
  // Test that all devices are on
  for (let i = 0; i < devices.length; i++) {
    const deviceId = devices[i];
    const device = await app.getDevice(deviceId);
    const isOn = await app.getIsOn(device, deviceId);
    if (app.__deviceList[deviceId].use && !isOn) throw new Error(`Device is still off: ${deviceId}`);
  }
  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Github issue #84
 */
async function testIssue84() {
  console.log('[......] Test Github issue #84: AC maintanance button');
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await applyBasicConfig(app);

  await app.filterChangeAC();
  const override = app.homey.settings.get('override');
  if (Object.keys(override).length !== 2) {
    throw new Error('Override AC devices did not work');
  }

  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Github issue #87
 */
async function testIssue83And87() {
  console.log('[......] Test Github issue #83 and #87: Incorrect temperature');
  const stateDump = 'states/Frode_0.19.4_bug87.txt';
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  app.setLogLevel(c.LOG_DEBUG);
  await disableTimers(app);
  await applyStateFromFile(app, stateDump);
  const devices = await getAllDeviceId(app);

  // Simulate time going forward
  const curTime = app.__current_power_time;
  for (let i = 0; i < 10; i++) {
    curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
    await app.onPowerUpdate(0, curTime);
  }
  // Test that all devices are the right temperature
  const rightTemp = {
    '33fa2e27-a8cb-4e65-87f8-13545305101a': 11,
    '734fab2d-2c19-4032-8726-d0a40624c3fb': 11,
    '0a763eab-ffde-4581-af47-58755bbb22ed': 6,
    'ef2c3457-0a55-4ccd-a943-58de258d07dd': 11.5,
    '7e844fe8-3f2e-4206-a849-aa5541883c9b': 6,
    '1160d771-5a69-445c-add1-3943ccb16d43': 6,
    'eb3be21c-bcb2-47b2-9393-eae2d33737dc': 55,
    'b4788083-9606-49a2-99d4-9efce7a4656d': 16,
  };
  for (let i = 0; i < devices.length; i++) {
    const deviceId = devices[i];
    const device = await app.getDevice(deviceId);
    if (device.capabilities.includes(app.getTempSetCap())) {
      const actualTemp = device.capabilitiesObj[app.getTempSetCap()].value;
      if (actualTemp !== rightTemp[deviceId]) {
        throw new Error(`Incorrect temperature for device ${deviceId}: ${actualTemp} !== ${rightTemp[deviceId]}`);
      }
    }
  }

  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Github ticket #88
 */
async function testTicket88() {
  console.log('[......] Test Github ticket #88: Override controlled');
  const stateDump = 'states/Frode_0.19.7_ticket88.txt';
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  app.setLogLevel(c.LOG_DEBUG);
  await disableTimers(app);
  await applyStateFromFile(app, stateDump);
  const devices = await getAllDeviceId(app);
  const curTime = app.__current_power_time;

  for (let times = 0; times < 2; times++) {
    // First run a little with insane power to turn everything off
    for (let i = 0; i < 5; i++) {
      curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
      try {
        await app.onPowerUpdate(7000, curTime);
      } catch (err) {}
    }
    // Test that all devices are off
    for (let i = 0; i < devices.length; i++) {
      const deviceId = devices[i];
      const device = await app.getDevice(deviceId);
      const isOn = await app.getIsOn(device, deviceId);
      if (app.__deviceList[deviceId].use && isOn) throw new Error(`Device is still on: ${deviceId}`);
    }
    await app.onNewHour(true, curTime);
    curTime.setTime(curTime.getTime() + Math.round(10*60000));
    await app.onPowerUpdate(0, curTime);
    curTime.setTime(curTime.getTime() + Math.round(10*60000));
    // Run some more to turn everything on again
    for (let i = 0; i < 5; i++) {
      curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
      await app.onPowerUpdate(0, curTime);
    }
    // Test that all devices are on
    for (let i = 0; i < devices.length; i++) {
      const deviceId = devices[i];
      const device = await app.getDevice(deviceId);
      const isOn = await app.getIsOn(device, deviceId);
      if (app.__deviceList[deviceId].use && !isOn) throw new Error(`Device is still off: ${deviceId}`);
    }
  }

  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * @param {*} stateDump The state dump to start simulating from
 * @param {*} simTime Number of secconds of simulation time
 */
async function testState(stateDump, simTime) {
  console.log(`[......] State "${stateDump}"`);
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  app.setLogLevel(c.LOG_DEBUG);
  await disableTimers(app);
  await applyStateFromFile(app, stateDump);
  const devices = await getAllDeviceId(app);
  await writePowerStatus(app, devices);
  // Simulate time going forward
  const curTime = app.__current_power_time;
  const startTime = new Date(curTime);
  while ((curTime.getTime() - startTime.getTime()) / 1000 < simTime) {
    curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
    const curPower = Math.round(1000 + Math.random() * 3000);
    await app.onPowerUpdate(curPower, curTime);
    await writePowerStatus(app, devices);
  }
  await app.onUninit();
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Start all tests
async function startAllTests() {
  try {
    await testCurrencyConverter();
    await testApp();
    await testEntsoe();
    await testNewHour(20000);
    await testCharging();
    await testReliability();
    await testPricePoints();
    // await testPricePoints2();
    await testArchive();
    await testPowerOnAll();
    await testIssue84();
    await testIssue83And87();
    await testTicket88();
    await testMail();
  } catch (err) {
    console.log('\x1b[1A[\x1b[31mFAILED\x1b[0m]');
    console.log(err);
  }
}

// Run all the testing
startAllTests();
//testState('states/Anders_0.18.31_err.txt', 100);
