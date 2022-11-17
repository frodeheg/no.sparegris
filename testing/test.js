/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

const fs = require('fs');
const d = require('../common/devices');
const c = require('../common/constants');
const prices = require('../common/prices');
const { addToArchive, cleanArchive, getArchive } = require('../common/archive');
const Homey = require('./homey');
const PiggyBank = require('../app');
const { toLocalTime, fromLocalTime, timeToNextHour, roundToStartOfDay } = require('../common/homeytime');

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
  app.__deviceList = {
    id_a: { name:"DeviceNamenamenamenamename 1", room: "Stue",    image: "x.jpg", use: true, priority: 0, thermostat_cap: true, reliability: 1.0, driverId: 'no.thermofloor:TF_Thermostat' },
    id_b: { name:"DeviceName 2", room: "Kjøkken", image: "x.jpg", use: true, priority: 1, thermostat_cap: true, reliability: 0.5, driverId: 'no.thermofloor:Z-TRM2fx' },
    id_c: { name:"DeviceName 3", room: "Bad",     image: "x.jpg", use: true, priority: 0, thermostat_cap: false, reliability: 0.6, driverId: 'no.thermofloor:Z-TRM3' },
    id_d: { name:"DeviceName 4", room: "Bad",     image: "x.jpg", use: false, priority: 1, thermostat_cap: true, reliability: 0.7, driverId: 'se.husdata:H60' },
    id_e: { name:"DeviceName 3", room: "Bad",     image: "x.jpg", use: true, priority: 0, thermostat_cap: false, reliability: 0.6, driverId: 'com.everspring:AN179' }
  }
  app.homey.settings.set('priceMode', c.PRICE_MODE_INTERNAL);
  const futureData = app.homey.settings.get('futurePriceOptions');
  futureData.priceKind = c.PRICE_KIND_SPOT;
  futureData.averageTime = 2;
  app.homey.settings.set('futurePriceOptions', futureData);
  app.app_is_configured = app.validateSettings();
  const fakeDevices = [
    'com.mill.txt',
    'com.mill.txt',
  //  { id: 'id_a', capabilitiesObj: { measure_temperature: { value: 1 }, target_temperature: { value: 20 } } },
  //  { id: 'id_b', capabilitiesObj: { measure_temperature: { value: 1 }, target_temperature: { value: 20 } } },
  //  { id: 'id_c', capabilitiesObj: { measure_temperature: { value: 1 }, target_temperature: { value: 20 } } },
  //  { id: 'id_d', capabilitiesObj: { measure_temperature: { value: 1 }, target_temperature: { value: 20 } } },
  //  { id: 'id_e', capabilitiesObj: { measure_temperature: { value: 1 }, target_temperature: { value: 20 } } },
  ];
  const zoneHomeId = app.homeyApi.zones.addZone('Home');
  const zoneGangId = app.homeyApi.zones.addZone('Gang', null, zoneHomeId);
  app.homeyApi.devices.addFakeDevices(fakeDevices, zoneGangId);
  await app.createDeviceList(); // To initialize app.__current_state[...]
  await app.doPriceCalculations();
}

async function applyStateFromFile(app, file) {
  const p = Promise;
  fs.readFile(`testing/${file}`, (err, data) => {
    if (err) {
      p.reject(err);
    }
    const parsed = JSON.parse(data);
    app.homey.settings.values = parsed.settings;
    for (const v in parsed.state) {
      app[v] = parsed.state[v];
    }
    // Create fake devices to match the loaded state
    for (const deviceId in parsed.settings.deviceList) {
      const devInfo = parsed.settings.deviceList[deviceId];
      const fileName = `${devInfo.driverId}.txt`;
      const zones = app.homeyApi.zones.getZones();
      let fakeDev;
      for (let idx = devInfo.memberOf.length - 1; idx >= 0; idx--) {
        const zoneId = devInfo.memberOf[idx];
        const zoneName = (idx === 0) ? devInfo.room : `${devInfo.room}_parent_${idx}`;
        const parentId = devInfo.memberOf[idx + 1] || null;
        if (!(zoneId in zones)) app.homeyApi.zones.addZone(zoneName, zoneId, parentId);
        else if (idx === 0) app.homeyApi.zones.zones[zoneId].name = devInfo.room;
      }
      try {
        fakeDev = app.homeyApi.devices.addFakeDevice(fileName, devInfo.roomId);
      } catch (err) {
        console.log(`Missing file: ${fileName} - overriding with defaults`);
        const dummyCap = {};
        if (devInfo.thermostat_cap) {
          dummyCap.measure_temperature = { value: 1 };
          dummyCap.target_temperature = { value: 20 };
        }
        if (devInfo.onoff_cap) {
          dummyCap[devInfo.onoff_cap] = { value: false };
        }
        const dummyDevice = { id: deviceId, capabilitiesObj: dummyCap };
        fakeDev = app.homeyApi.devices.addFakeDevice(dummyDevice, devInfo.roomId);
        fakeDev.driverUri = `homey:app:${devInfo.driverId.slice(0, devInfo.driverId.indexOf(':'))}`;
        fakeDev.driverId = devInfo.driverId.slice(devInfo.driverId.indexOf(':') + 1);
      }
      fakeDev.deviceId = deviceId;
      fakeDev.name = devInfo.name;
    }
    p.resolve();
  });
  return p;
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

async function testState(stateDump) {
  console.log(`[......] State "${stateDump}"`);
  const app = new PiggyBank();
  await app.disableLog();
  await app.onInit();
  await applyStateFromFile(app, stateDump);
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
    await testMail();
  } catch (err) {
    console.log('\x1b[1A[\x1b[31mFAILED\x1b[0m]');
    console.log(err);
  }
}

// Run all the testing
startAllTests();
//testState('states/Anders_0.18.31_err.txt');
