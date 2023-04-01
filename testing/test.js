/* eslint-disable no-multi-spaces */
/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

// eslint-disable-next-line import/no-extraneous-dependencies
const seedrandom = require('seedrandom');
const fs = require('fs');
const c = require('../common/constants');
const prices = require('../common/prices');
const { addToArchive, cleanArchive, getArchive, changeArchiveMode, clearArchive } = require('../common/archive');
const Homey = require('./homey');
const PiggyBank = require('../app');
const { TIMESPAN, roundToStartOfDay, timeToNextHour, toLocalTime, fromLocalTime, timeToNextSlot, timeSinceLastSlot, timeSinceLastLimiter, hoursInDay } = require('../common/homeytime');
const { disableTimers, applyBasicConfig, applyStateFromFile, getAllDeviceId, writePowerStatus, setAllDeviceState, validateModeList, compareJSON, checkForTranslations } = require('./test-helpers');

// Test Currency Converter
// * Test that the date for the last currency fetched is recent... otherwise the API could have changed
async function testCurrencyConverter() {
  console.log('[......] Currency Converter');
  const now = new Date();
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await app.onInit();
    const currencyTable = await prices.fetchCurrencyTable('EUR', now, app.homey);
    for (const currency in currencyTable) {
      const sampleTime = new Date(currencyTable[currency].date);
      if ((currency === 'NOK') || (currency === 'RUB')) continue;
      if (now - sampleTime > 7 * 24 * 60 * 60 * 1000) {
        throw new Error(`No recent samples for currency ${currency}, last sample time: ${sampleTime}`);
      }
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test App
async function testApp() {
  console.log('[......] App init');
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await app.onInit();
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test Entsoe Integration
async function testEntsoe() {
  console.log('[......] Entsoe');
  const app = new PiggyBank();
  try {
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
    const peakStart = 6 * 60;
    const peakEnd = 22 * 60;
    const weekendOffPeak = false;
    const finalPrices = await prices.applyTaxesOnSpotprice(priceData, surcharge, VAT, gridTaxDay, gridTaxNight, peakStart, peakEnd, weekendOffPeak, app.homey);
    const dayLength = Math.max(hoursInDay(todayStart, app.homey), 23); // 24 hours normally, but allow 23 hours for summer-time transitions
    if (finalPrices.length < dayLength) {
      console.log(finalPrices);
      throw new Error('Entsoe API is not returning the prices');
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test OnNewSlot
async function testNewHour(numTests) {
  console.log('[......] onNewHour');
  let now = new Date('October 1, 2022, 00:30:00 GMT+2:00');// = new Date();
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await app.onInit(now);
    await disableTimers(app);
    let testAccum = app.homey.settings.get('maxPower')[TIMESPAN.HOUR] * 0.5;
    let oldPow = 0;
    let firstTime = true;
    for (let i = 0; i < numTests; i++) {
      const randomTime = Math.round((2 + (Math.random() * 30)) * 1000);
      const randomPow = 300 + (Math.random() * 5000);
      const hourBefore = now.getHours();
      const timeLimit = timeToNextHour(now);
      const limitedTime = randomTime < timeLimit ? randomTime : timeLimit;
      now = new Date(now.getTime() + randomTime);
      const hourAfter = now.getHours();

      await app.onPowerUpdate(randomPow, now);
      let accumData = [...app.__pendingOnNewSlot][0];
      await app.onProcessPower(now);
      testAccum += (oldPow * limitedTime) / (1000 * 60 * 60);
      oldPow = randomPow;

      if (hourBefore !== hourAfter) {
        const marginLow = Math.floor(testAccum * 0.98);
        const marginHigh = Math.ceil(testAccum * 1.02);
        if (!accumData && firstTime) {
          accumData = { accumEnergy: testAccum };
          firstTime = false;
        }
        if ((accumData.accumEnergy < marginLow) || (accumData.accumEnergy > marginHigh)) {
          throw new Error(`Accumulated energy not within bounds: ${accumData.accumEnergy} not in [${marginLow}, ${marginHigh}]`);
        }
        if (app.__energy_last_slot === undefined) {
          throw new Error('Last hour energy usage is undefined');
        }
        testAccum = 0;
      }
    }
    // console.log(`End: ${now}`);
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test Charging
async function testCharging() {
  console.log('[......] charging');
  const app = new PiggyBank();
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
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test reliability
async function testReliability() {
  console.log('[......] reliability');
  const app = new PiggyBank();
  try {
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
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test Mail
async function testMail() {
  console.log('[......] mail');
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await app.onInit();
    await applyBasicConfig(app);
    app.updateLog('This is a test message from the validation script', c.LOG_ALL);
    await app.sendLog();
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test price points
async function testPricePoints() {
  console.log('[......] price points');
  const app = new PiggyBank();
  try {
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
    // const sortedPrices = app.__current_prices.slice(0, 24).sort((a, b) => b - a);
    // console.log(`Sorted prices: ${sortedPrices}`); //High cap: 0.5, low cap: 0.2
    app.homey.settings.set('averagePrice', 0.6);

    const now = roundToStartOfDay(new Date(1666396747401), app.homey);
    for (let i = 0; i < app.__current_prices.length; i++) {
      const newPrice = { time: (now.getTime() / 1000) + (i * 60 * 60), price: app.__current_prices[i] };
      app.__all_prices.push(newPrice);
    }

    for (let hour = 0; hour < 24; hour++) {
      const curTime = new Date(now.getTime());
      const lastHourTime = new Date(now.getTime());
      curTime.setHours(now.getHours() + hour, 0, 0, 0);
      lastHourTime.setHours(now.getHours() + hour, -1, 0, 0);
      await app.onNewSlot(curTime, lastHourTime);
      if (app.__current_price_index !== hour) throw new Error('Current hour is not calculated correctly');
      if (app.homey.settings.get('pricePoint') !== CorrectPP[hour]) throw new Error(`Invalid Price point at hour ${hour}`);
      /* const ppNames = ['Billig', 'Normal', 'Dyrt', 'Kjempedyrt', 'Veldig billig'];
      const avgPrice = +app.homey.settings.get('averagePrice');
      console.log(`${String(hour).padStart(2, '0')}:00 Price: ${app.__current_prices[hour]}, avg: ${avgPrice.toFixed(2)} `
        + `(${ppNames[app.homey.settings.get('pricePoint')].padStart(13, ' ')} vs. ${ppNames[CorrectPP[hour]].padStart(13, ' ')})`); */
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Test Archive functions
 */
async function testArchive() {
  console.log('[......] Archive');
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await app.onInit();
    await applyBasicConfig(app);
    await app.homey.settings.set('expireDaily', 31);
    await app.homey.settings.set('expireHourly', 7);
    seedrandom('mySeed', { global: true });

    let now = roundToStartOfDay(new Date(1666396747401 + (1000 * 60 * 60 * 24 * (8))), app.homey);
    for (let i = 0; i < 5000; i++) {
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
      now = new Date(now.getTime() + (60 * 60 * 1000));
    }
    await cleanArchive(app.homey, now);
    const archive = await getArchive(app.homey);
    // eslint-disable-next-line max-len
    const expected = '{"maxPower":{"hourly":{"2023-05-19":[1262,2509,1547,4155,1419,4361,2581,1779,2044,2490,4777,1658,1791,3449,2526,2947,3906,1744,2083,899,2511,1429,4085,3615],"2023-05-20":[1320,1230,3280,501,4789,4262,2988,1968,3839,3256,1313,1046,4227,3425,4383,3253,4016,2757,2823,688,2363,4315,3260,4044],"2023-05-21":[2980,1481,3434,1639,3932,1387,3134,4079,1202,1336,1850,2940,792,4568,1753,3779,3655,4437,1353,681,3833,4947,783,4597],"2023-05-22":[1527,1367,2085,2898,3919,2387,1944,1766,1900,1557,4749,4507,1181,1233,2286,542,4943,2491,2494,3795,2976,3198,3612,4495],"2023-05-23":[3298,4841,4294,565,1685,4047,4799,2893,2566,4708,3197,3036,2382,1106,4684,4712,3229,1153,4651,4789,2346,708,2075,2433],"2023-05-24":[2864,908,1490,2454,3185,1233,4326,3990,977,4360,805,2091,4021,1971,2325,4745,2836,3992,3259,1771,1906,1799,3961,1903],"2023-05-25":[2408,1992,2887,4365,1999,3455,1149,4769,1077,1231,4856,1892,1624,998,2847,1532,744,1642,3592,572,766,3533,3187,2190],"2023-05-26":[2880,504,987,1373,2153,2443,4922,3182]},"daily":{"2023-04":[4864,4614,4865,4995,4703,4522,4798,4956,4856,4512,4887,4892,4690,4630,4907,4937,4699,4937,4755,4822,4969,4734,4749,4986,4965,4641,4914,4706,4493,4637],"2023-05":[4848,4875,4841,4994,4953,4990,4830,4735,4927,4363,4905,4751,4725,4548,4920,4847,4989,4977,4777,4789,4947,4943,4841,4745,4856,4922]},"monthly":{"2022":[null,null,null,null,null,null,null,null,null,4781.5,4969,4994],"2023":[4978.666666666667,4973.666666666667,4990.333333333333,4983.333333333333,4991]},"yearly":{"2022":[4999],"2023":[4998]}},"dataOk":{"hourly":{"2023-05-19":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-20":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-21":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-22":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-23":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-24":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-25":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-26":[1,1,1,1,1,1,1,1]},"daily":{"2023-04":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]},"monthly":{"2022":[null,null,null,null,null,null,null,null,null,1,0.9972222222222221,1],"2023":[0.9973118279569892,1,1,1,1]},"yearly":{"2022":[0.9990740740740741],"2023":[0.9994623655913978]}},"powUsage":{"hourly":{"2023-05-19":[1985,1743,2592,1333,4291,552,4569,3767,4577,4184,2201,4770,2197,4253,3594,1291,3074,1587,4313,4572,3987,1174,4489,2490],"2023-05-20":[2062,2829,2358,2473,3683,2798,4987,3617,787,2076,3160,1456,1199,1172,2648,3287,3042,4791,714,1725,4659,1721,3575,3446],"2023-05-21":[4452,3909,1180,3153,1607,3984,1845,4985,2234,4194,4461,4569,3808,3280,4169,3990,2135,4506,548,2323,2746,3418,4752,3938],"2023-05-22":[2632,4757,522,2998,2675,502,3647,1213,2474,1445,4137,731,1004,3024,4411,2543,2389,1874,3336,2338,4754,4762,4521,2629],"2023-05-23":[1336,4228,2774,3981,1486,1183,1106,1490,2460,4697,3340,1869,651,1675,2081,3390,2190,651,961,1869,790,3296,1539,2446],"2023-05-24":[1863,1622,742,1808,3893,3786,4716,4068,1447,1967,2952,2916,2498,1090,4998,2884,3212,2283,1804,2951,4457,3685,4645,1190],"2023-05-25":[2943,4546,2249,3586,3475,4797,4124,2775,2470,2629,1464,2963,4869,4176,3417,2102,4588,4396,829,2944,3553,621,762,1138],"2023-05-26":[1170,3437,2825,4286,3452,1777,1774,1147]},"daily":{"2023-04":[53656,60300,62665,60966,63166,62118,67420,67273,64040,64345,78306,65634,67020,54242,58170,76094,65462,69983,66911,54694,59164,69843,55676,66808,57447,69413,76178,67498,54974,55564],"2023-05":[58821,71394,54968,65340,57325,76127,61563,75413,74965,71956,67427,66364,73019,66398,60049,61127,69990,71626,73585,64265,80186,65318,51489,67477,71416,19868]},"monthly":{"2022":[null,null,null,null,null,null,null,null,null,135005,1983472,2047727],"2023":[2073598,1826305,2070128,1915030,1697476]},"yearly":{"2022":[4166204],"2023":[9582537]}},"moneySavedTariff":{"hourly":{"2023-05-19":[1,2,6,3,3,6,7,3,8,4,8,6,3,2,7,2,8,3,5,3,-2,-1,4,3],"2023-05-20":[-1,6,0,4,5,4,4,4,8,4,2,4,-1,2,7,4,8,2,3,6,6,5,1,4],"2023-05-21":[5,7,3,1,4,-2,0,3,0,3,-1,6,3,-2,3,3,-1,5,2,1,1,-1,0,1],"2023-05-22":[6,1,5,0,6,7,0,6,0,4,5,0,4,5,-1,6,4,5,6,0,2,1,-1,7],"2023-05-23":[0,6,2,2,0,7,1,7,-2,0,-1,7,1,5,3,-1,4,6,1,1,2,3,6,3],"2023-05-24":[-2,3,7,-1,8,-2,7,4,7,2,6,3,6,7,2,4,2,1,5,3,5,2,4,-2],"2023-05-25":[-1,-1,1,7,2,2,8,-1,1,2,1,1,1,1,0,2,2,-2,6,3,0,2,5,5],"2023-05-26":[5,4,-1,1,5,6,0,3]},"daily":{"2023-04":[94,77,83,73,63,83,78,98,68,71,59,52,43,92,62,74,62,79,78,75,68,59,67,96,76,64,87,59,78,78],"2023-05":[65,54,79,56,64,60,75,61,76,89,57,61,97,72,57,79,61,91,94,91,44,78,63,81,47,23]},"monthly":{"2022":[null,null,null,null,null,null,null,null,null,155,2149,2350],"2023":[2188,2042,2398,2196,1775]},"yearly":{"2022":[4654],"2023":[10599]}},"moneySavedUsage":{"hourly":{"2023-05-19":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"2023-05-20":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"2023-05-21":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"2023-05-22":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"2023-05-23":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"2023-05-24":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"2023-05-25":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"2023-05-26":[0,0,0,0,0,0,0,0]},"daily":{"2023-04":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,70,0,0],"2023-05":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},"monthly":{"2022":[null,null,null,null,null,null,null,null,null,70,70,70],"2023":[70,70,70,70,0]},"yearly":{"2022":[210],"2023":[280]}},"price":{"hourly":{"2023-05-19":[1.0662691324669897,1.4149087911166427,1.5929422782917597,0.9345963926673087,1.6166558792649472,0.858458208425969,1.638758224351156,1.030773872910962,1.3279917589747376,0.9284893215561612,1.35883698645274,1.605877865659719,1.7309461610290278,1.0749998965908343,1.4352497772756507,0.8944104678104767,1.1314919529684038,1.6445291152334418,1.2762045208793937,1.2560761870493795,1.301984886235861,1.4908457794999697,1.2600443241412211,1.7061880893832782],"2023-05-20":[1.750883606306501,1.4905443263100304,1.4110075163922988,1.0409749288041148,1.047454037569149,1.6196383489864976,1.2268622551870967,0.8997561355724408,0.80641888691502,1.5641318174145575,1.727708895515399,1.0471193679767161,1.4694843339198014,1.5385528269096929,1.5117683859403286,1.1040872637087715,1.1674908509968271,0.8800577857596693,0.8687598435553925,1.0865350812381986,0.8638381351664695,1.2114972145214686,1.5699956880367516,1.6055368106296455],"2023-05-21":[1.3304172099284068,1.372688990385425,1.793929631395062,1.703828413664243,1.2928630654095272,1.5305878560717168,0.8721223733924118,1.4567550986502011,0.9680922949478659,1.5630987750347387,1.725699869253737,1.2344410629544655,0.9632635685520026,1.4450417168840233,1.1865573059123116,0.9220973125861125,0.8981655675042025,1.6157744613860183,0.9110904696223173,1.097094326266886,1.6087879736809338,1.1604595325075424,1.2471195206552559,1.0220067348503061],"2023-05-22":[1.4515069409999461,1.1441240240521773,1.1002343104401389,1.17381746036426,1.429105747888693,1.1200246689132536,1.6238490616438372,1.274326235147653,1.1928149933039855,1.3499080309631262,1.0712852664899057,1.065785116211327,1.6546042319053016,1.2599636984388003,1.2557979996283102,0.8755377979963164,1.5332498463967288,1.2563958158868083,1.154806261911898,1.4663538048415476,0.8117748250111395,1.7645664081294998,1.6825991140157397,1.5652134996928244],"2023-05-23":[0.8700744182652194,0.9874037852776735,1.2085208112004846,1.200152324061981,1.0791088631790378,0.8940867379576282,1.7352784014894356,0.8312077037310528,0.8639957851777332,1.2859855605942418,1.5491995512757253,1.2970356200509643,1.6853088156877067,0.9179702221645467,1.4044223769522208,0.8622689942055989,1.6498678847907242,1.1822798766453648,1.1421594935495833,1.4659426445334394,1.7326548051500947,1.7191083654709698,1.3103469161151886,1.2234123653560236],"2023-05-24":[1.2630041795121638,1.6851306071367471,0.8186574106857942,1.692860409184305,1.659737217773677,1.763226821665749,1.0609280938500891,1.3579011814876845,1.2480995157167771,1.4648078569772953,1.782223609056088,0.9102058496455271,1.5972784078801352,0.815455305903199,1.624242897637707,1.15824838964722,1.114200157623366,1.3672733756388444,1.3108749927652337,0.9780197403192032,1.3183919174679781,1.2568931771264045,1.1976296936179993,0.9129446153565912],"2023-05-25":[1.1521255568600937,1.016067401288153,0.915243331171117,1.6125250794588128,1.2193259480544956,0.9586224913277217,1.1345625825738919,1.6062746629485547,1.7794387400271507,1.07317122843264,1.6285856304991893,1.6299837666343633,1.398454645824121,0.9609100682196033,0.8027194786350997,1.0701194321851273,1.7702630621655306,1.5357478101981452,1.49143184098669,0.9255042234352169,0.816735009404274,1.6290303015906393,1.288304162386806,0.9354296375594956],"2023-05-26":[0.8641545759297387,1.737843793095097,0.8427627165543826,1.1220487197781268,1.3557484149535481,1.0117500221411055,1.0817878023691838,1.5019452427650162]},"daily":{"2023-04":[1.2844148041288765,1.2561305962697935,1.3219336111144557,1.3243793186286277,1.3092481630496275,1.3298184070051626,1.2884270721537245,1.3863888723716367,1.3384462115777696,1.1531943275358103,1.2283759297072636,1.2911976043315578,1.2826296183438295,1.3205977076305213,1.2173309318245036,1.2838250571319318,1.3963756338872404,1.2493666365638203,1.3336275595352127,1.2675807926018707,1.324931515401018,1.2885679565662562,1.268153740213171,1.2386596654468478,1.310070280473155,1.382569712507127,1.2921377014801831,1.3042346198123747,1.350961917686871,1.3642030181338891],"2023-05":[1.343595278655427,1.3563057096626208,1.1909774257911367,1.3341161371877999,1.3338873958461333,1.2739778874561545,1.2875371214402151,1.3062685805222738,1.2628221029101572,1.3409044741811096,1.3177001400827628,1.396542327407772,1.3248718786622484,1.3608687940861248,1.218339419062896,1.2711947137997919,1.3225641719460857,1.243360506052576,1.3157304112598347,1.271254347638868,1.2884159638123214,1.303235215011384,1.2540746801201101,1.3065931426531574,1.264607337161122,1.1897551609482748]},"monthly":{"2022":[null,null,null,null,null,null,null,null,null,1.2908389713363846,1.2878762382340203,1.3019216651663514],"2023":[1.2962091429349742,1.2979210767445313,1.2991582375710586,1.2995926327704708,1.2953653970522447]},"yearly":{"2022":[1.2935456249122521],"2023":[1.2976492974146558]}},"pricePoints":{"hourly":{"2023-05-19":[2,4,2,0,4,4,4,1,4,4,3,0,3,3,0,2,4,0,3,4,3,4,4,2],"2023-05-20":[3,4,2,4,0,3,4,0,3,2,2,2,0,1,3,0,2,0,1,0,2,1,3,4],"2023-05-21":[0,1,3,1,2,1,4,2,1,3,0,3,4,4,4,4,0,1,4,3,3,3,2,1],"2023-05-22":[1,3,0,3,2,0,1,1,4,1,3,3,3,0,1,0,3,1,1,1,2,0,4,1],"2023-05-23":[3,2,0,1,3,4,4,2,0,4,3,2,3,2,1,4,1,0,2,1,0,0,0,0],"2023-05-24":[1,1,1,4,2,3,3,1,2,1,0,1,4,2,0,3,3,1,3,1,4,0,0,0],"2023-05-25":[2,2,0,0,3,4,0,2,4,4,3,4,3,3,0,2,3,3,2,3,2,2,1,0],"2023-05-26":[0,1,3,1,4,1,0,0]},"daily":{"2023-04":[[4,11,4,3,2],[4,4,6,5,5],[5,4,5,4,6],[4,6,8,4,2],[4,7,2,6,5],[8,3,5,4,4],[4,5,7,6,2],[5,3,8,1,7],[2,6,6,6,4],[5,4,4,8,3],[7,5,4,4,4],[4,5,4,8,3],[7,0,4,7,6],[4,4,7,4,5],[1,11,5,3,4],[2,4,7,9,2],[4,7,5,5,3],[1,9,3,5,6],[6,4,2,5,7],[9,2,3,5,5],[5,6,2,7,4],[7,1,8,5,3],[5,5,7,4,3],[4,6,5,3,6],[7,6,3,4,4],[6,8,3,5,2],[6,5,4,6,3],[3,3,8,2,8],[6,5,4,3,6],[3,4,6,7,4]],"2023-05":[[3,4,6,6,5],[3,3,6,5,7],[4,4,5,6,5],[8,3,4,5,4],[4,5,3,4,8],[9,3,7,1,4],[6,4,2,4,8],[4,4,4,6,6],[7,3,5,6,3],[4,6,6,3,5],[3,6,5,5,5],[2,4,8,5,5],[7,5,7,3,2],[2,6,5,6,5],[6,3,5,2,8],[7,3,10,2,2],[1,3,5,6,9],[6,6,5,2,5],[4,1,4,5,10],[6,3,6,5,4],[3,6,3,6,6],[5,9,2,6,2],[7,4,5,4,4],[5,8,3,5,3],[5,1,7,7,4],[3,3,0,1,1]]},"monthly":{"2022":[null,null,null,null,null,null,null,null,null,[4,12,12,13,8],[129,140,138,167,146],[158,152,154,132,148]],"2023":[[139,122,158,178,147],[141,120,137,134,140],[148,146,147,156,146],[142,153,149,148,128],[124,110,128,116,130]]},"yearly":{"2022":[[291,304,304,312,302]],"2023":[[694,651,719,732,691]]}},"overShootAvoided":{"hourly":{"2023-05-19":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-20":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-21":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-22":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-23":[1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-24":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-25":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"2023-05-26":[1,1,1,1,1,1,1,1]},"daily":{"2023-04":[true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true],"2023-05":[true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true]},"monthly":{"2022":[null,null,null,null,null,null,null,null,null,true,true,true],"2023":[true,true,true,true,true]},"yearly":{"2022":[true],"2023":[true]}}}';
    if (JSON.stringify(archive) !== expected) {
      throw new Error('Stored archive was not equal to expected archive');
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testIssue63() {
  console.log('[......] Test Github issue #63: Incorrect price points');
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await app.onInit();
    await applyBasicConfig(app);
    const futurePriceOptions = app.homey.settings.get('futurePriceOptions');
    futurePriceOptions.minCheapTime = 0;
    futurePriceOptions.minExpensiveTime = 0;
    futurePriceOptions.averageTimePast = 7 * 24;
    futurePriceOptions.averageTimeFuture = 0;
    futurePriceOptions.dirtCheapPriceModifier = -40;
    futurePriceOptions.lowPriceModifier = -10;
    futurePriceOptions.highPriceModifier = 10;
    futurePriceOptions.extremePriceModifier = 75;
    app.homey.settings.set('futurePriceOptions', futurePriceOptions);
    app.__all_prices = [];

    app.__current_prices = [
      0.82449, 0.785, 0.7905, 0.7597, 0.79843,
      0.82755, 0.93614, 0.9412499999999999, 1.01728, 1.10979,
      1.21444, 1.17854, 1.1945000000000001, 1.04219, 1.01933,
      1.0253299999999999, 1.0542, 1.1934900000000002, 1.1907999999999999, 1.08615,
      1.0114, 0.90061, 0.84404, 0.74514];
    const CorrectPP = [4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4];
    app.homey.settings.set('averagePrice', 1.66);

    const now = roundToStartOfDay(new Date(1666396747401), app.homey);
    for (let i = 0; i < app.__current_prices.length; i++) {
      const newPrice = { time: (now.getTime() / 1000) + (i * 60 * 60), price: app.__current_prices[i] };
      app.__all_prices.push(newPrice);
    }

    for (let hour = 0; hour < 24; hour++) {
      const curTime = new Date(now.getTime());
      const lastHourTime = new Date(now.getTime());
      curTime.setHours(now.getHours() + hour, 0, 0, 0);
      lastHourTime.setHours(now.getHours() + hour, -1, 0, 0);
      await app.onNewSlot(curTime, lastHourTime);
      if (app.__current_price_index !== hour) throw new Error('Current hour is not calculated correctly');
      if (app.homey.settings.get('pricePoint') !== CorrectPP[hour]) throw new Error(`Invalid Price point at hour ${hour}`);
      /* const ppNames = ['Billig', 'Normal', 'Dyrt', 'Kjempedyrt', 'Veldig billig'];
      const avgPrice = +app.homey.settings.get('averagePrice');
      console.log(`${String(hour).padStart(2, '0')}:00 Price: ${app.__current_prices[hour].toFixed(2)}, avg: ${avgPrice.toFixed(2)} `
        + `(${ppNames[app.homey.settings.get('pricePoint')].padStart(13, ' ')} vs. ${ppNames[CorrectPP[hour]].padStart(13, ' ')})`); */
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Test that all devices does power on in after a zone is enabled again
 */
async function testPowerOnAll() {
  console.log('[......] Test Power On after Failure');
  const stateDump = 'testing/states/Anders_0.18.31_err.txt';
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await app.onInit();
    app.setLogLevel(c.LOG_DEBUG);
    await disableTimers(app);
    await applyStateFromFile(app, stateDump);
    const devices = await getAllDeviceId(app);
    await app.onZoneUpdate({ name: 'Zone 1', id: '5a54cb5a-0628-49d3-be36-6f0a29a5e954' }, true);
    await app.onZoneUpdate({ name: 'Zone 2', id: '630d051c-ad8d-47b8-b2e2-1b8dc9e2c2f2' }, true);
    // Test that all devices are on
    for (let i = 0; i < devices.length; i++) {
      const deviceId = devices[i];
      const device = await app.getDevice(deviceId);
      const isOn = await app.getIsOn(device, deviceId);
      if (app.__deviceList[deviceId].use && !isOn) throw new Error(`Device is still off: ${deviceId}`);
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Github issue #84
 */
async function testIssue84() {
  console.log('[......] Test Github issue #84: AC maintanance button');
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await app.onInit();
    await applyBasicConfig(app);

    await app.filterChangeAC();
    const override = app.homey.settings.get('override');
    if (Object.keys(override).length !== 2) {
      throw new Error(`Override AC devices did not work: ${JSON.stringify(override)}`);
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Github issue #87
 */
async function testIssue83And87() {
  console.log('[......] Test Github issue #83 and #87: Incorrect temperature');
  const stateDump = 'testing/states/Frode_0.19.4_bug87.txt';
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await applyStateFromFile(app, stateDump, false);
    const curTime = new Date('2022-11-19T01:35:58.824Z'); // app.__current_power_time
    await app.onInit(curTime);
    await disableTimers(app);
    app.setLogLevel(c.LOG_DEBUG);
    const devices = await getAllDeviceId(app);

    // Simulate time going forward
    for (let i = 0; i < 20; i++) {
      curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
      await app.onPowerUpdate(0, curTime);
      await app.onProcessPower(curTime);
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
    let confirmedNum = 0;
    for (let i = 0; i < devices.length; i++) {
      const deviceId = devices[i];
      const device = await app.getDevice(deviceId);
      if (device.capabilities.includes(app.getTempSetCap())) {
        const actualTemp = device.capabilitiesObj[app.getTempSetCap()].value;
        if (actualTemp === rightTemp[deviceId]) {
          confirmedNum++;
        } else {
          throw new Error(`Incorrect temperature for device ${deviceId}: ${actualTemp} !== ${rightTemp[deviceId]}`);
        }
      }
    }
    if (confirmedNum !== Object.keys(rightTemp).length) {
      throw new Error(`Could only validate ${confirmedNum} of ${Object.keys(rightTemp).length} temperatures`);
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Github ticket #88
 */
async function testTicket88() {
  console.log('[......] Test Github ticket #88: Override controlled');
  const curTime = new Date('October 1, 2022, 00:59:50 GMT+2:00');
  const stateDump = 'testing/states/Frode_0.19.7_ticket88.txt';
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await applyStateFromFile(app, stateDump);
    await app.onInit(curTime);
    await app.createDeviceList(); // Rebuild __current_state
    app.setLogLevel(c.LOG_DEBUG);
    await disableTimers(app);
    const devices = await getAllDeviceId(app);

    for (let times = 0; times < 2; times++) {
      // First run a little with insane power to turn everything off
      for (let i = 0; i < 10; i++) {
        curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
        try {
          await app.onPowerUpdate(7000, curTime);
          await app.onProcessPower(curTime);
        } catch (err) {}
      }
      // Test that all devices are off
      for (let i = 0; i < devices.length; i++) {
        const deviceId = devices[i];
        const device = await app.getDevice(deviceId);
        const isOn = await app.getIsOn(device, deviceId);
        if (app.__deviceList[deviceId].use && isOn) throw new Error(`Device is still on: ${deviceId}`);
      }
      curTime.setTime(curTime.getTime() + Math.round(10 * 60000));
      await app.onPowerUpdate(0, curTime);
      await app.onProcessPower(curTime);
      curTime.setTime(curTime.getTime() + Math.round(10 * 60000));
      // Run some more to turn everything on again
      for (let i = 0; i < 10; i++) {
        curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
        await app.onPowerUpdate(0, curTime);
        await app.onProcessPower(curTime);
      }
      // Test that all devices are on
      for (let i = 0; i < devices.length; i++) {
        const deviceId = devices[i];
        const device = await app.getDevice(deviceId);
        const isOn = await app.getIsOn(device, deviceId);
        if (app.__deviceList[deviceId].use && !isOn) throw new Error(`Device is still off: ${deviceId}`);
      }
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * @param {*} stateDump The state dump to start simulating from
 * @param {*} simTime Number of secconds of simulation time
 */
async function testState(stateDump, simTime) {
  console.log(`[......] State "${stateDump}"`);
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await app.onInit();
    app.setLogLevel(c.LOG_DEBUG);
    await disableTimers(app);
    await applyStateFromFile(app, stateDump);
    const devices = await getAllDeviceId(app);
    await writePowerStatus(app, devices);
    // Simulate time going forward
    const curTime = app.__current_power_time;
    const startTime = new Date(curTime.getTime());
    while ((curTime.getTime() - startTime.getTime()) / 1000 < simTime) {
      curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
      const curPower = Math.round(1000 + Math.random() * 3000);
      await app.onPowerUpdate(curPower, curTime);
      await app.onProcessPower(curTime);
      await writePowerStatus(app, devices);
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test OnNewSlot
async function testTicket115() {
  const seed = 5;
  const myrng = seedrandom(`mySeed${seed}`);
  console.log('[......] Test Github ticket #115: Main fuse');
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await applyStateFromFile(app, 'testing/states/Frode_0.19.4_bug87.txt');
    app.homey.settings.set('toggleTime', 1);
    app.__deviceList = undefined;
    await app.onInit();
    const futurePriceOptions = app.homey.settings.get('futurePriceOptions');
    futurePriceOptions.priceKind = c.PRICE_KIND_FIXED; // Turn off entsoe API price fetching
    app.homey.settings.set('futurePriceOptions', futurePriceOptions);

    // Just load some random devices
    app.setLogLevel(c.LOG_DEBUG);
    await disableTimers(app);
    const devices = await getAllDeviceId(app);
    // await writePowerStatus(app, devices);

    app.homey.settings.set('maxPower', [Infinity, 10000, Infinity, Infinity]);

    // Simulate time going forward
    const curTime = app.__current_power_time;
    curTime.setUTCMinutes(2);
    for (let sim = 0; sim < 2; sim++) {
      let mainFuse;
      let simTime;
      if (sim === 0) {
        mainFuse = 9;
        simTime = 400;
      } else {
        mainFuse = 63;
        simTime = 1600;
      }
      app.homey.settings.set('mainFuse', mainFuse);
      const startTime = new Date(curTime.getTime());
      while ((curTime.getTime() - startTime.getTime()) / 1000 < simTime) {
        curTime.setTime(curTime.getTime() + Math.round(10000 + myrng() * 5000 - 2500));
        const curPower = Math.round(1000 + myrng() * 5000);
        await app.onPowerUpdate(curPower, curTime);
        await app.onProcessPower(curTime);
        // await writePowerStatus(app, devices);
        // console.log(`curTime : ${sim} : ${curTime}`);
      }
      // Count devices on
      let numDev = 0;
      let numOn = 0;
      for (let i = 0; i < devices.length; i++) {
        const deviceId = devices[i];
        const device = await app.getDevice(deviceId);
        const isOn = await app.getIsOn(device, deviceId);
        if (app.__deviceList[deviceId].use) {
          numDev++;
          numOn += isOn;
        }
      }
      if (sim === 0) {
        // Check all off
        if (numOn !== 0) throw new Error(`All devices should be off, but only ${8 - numOn}/8 are`);
      } else if (sim === 1) {
        // Check all on
        if ((numDev !== 14) || (numOn !== 8)) throw new Error(`All devices should be on, but only ${numOn}/8 are`);
      }
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testAppRestart() {
  console.log('[......] Test App restart');
  const now = new Date('October 1, 2022, 00:59:50 GMT+2:00');
  const app = new PiggyBank();
  try {
    await app.disableLog();

    // Load initial state from a file
    await applyStateFromFile(app, 'testing/states/Frode_0.19.26.txt', false);
    // Set up some state for safe shutdown
    app.homey.settings.set('safeShutdown__accum_energy', [0, 10, 0, 0]);
    app.homey.settings.set('safeShutdown__current_power', 360000);
    app.homey.settings.set('safeShutdown__current_power_time', new Date(now.getTime() - 1000 * 60 * 2)); // => __accum_since (start of hour)
    app.homey.settings.set('safeShutdown__power_last_hour', 5023);
    app.homey.settings.set('safeShutdown__offeredEnergy', 0);

    await app.onInit(now);
    await disableTimers(app);
    const updateTime = new Date(now.getTime() + 1000 * 11 + 100);
    await app.onPowerUpdate(4000, updateTime);
    const accumData = [...app.__pendingOnNewSlot][0];
    await app.onProcessPower(updateTime);
    const actualHourEnergy = app.__accum_energy[TIMESPAN.HOUR] + app.__pendingEnergy[TIMESPAN.HOUR];
    if (actualHourEnergy !== 110
      || Math.floor(accumData.accumEnergy) !== 13010) {
      throw new Error(`Accumulated energy at hour crossing was incorrect ${actualHourEnergy} != 110 || ${Math.floor(accumData.accumEnergy)} !== 13010`);
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testMissingPulse() {
  console.log('[......] Test Missing Pulse');
  const now = new Date('October 1, 2022, 00:59:50 GMT+2:00');
  const firstHour = new Date(now.getTime() + 1000 * 10 + 100);
  const app = new PiggyBank();
  try {
    await app.disableLog();

    // Load initial state from a file
    await applyStateFromFile(app, 'testing/states/Frode_0.19.26.txt', false);
    // Clear the archive
    app.homey.settings.set('archive', null);
    app.homey.settings.set('stats_daily_max', null);
    app.homey.settings.set('stats_daily_max_ok', null);
    app.homey.settings.set('stats_daily_max_last_update_time', firstHour);
    app.homey.settings.unset('safeShutdown__accum_energy');
    app.homey.settings.unset('safeShutdown__current_power');
    app.homey.settings.unset('safeShutdown__current_power_time');
    app.homey.settings.unset('safeShutdown__power_last_hour');
    app.homey.settings.unset('safeShutdown__offeredEnergy');
    app.homey.settings.set('maxPower', [Infinity, 10000, Infinity, Infinity]);

    await app.onInit(now);
    app.homey.settings.set('maxAlarmRate', 50);
    await disableTimers(app);
    let updateTime = new Date(now.getTime() + 1000 * 1);
    await app.onPowerUpdate(4000, updateTime);
    await app.onProcessPower(updateTime);
    for (let i = 1; i < (60 * 6 * 3 - 15); i++) {
      updateTime.setTime(now.getTime() + 1000 * 10 * i);
      await app.onPowerUpdate(NaN, updateTime);
      await app.onProcessPower(new Date(updateTime.getTime()));
    }
    updateTime = new Date(firstHour.getTime() + 1000 * 60 * 60 * 3 - 5000);
    await app.onPowerUpdate(4000, updateTime);
    await app.onProcessPower(updateTime);
    updateTime = new Date(firstHour.getTime() + 1000 * 60 * 60 * 4 - 5000);
    await app.onPowerUpdate(4000, updateTime);
    await app.onProcessPower(updateTime);

    // Check archive
    const archive = app.homey.settings.get('archive');
    if (JSON.stringify(archive.dataOk.hourly['2022-10-01']) !== '[0.016666666666666666,0,0,0.016666666666666666]'
      || JSON.stringify(archive.powUsage.hourly['2022-10-01']) !== '[10000,10000,10000,10000]'
      || JSON.stringify(archive.maxPower.hourly['2022-10-01']) !== '[10000,10000,10000,10000]') {
      console.error(JSON.stringify(archive.dataOk.hourly['2022-10-01']));
      console.error(JSON.stringify(archive.powUsage.hourly['2022-10-01']));
      console.error(JSON.stringify(archive.maxPower.hourly['2022-10-01']));
      console.error('---');
      throw new Error('New Hour with missing Power updates does not behave correctly');
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test if the local time is converted correctly (to some degree)
async function testLocalTime() {
  console.log('[......] Test Localtime');
  const app = new PiggyBank();
  await app.disableLog();

  app.homey.clock.setTimezone('Asia/Jakarta');
  const now = new Date('October 1, 2022, 00:59:50 GMT+2:00');
  const lt = toLocalTime(now, app.homey);
  const utc = fromLocalTime(lt, app.homey);
  if (now.getTime() !== utc.getTime()) {
    throw new Error('Local time is not equal when converted from/to');
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Test the currency api
async function testCurrencies() {
  console.log('[......] Test Currencies');
  const app = new PiggyBank();
  const cur = await app.getCurrencies();
  if (!('NOK' in cur)) {
    throw new Error('Currency table is wrong');
  }
  const currencies = await prices.fetchCurrencyTable('', undefined, app.homey);
  if (Object.keys(currencies).length < 41) {
    throw new Error('Too few currencies');
  }
  for (const currency in currencies) {
    const { rate, date, name } = currencies[currency];
    if (rate <= 0) {
      throw new Error(`Currency ${name} (${currency}) has invalid rate: ${rate}`);
    }
    if (currency === 'NOK') continue; // Reference, so never changes
    if (currency === 'RUB') continue; // Not currently being updated
    const curDate = new Date(date);
    const now = new Date();
    const ageDays = (now - curDate) / (1000 * 60 * 60 * 24);
    if (ageDays > 5) {
      throw new Error(`Currency ${name} (${currency}) is too old (${ageDays.toFixed(2)} days : ${date})`);
    }
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

/**
 * Test that no devices that should not be controlled indeed are not controlled
 */
async function testTicket158NotControllingOther() {
  console.log('[......] Test that no uncontrolled devices are being controlled');
  const stateDump = 'testing/states/Frode_0.19.26.txt';
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await applyStateFromFile(app, stateDump);
    await validateModeList(app);
    await app.onInit();
    app.setLogLevel(c.LOG_DEBUG);
    await disableTimers(app);
    const devices = await getAllDeviceId(app);
    // await writePowerStatus(app, devices, ': Initial state', true);
    // Turn off all devices
    await setAllDeviceState(app, devices, false);
    // Disable control of all devices that could be turned on
    app.__deviceList['33fa2e27-a8cb-4e65-87f8-13545305101a'].use = false; // Varmekabler Stue
    app.__deviceList['734fab2d-2c19-4032-8726-d0a40624c3fb'].use = false; // Varmekabler Kjøkken
    app.__deviceList['0a763eab-ffde-4581-af47-58755bbb22ed'].use = false; // Varmekabler Vaskerom
    app.__deviceList['ef2c3457-0a55-4ccd-a943-58de258d07dd'].use = false; // Varmekabler Bad
    app.__deviceList['7e844fe8-3f2e-4206-a849-aa5541883c9b'].use = false; // Varmekabler Indre Gang
    app.__deviceList['1160d771-5a69-445c-add1-3943ccb16d43'].use = false; // Varmekabler Ytre Gang
    app.__deviceList['eb3be21c-bcb2-47b2-9393-eae2d33737dc'].use = false; // Høiax CONNECTED
    app.__deviceList['b4788083-9606-49a2-99d4-9efce7a4656d'].use = false; // Varmepumpe
    app.__deviceList['e44abbf3-58df-448c-bd6b-58986768d3cb'].use = false; // Nanoleaf Trapp
    // Regenerate modeList:
    const modeList = [[], [], [], []];
    app.homey.settings.set('modeList', modeList);
    // Simulate time going forward
    const simTime = 200;
    const curTime = app.__current_power_time;
    const startTime = new Date(curTime.getTime());
    while ((curTime.getTime() - startTime.getTime()) / 1000 < simTime) {
      curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
      const curPower = Math.round(1000 + Math.random() * 3000);
      await app.onPowerUpdate(curPower, curTime);
      await app.onProcessPower(curTime);
      // const maxPower = await app.homey.settings.get('maxPower');
      // await writePowerStatus(app, devices, `: ${curPower} ${maxPower}`);
    }
    // Test that all devices are off
    for (let i = 0; i < 52 /* devices.length */; i++) {
      const deviceId = devices[i];
      const device = await app.getDevice(deviceId);
      const isOn = await app.getIsOn(device, deviceId);
      if (isOn) throw new Error(`Device ${device.name} is on. All devices should be off as they are not controllable`);
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Testing bad devices:
async function testTicket149BadDevices() {
  console.log('[......] Test Bad behaving devices');
  const stateDump = 'testing/states/Frode_0.19.26.txt';
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await applyStateFromFile(app, stateDump);
    app.homey.settings.set('toggleTime', 1);
    app.__deviceList = undefined; // Recreate it in onInit
    const curTime = app.__current_power_time;
    const startTime = new Date(curTime.getTime());
    await app.onInit(startTime);
    app.setLogLevel(c.LOG_DEBUG);
    await disableTimers(app);
    app.homey.settings.set('maxPower', [Infinity, 1000, Infinity, Infinity]);
    await validateModeList(app);
    const devices = await getAllDeviceId(app);
    // Go through the devices and force them to misbehave:
    for (let i = 0; i < devices.length; i++) {
      const device = app.homeyApi.devices.getDevice({ id: devices[i] });
      switch (i) {
        case 28:
        case 31:
          device.setDeviceReliability(0);
          break;
        case 30:
          device.setDeviceReliability(0.05);
          break;
        default:
          device.setDeviceReliability(1);
      }
      app.__deviceList[devices[i]].use = 1;
    }
    // Simulate time going forward
    const simTime = 400;
    while ((curTime.getTime() - startTime.getTime()) / 1000 < simTime) {
      curTime.setTime(curTime.getTime() + Math.round(10000 + Math.random() * 5000 - 2500));
      const curPower = Math.round(1000 + Math.random() * 3000);
      await app.onPowerUpdate(curPower, curTime);
      await app.onProcessPower(curTime);
      // const maxPower = await app.homey.settings.get('maxPower');
      // await writePowerStatus(app, devices, `Maxpower: [${maxPower}]`);
    }
    // Test that all except 2 devices are off
    let numOn = 0;
    for (let i = 0; i < devices.length; i++) {
      const deviceId = devices[i];
      const device = await app.getDevice(deviceId);
      const isOn = await app.getIsOn(device, deviceId);
      // console.log(`Reliability: ${app.__deviceList[deviceId].reliability}`);
      if (isOn) numOn += 1;
    }
    if (numOn !== 2) {
      throw new Error(`Number of devices powered on should be 2 but was ${numOn}. Fix error or increase simulation time.`);
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testBelgiumPowerTariff(numTests) {
  console.log('[......] Test Belgian Power Tariff');
  const app = new PiggyBank();
  try {
    await app.disableLog();
    seedrandom('mySeed', { global: true });

    // Load initial state from a file
    await applyStateFromFile(app, 'testing/states/Belgium_test_0.19.47.txt');
    app.__deviceList = undefined; // Recreate it in onInit
    const startTime = new Date(app.__current_power_time.getTime() - 1000 * 60 * 60 * 24 * 5);
    app.__current_power_time = new Date(startTime.getTime());
    startTime.setMinutes(0, 0, 0);

    // Clear the archive
    app.homey.settings.set('stats_daily_max', null);
    app.homey.settings.set('stats_daily_max_ok', null);
    app.homey.settings.set('stats_daily_max_last_update_time', startTime);
    app.homey.settings.unset('safeShutdown__accum_energy');
    app.homey.settings.unset('safeShutdown__current_power');
    app.homey.settings.unset('safeShutdown__current_power_time');
    app.homey.settings.unset('safeShutdown__power_last_hour');
    app.homey.settings.unset('safeShutdown__offeredEnergy');

    await app.onInit(startTime);
    await disableTimers(app);

    const futurePriceOptions = app.homey.settings.get('futurePriceOptions');
    futurePriceOptions.priceCountry = 'be';
    futurePriceOptions.priceRegion = 0;
    futurePriceOptions.costSchema = 'be';
    futurePriceOptions.gridSteps = false;
    futurePriceOptions.granularity = 15;
    app.homey.settings.set('futurePriceOptions', futurePriceOptions);

    clearArchive(app.homey);

    app.homey.settings.set('maxPower', [2000, Infinity, Infinity, Infinity]);

    let now = new Date(startTime.getTime());
    let testAccum = 0;
    let oldPow = 2000;
    for (let i = 0; i < numTests; i++) {
      const randomTime = Math.round((2 + (Math.random() * 30)) * 1000);
      const randomPow = 300 + (Math.random() * 5000);
      const quarterBefore = Math.floor(now.getHours() * 60 + now.getMinutes() / 15);
      const timeLimit = timeToNextSlot(now, app.granularity);
      const limitedTime = randomTime < timeLimit ? randomTime : timeLimit;
      now = new Date(now.getTime() + randomTime);
      const quarterAfter = Math.floor(now.getHours() * 60 + now.getMinutes() / 15);
      await app.onPowerUpdate(randomPow, now);
      const accumData = [...app.__pendingOnNewSlot][0];
      await app.onProcessPower(now);

      testAccum += (oldPow * limitedTime) / (1000 * 60 * 60);
      if (quarterBefore !== quarterAfter) {
        const marginLow = Math.floor(testAccum * 0.97);
        const marginHigh = Math.ceil(testAccum * 1.03);
        if (!accumData || (accumData.accumEnergy < marginLow) || (accumData.accumEnergy > marginHigh)) {
          throw new Error(`Accumulated energy not within bounds: ${accumData.accumEnergy} not in [${marginLow}, ${marginHigh}]`);
        }
        if (app.__energy_last_slot === undefined) {
          throw new Error('Last hour energy usage is undefined');
        }
        testAccum = (oldPow * (randomTime - limitedTime)) / (1000 * 60 * 60);
      }
      oldPow = randomPow;
    }

    // Check archive
    const archive = app.homey.settings.get('archive');
    // eslint-disable-next-line max-len
    if (JSON.stringify(archive.powUsage) !== '{"quarter":{"2023-02-12":[null,null,null,null,null,null,null,null,null,null,null,null,650,637,745,737,710,713,616,627,647,766,653,670,733,650,745,684,687,660,658,706,655,768,581,748,696,653,760,592,749,723,685,644,698,769,793,722,778,695,654,716,755,693,638,682,687,796,806,722,710,637,771,594,755,705,730,659,675,696,814,757,730,705,793,811,710,641,738,607,724,712,766,759,706,562,692,661,751,743,806,691,731,578,656,691],"2023-02-13":[670,679,692,694,751,682,651,731,621,669,710,585,742,748,763,675,718,755,729,660,663,743,646,645,696,753,778,824,632,623,700,761,597,794,704,761,686,685,668,682,747,774,657,669,745,761,683,776,574,676,720,730,762,645,676,786,694,675,702,697,730,743,806,693,683,666,634,676,772,672,851,669,725,726,726,660,710,775,728,734,664,641,651,699,689,756,712,707,734,620,678,701,722,733,646,638],"2023-02-14":[812,683,713,701,675,631,720,748,768]},"daily":{"2023-02":[null,null,null,null,null,null,null,null,null,null,null,59019,67485,6451]},"monthly":{"2023":[null,132955]},"yearly":{"2023":[132955]}}') {
      console.log(JSON.stringify(archive.powUsage));
      throw new Error('Belgian Power tariff does not behave correctly');
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testLimiters() {
  console.log('[......] Test Power limitations');
  const app = new PiggyBank();
  try {
    await app.disableLog();
    seedrandom('mySeed', { global: true });

    // Load initial state from a file
    await applyStateFromFile(app, 'testing/states/Belgium_test_0.19.47.txt');
    app.__deviceList = undefined; // Recreate it in onInit
    const startTime = new Date(app.__current_power_time.getTime() - 1000 * 60 * 60 * 24 * 5);
    app.__current_power_time = new Date(startTime.getTime());
    startTime.setMinutes(0, 0, 0);

    // Clear the archive
    app.homey.settings.set('stats_daily_max', null);
    app.homey.settings.set('stats_daily_max_ok', null);
    app.homey.settings.set('stats_daily_max_last_update_time', startTime);
    app.homey.settings.unset('safeShutdown__accum_energy');
    app.homey.settings.unset('safeShutdown__current_power');
    app.homey.settings.unset('safeShutdown__current_power_time');
    app.homey.settings.unset('safeShutdown__power_last_hour');
    app.homey.settings.unset('safeShutdown__offeredEnergy');

    await app.onInit(startTime);
    await disableTimers(app);

    const futurePriceOptions = app.homey.settings.get('futurePriceOptions');
    futurePriceOptions.priceCountry = 'be';
    futurePriceOptions.priceRegion = 0;
    futurePriceOptions.costSchema = 'be';
    futurePriceOptions.gridSteps = false;
    futurePriceOptions.granularity = 15;
    futurePriceOptions.priceKind = c.PRICE_KIND_FIXED; // Turn off entsoe API price fetching
    app.homey.settings.set('futurePriceOptions', futurePriceOptions);

    const limitsToTest = [300, 3000, 8000, 2000000];
    const lowerLimit   = [250, 2500, 7500, 1850000];
    const timeSteps    = [1000, 1000, 8000, 600000];
    const timeLimit    = [6 * 60 * 4, 6 * 60 * 4, 6 * 60 * 6, 6 * 60 * 3];

    for (let limit = 0; limit < 4; limit++) {
      const newLimits = [Infinity, Infinity, Infinity, Infinity];
      newLimits[limit] = limitsToTest[limit];
      app.homey.settings.set('maxPower', newLimits);
      app.__accum_energy[limit] = 0;
      app.__pendingEnergy[limit] = 0;

      // console.log(`LIMITS: ${app.homey.settings.get('maxPower')}`);

      clearArchive(app.homey);
      let now = new Date(startTime.getTime());
      app.__current_power_time = now;
      app.__last_power_off_time = now;
      app.__last_power_on_time = now;

      let observedMax = 0;
      const numDevices = Object.keys(app.homey.settings.get('frostList')).length;
      for (let i = 0; i < timeLimit[limit]; i++) {
        const randomTime = Math.round((5 + (Math.random() * 10)) * timeSteps[limit]); // average 10 sec
        const numOnDevices = numDevices - app.__num_off_devices;
        const randomPow = 300 + 500 * numOnDevices;
        //if (limit > 0) {
        //  console.log(`${now} on: ${numOnDevices} pow: ${randomPow}, ${app.__accum_energy}`);
        //}
        now = new Date(now.getTime() + randomTime);
        await app.onPowerUpdate(randomPow, now);
        await app.onProcessPower(now);

        const sumEnergy = app.__accum_energy[limit] + app.__pendingEnergy[limit] + app.__fakeEnergy[limit];
        if (observedMax < sumEnergy) {
          observedMax = sumEnergy;
        }
      }
      // console.log(`Observed max: ${observedMax}`);
      if (observedMax > limitsToTest[limit]) {
        throw new Error(`Power did overshoot limit ${limit}: Observed: ${observedMax} >  limit: ${limitsToTest[limit]}`);
      }
      if (observedMax < lowerLimit[limit]) {
        throw new Error(`Power was too low ${limit}: Observed: ${observedMax} <  limit: ${lowerLimit[limit]}`);
      }
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testMeter() {
  console.log('[......] Test Meter Reader');
  const startTime = new Date('October 1, 2022, 00:59:50 GMT+2:00');
  const firstHour = new Date(startTime.getTime() + 1000 * 10);
  const app = new PiggyBank();
  try {
    await app.disableLog();

    // Load initial state from a file
    await applyStateFromFile(app, 'testing/states/Frode_0.19.26.txt', false);
    // Clear the archive
    app.homey.settings.set('archive', null);
    app.homey.settings.set('stats_daily_max', null);
    app.homey.settings.set('stats_daily_max_ok', null);
    app.homey.settings.set('stats_daily_max_last_update_time', firstHour);
    app.homey.settings.unset('safeShutdown__accum_energy');
    app.homey.settings.unset('safeShutdown__current_power');
    app.homey.settings.unset('safeShutdown__current_power_time');
    app.homey.settings.unset('safeShutdown__power_last_hour');
    app.homey.settings.unset('safeShutdown__offeredEnergy');
    app.homey.settings.set('maxPower', [Infinity, 10000, Infinity, Infinity]);

    await app.onInit(startTime);
    await disableTimers(app);
    const futurePriceOptions = app.homey.settings.get('futurePriceOptions');
    futurePriceOptions.priceKind = c.PRICE_KIND_FIXED; // Turn off entsoe API price fetching
    app.homey.settings.set('futurePriceOptions', futurePriceOptions);

    const lastTime = new Date();
    let meterTime = new Date(startTime.getTime() + 1000 * 1);
    const meterPower = 4000;
    let meterValue = (meterPower / 1000) * ((meterTime - startTime) / 3600000);

    await app.onMeterUpdate(meterValue, meterTime);
    await app.onProcessPower(meterTime);
    for (let i = 1; i < (60 * 6 * 3 - 15); i++) {
      lastTime.setTime(meterTime.getTime());
      meterTime.setTime(startTime.getTime() + 1000 * 10 * i);
      meterValue += (meterPower / 1000) * ((meterTime - lastTime) / 3600000);
      await app.onMeterUpdate(meterValue, meterTime);
      await app.onProcessPower(new Date(meterTime.getTime()));
    }
    lastTime.setTime(meterTime.getTime());
    meterTime = new Date(firstHour.getTime() + 1000 * 60 * 60 * 3 - 5000);
    meterValue += (meterPower / 1000) * ((meterTime - lastTime) / 3600000);
    await app.onMeterUpdate(meterValue, meterTime);
    await app.onProcessPower(meterTime);
    lastTime.setTime(meterTime.getTime());
    meterTime = new Date(firstHour.getTime() + 1000 * 60 * 60 * 4);
    meterValue += (meterPower / 1000) * ((meterTime - lastTime) / 3600000);
    await app.onMeterUpdate(meterValue, meterTime);
    await app.onProcessPower(meterTime);

    // Check archive
    const archive = app.homey.settings.get('archive');
    if (JSON.stringify(archive.dataOk.hourly['2022-10-01']) !== '[0.016666666666666666,1,1,1]'
      || JSON.stringify(archive.powUsage.hourly['2022-10-01']) !== '[9975,3989,3989,4000]'
      || JSON.stringify(archive.maxPower.hourly['2022-10-01']) !== '[9975,3989,3989,4000]') {
      console.error(JSON.stringify(archive.dataOk.hourly['2022-10-01']));
      console.error(JSON.stringify(archive.powUsage.hourly['2022-10-01']));
      console.error(JSON.stringify(archive.maxPower.hourly['2022-10-01']));
      console.error('---');
      throw new Error('New Hour with missing Power updates does not behave correctly');
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testMeterWithReset() {
  console.log('[......] Test Meter Reader with reset');
  const startTime = new Date('October 1, 2022, 00:59:50 GMT+2:00');
  const firstHour = new Date(startTime.getTime() + 1000 * 10);
  const app = new PiggyBank();
  try {
    await app.disableLog();

    // Load initial state from a file
    await applyStateFromFile(app, 'testing/states/Frode_0.19.26.txt', false);
    // Clear the archive
    app.homey.settings.set('archive', null);
    app.homey.settings.set('stats_daily_max', null);
    app.homey.settings.set('stats_daily_max_ok', null);
    app.homey.settings.set('stats_daily_max_last_update_time', firstHour);
    app.homey.settings.unset('safeShutdown__accum_energy');
    app.homey.settings.unset('safeShutdown__current_power');
    app.homey.settings.unset('safeShutdown__current_power_time');
    app.homey.settings.unset('safeShutdown__power_last_hour');
    app.homey.settings.unset('safeShutdown__offeredEnergy');
    app.homey.settings.set('maxPower', [Infinity, 10000, Infinity, Infinity]);

    await app.onInit(startTime);
    await disableTimers(app);
    const futurePriceOptions = app.homey.settings.get('futurePriceOptions');
    futurePriceOptions.priceKind = c.PRICE_KIND_FIXED; // Turn off entsoe API price fetching
    app.homey.settings.set('futurePriceOptions', futurePriceOptions);

    const lastTime = new Date();
    let meterTime = new Date(startTime.getTime() + 1000 * 1);
    const meterPower = 4000;
    let meterValue = (meterPower / 1000) * ((meterTime - startTime) / 3600000);

    await app.onMeterUpdate(meterValue, meterTime);
    await app.onProcessPower(meterTime);
    for (let i = 1; i < (60 * 6 * 3 - 15); i++) {
      lastTime.setTime(meterTime.getTime());
      meterTime.setTime(startTime.getTime() + 1000 * 10 * i);
      meterValue += (meterPower / 1000) * ((meterTime - lastTime) / 3600000);
      if (i % 20 === 0) {
        meterValue = 0;
      }
      if ((i < 40) || (i > 100)) {
        await app.onMeterUpdate(meterValue, meterTime);
      }
      await app.onProcessPower(new Date(meterTime.getTime()));
    }
    lastTime.setTime(meterTime.getTime());
    meterTime = new Date(firstHour.getTime() + 1000 * 60 * 60 * 3 - 5000);
    meterValue += (meterPower / 1000) * ((meterTime - lastTime) / 3600000);
    await app.onMeterUpdate(meterValue, meterTime);
    await app.onProcessPower(meterTime);
    lastTime.setTime(meterTime.getTime());
    meterTime = new Date(firstHour.getTime() + 1000 * 60 * 60 * 4);
    meterValue += (meterPower / 1000) * ((meterTime - lastTime) / 3600000);
    await app.onMeterUpdate(meterValue, meterTime);
    await app.onProcessPower(meterTime);

    // Check archive
    const archive = app.homey.settings.get('archive');
    if (JSON.stringify(archive.dataOk.hourly['2022-10-01']) !== '[0.016666666666666666,0.8333333333333334,1,1]'
      || JSON.stringify(archive.powUsage.hourly['2022-10-01']) !== '[9975,5256,4289,4283]'
      || JSON.stringify(archive.maxPower.hourly['2022-10-01']) !== '[9975,5256,4289,4283]') {
      console.error(JSON.stringify(archive.dataOk.hourly['2022-10-01']));
      console.error(JSON.stringify(archive.powUsage.hourly['2022-10-01']));
      console.error(JSON.stringify(archive.maxPower.hourly['2022-10-01']));
      console.error('---');
      throw new Error('New Hour with resetting meter values does not behave correctly');
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testMeterAndPower() {
  console.log('[......] Test Meter and Power');
  const startTime = new Date('October 1, 2022, 00:00:00 GMT+2:00');
  const firstHour = new Date(startTime.getTime() + 1000 * 10 + 100);
  const app = new PiggyBank();
  try {
    await app.disableLog();
    seedrandom('testMeterAndPowerSeed', { global: true });

    // Load initial state from a file
    await applyStateFromFile(app, 'testing/states/Frode_0.19.26.txt', false);
    // Clear the archive
    app.homey.settings.set('archive', null);
    app.homey.settings.set('stats_daily_max', null);
    app.homey.settings.set('stats_daily_max_ok', null);
    app.homey.settings.set('stats_daily_max_last_update_time', firstHour);
    app.homey.settings.unset('safeShutdown__accum_energy');
    app.homey.settings.unset('safeShutdown__current_power');
    app.homey.settings.unset('safeShutdown__current_power_time');
    app.homey.settings.unset('safeShutdown__power_last_hour');
    app.homey.settings.unset('safeShutdown__offeredEnergy');
    app.homey.settings.set('maxPower', [2500, 10000, Infinity, Infinity]);

    await app.onInit(startTime);
    await disableTimers(app);

    const futurePriceOptions = app.homey.settings.get('futurePriceOptions');
    futurePriceOptions.priceCountry = 'be';
    futurePriceOptions.priceRegion = 0;
    futurePriceOptions.costSchema = 'be';
    futurePriceOptions.gridSteps = false;
    futurePriceOptions.granularity = 15;
    futurePriceOptions.priceKind = c.PRICE_KIND_FIXED; // Turn off entsoe API price fetching
    app.homey.settings.set('futurePriceOptions', futurePriceOptions);

    clearArchive(app.homey);

    const meterTime = new Date(startTime.getTime());
    let meterPower = 4000;
    let meterValue = (meterPower / 1000) * ((meterTime - startTime) / 3600000);
    let prevQuarter;
    app.__current_power = meterPower;

    // Queue indices are:
    //   0        : middle-1 | Past
    //   middle              | Current
    //   middle+1 : length-1 | Future
    const queue = [];
    let lastPingTime = new Date(startTime.getTime());
    let lastReported = new Date(startTime.getTime());
    let lastReportedValue = meterValue;
    let lastReportedPower = meterPower;
    let prevSlotValue = 0;
    let prevLastReportedPower = 0;
    let noPowerTime = 0;
    let pendPowerTime = 0;

    // Cases that need to hit:
    let hitMeterPast = 0;
    let hitMeterEqual = 0;
    let hitPowerPast = 0;
    let hitPowerEqual = 0;
    let hitDoubleCross = 0;

    let numErrors = 0;
    let accErrors = 0;
    let maxError = 0;

    let finished = false;
    let i;
    const numDevices = Object.keys(app.homey.settings.get('frostList')).length; // 13
    for (i = 0; !finished; i++) {
      const deltaTime = Math.round((2 + (Math.random() * 30)) * 1000);
      const numOnDevices = numDevices - app.__num_off_devices;
      const randomPow = 300 + 500 * numOnDevices  + (Math.random() * 5000);
      const energyUsed = (meterPower * deltaTime) / 3600000;
      meterTime.setTime(meterTime.getTime() + deltaTime);

      meterPower = Math.floor(randomPow);
      meterValue += energyUsed;

      const powerElem = { meterTime: new Date(meterTime.getTime()), meterPower, meterValue, deltaTime };
      queue.push(powerElem);

      // Dummy power in the end just to reset app logic
      if (queue.length <= 3) {
        await app.onPowerUpdate(powerElem.meterPower, powerElem.meterTime);
        await app.onProcessPower(powerElem.meterTime);
        prevQuarter = Math.floor((powerElem.meterTime.getHours() * 60 + powerElem.meterTime.getMinutes()) / futurePriceOptions.granularity);
      }

      // Report Power / Meter values a bit delayed
      if (queue.length >= 7) {
        const queueCenter = Math.floor(queue.length / 2);
        const centerTime = queue[queueCenter].meterTime;
        if (Math.random() < 0.1) {
          // 10% chance Meter was reported
          const reportIdx = Math.floor(Math.random() * queue.length);
          const newReport = queue[reportIdx];
          noPowerTime += pendPowerTime;
          pendPowerTime = 0;
          if (!newReport.reported) {
            await app.onMeterUpdate(newReport.meterValue / 1000, newReport.meterTime);
            if (newReport.meterTime > lastReported) {
              lastReported = newReport.meterTime;
              lastPingTime = lastReported;
              prevLastReportedPower = lastReportedPower;
              lastReportedValue = newReport.meterValue;
              lastReportedPower = newReport.meterPower;
            } else if (newReport.meterTime < lastReported) {
              hitMeterPast++;
            } else {
              hitMeterEqual++;
            }
            for (let i = 0; i <= reportIdx; i++) {
              queue[i].reported = true;
            }
            // const est = lastReportedValue - prevSlotValue;
            // const statusString = 'M'.padStart(reportIdx + 1, ' ').padEnd(queue.length, ' ');
            // console.log(`[${statusString}] ${newReport.meterTime} : ${newReport.meterValue} : ${newReport.meterPower} ---> ${est}`);
          }
        }
        const newReport = queue[queueCenter];
        if (Math.random() < 0.9) {
          // 90% Power was reported (else meter was malafunctioning)
          await app.onPowerUpdate(newReport.meterPower, newReport.meterTime);
          if (newReport.meterTime > lastReported) {
            lastReported = newReport.meterTime;
            lastPingTime = lastReported;
            prevLastReportedPower = lastReportedPower;
            lastReportedValue = newReport.meterValue;
            lastReportedPower = newReport.meterPower;
          } else if (newReport.meterTime < lastReported) {
            pendPowerTime += queue[queueCenter].deltaTime;
            hitPowerPast++;
          } else {
            hitPowerEqual++;
          }
          // const est = newReport.meterValue - prevSlotValue;
          // const statusString = 'P'.padStart(queueCenter + 1, ' ').padEnd(queue.length, ' ');
          // console.log(`[${statusString}] ${newReport.meterTime} : ${newReport.meterValue} : ${newReport.meterPower} ---> ${est}`);
        } else {
          if (newReport.meterTime.getTime() > (lastReported.getTime() + 60000)) {
            lastPingTime = newReport.meterTime; // Need to ignore NaN power if within 1 minute
          }
          await app.onPowerUpdate(NaN, newReport.meterTime);
          pendPowerTime += queue[queueCenter].deltaTime;
        }
        queue.splice(0, 1);

        // Check for hour crossings
        const nextQuarter = Math.floor((lastPingTime.getHours() * 60 + lastPingTime.getMinutes()) / futurePriceOptions.granularity);
        const accumData = [...app.__pendingOnNewSlot][0];
        if (prevQuarter !== nextQuarter) {
          noPowerTime += pendPowerTime;
          const lastOvershoot = (prevLastReportedPower * timeSinceLastSlot(lastPingTime, futurePriceOptions.granularity)) / 3600000;
          const notReported = lastReportedPower * ((lastPingTime - lastReported) / 3600000);
          const estimateMeter = lastReportedValue + notReported - prevSlotValue - lastOvershoot;
          const noPowerError = /* noPowerTime / (futurePriceOptions.granularity * 60 * 1000); */ (noPowerTime / 3600000) * app.homey.settings.get('maxPower')[TIMESPAN.HOUR];
          const marginLow = /*Math.floor(estimateMeter * 0.95 * (1 / (1 + noPowerError))); */ Math.max(Math.floor(estimateMeter * 0.93 - noPowerError), 0);
          let marginHigh = /*Math.ceil(estimateMeter * 1.05 * (1 + noPowerError)); */ Math.ceil(estimateMeter * 1.06 + noPowerError);
          if (marginHigh > app.homey.settings.get('maxPower')[TIMESPAN.QUARTER]) {
            marginHigh = app.homey.settings.get('maxPower')[TIMESPAN.QUARTER];
          }
          prevSlotValue = lastReportedValue + notReported - lastOvershoot;
          if (!accumData) {
            throw new Error(`New slot was not detected between ${prevQuarter} -> ${nextQuarter} : ${lastReported}`);
          }
          if (Number.isNaN(accumData.accumEnergy)) {
            throw new Error('The accumulated energy is NaN');
          }
          // console.log(`NewHour: ${accumData.accumEnergy} [${String(marginLow).padStart(5, ' ')},${String(marginHigh).padStart(5, ' ')}] Meter:${String(Math.floor(lastReportedValue)).padStart(6, ' ')} : ${Math.floor(noPowerTime/60000)} : ${Math.floor(noPowerError)}`)
          const err = Math.abs(1 - accumData.accumEnergy / estimateMeter);
          numErrors++;
          accErrors += err;
          maxError = Math.max(maxError, err);
          if ((accumData.accumEnergy < marginLow) || (accumData.accumEnergy > marginHigh)) {
            throw new Error(`Accumulated energy not within bounds: ${accumData.accumEnergy} not in [${marginLow}, ${marginHigh}] | err: ${noPowerError}`);
          // } else {
          //   console.log(`OK: ${accumData.accumEnergy} in [${marginLow}, ${marginHigh}]`)
          }
          if (app.__energy_last_slot === undefined) {
            throw new Error('Last hour energy usage is undefined');
          }
          prevQuarter = nextQuarter;
          if (lastReported > centerTime) {
            hitDoubleCross++;
          }
          noPowerTime = 0;
          pendPowerTime = 0;
          lastReported = lastPingTime; // Make sure we don't try to validate going from next to previous hour
        } else if (accumData) {
          throw new Error(`New slot ${accumData.accumEnergy} was falsly reported at ${prevQuarter} -> ${nextQuarter} : ${lastReported}`);
        }
        if (lastReported > centerTime) {
          // console.log('future reported');
        }

        // Process power using meterTime... e.g. a bit delayed from power reporting
        await app.onProcessPower(centerTime);

        // Exit condition
      }
      finished = (hitMeterPast > 10)
      && (hitMeterEqual > 10)
      && (hitPowerPast > 10)
      && (hitPowerEqual > 10)
      && (hitDoubleCross > 200);
    }
    // console.log(`${hitMeterPast} : ${hitMeterEqual} : ${hitPowerPast} : ${hitPowerEqual} : ${hitDoubleCross}`)
    const avgErrorPst = Math.floor(10000 * (accErrors / numErrors)) / 100;
    const maxErrorPst = Math.floor(10000 * maxError) / 100;
    if (avgErrorPst >  3) throw new Error(`Average error exceeded limit: ${avgErrorPst}%`);
    if (maxErrorPst > 20) throw new Error(`Maximum error exceeded limit: ${maxErrorPst}%`);
    // console.log(`crossed: ${i} ${finished}: ${hitMeterPast} ${hitMeterEqual} ${hitPowerPast} ${hitPowerEqual} ${hitDoubleCross} Avg. error: ${avgErrorPst}% Max: ${maxErrorPst}%`);
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testLanguages() {
  const languages = ['en', 'no', 'fr', 'nl'];
  for (let langIdx = 0; langIdx < languages.length; langIdx++) {
    console.log(`[......] Test Translations for locales/${languages[langIdx]}.json && README.${languages[langIdx]}.txt`);

    // Check if all files are present:
    const fileReadme = `README.${languages[langIdx]}.txt`;
    const fileLocale = `locales/${languages[langIdx]}.json`;
    if (!fs.existsSync(fileReadme)) throw new Error(`Could not find file ${fileReadme}`);
    if (!fs.existsSync(fileLocale)) throw new Error(`Could not find file ${fileLocale}`);

    // Check if the locale file is out of sync with english
    const localeDataEn = JSON.parse(fs.readFileSync('locales/en.json', { encoding: 'utf8', flag: 'r' }));
    const localeData = JSON.parse(fs.readFileSync(fileLocale, { encoding: 'utf8', flag: 'r' }));
    compareJSON(localeDataEn, localeData);

    console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
  }

  // Test capabilities
  const dirs = [
    'drivers/piggy-bank-insights',
    '.homeycompose',
    '.homeycompose/capabilities',
    '.homeycompose/flow/actions',
    '.homeycompose/flow/conditions',
    '.homeycompose/flow/triggers']
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    const files = fs.readdirSync(dir);
    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const fileName = `${dir}/${files[fileIdx]}`;
      if (!fileName.includes('.json')) continue;
      if (fileName.includes('homeychangelog')) continue;
      console.log(`[......] Test Translations for ${fileName}`);
      const obj = JSON.parse(fs.readFileSync(fileName, { encoding: 'utf8', flag: 'r' }));
      checkForTranslations(obj, languages);
      console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
    }
  }
}

async function testACModes() {
  console.log('[......] Test AC Modes');
  const startTime = new Date('October 1, 2022, 00:59:50 GMT+2:00');
  const firstHour = new Date(startTime.getTime() + 1000 * 10);
  const now = new Date(firstHour.getTime() + 10000);
  const app = new PiggyBank();
  try {
    await app.disableLog();

    // Load initial state from a file
    await applyStateFromFile(app, 'testing/states/Frode_0.19.26.txt', false);
    // Clear the archive
    app.homey.settings.set('archive', null);
    app.homey.settings.set('stats_daily_max', null);
    app.homey.settings.set('stats_daily_max_ok', null);
    app.homey.settings.set('stats_daily_max_last_update_time', firstHour);
    app.homey.settings.unset('safeShutdown__accum_energy');
    app.homey.settings.unset('safeShutdown__current_power');
    app.homey.settings.unset('safeShutdown__current_power_time');
    app.homey.settings.unset('safeShutdown__power_last_hour');
    app.homey.settings.unset('safeShutdown__offeredEnergy');
    app.homey.settings.set('maxPower', [Infinity, 10000, Infinity, Infinity]);

    await app.onInit(startTime);
    await disableTimers(app);

    const deviceId = 'b4788083-9606-49a2-99d4-9efce7a4656d';
    const ACDevice = await app.getDevice(deviceId);
    const tempCap = app.getTempSetCap(ACDevice);

    // Set base temperatures:
    const modeList = app.homey.settings.get('modeList');
    const currentMode = +app.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    const modeIdx = app.findModeIdx(deviceId);
    currentModeList[modeIdx].targetTemp = 20;  // Base
    app.homey.settings.set('modeList', modeList);

    const actionLists = app.homey.settings.get('priceActionList');
    actionLists[c.PP.DIRTCHEAP][deviceId].delta = 2;
    actionLists[c.PP.LOW][deviceId].delta = 1;
    actionLists[c.PP.NORM][deviceId].delta = 0;
    actionLists[c.PP.HIGH][deviceId].delta = -1;
    actionLists[c.PP.EXTREME][deviceId].delta = -2;
    app.homey.settings.set('priceActionList', actionLists);

    // Set to Heating, perform one click and verify temperature
    await app.setACMode(ACDevice, c.ACMODE.HEAT);
    await app.onPowerUpdate(100, now);
    await app.onProcessPower(now);
    now.setTime(startTime.getTime() + 1000000000);
    if (ACDevice.capabilitiesObj[tempCap].value !== 21) throw new Error('Incorrect heating temperature');

    // Set to Cooling, perform one click and verify temperature
    await app.setACMode(ACDevice, c.ACMODE.COOL);
    await app.onPowerUpdate(100, now);
    await app.onProcessPower(now);
    now.setTime(startTime.getTime() + 1000000000);
    if (ACDevice.capabilitiesObj[tempCap].value !== 19) throw new Error('Incorrect cooling temperature');

    // Set to Heating, perform one click and verify temperature
    app.homey.settings.set('ACMode', c.ACMODE.HEAT);
    await app.setOnOff(ACDevice, deviceId, false);
    app.__last_power_on_time = new Date(0);
    await app.onPowerUpdate(100, now);
    await app.onProcessPower(now);
    now.setTime(startTime.getTime() + 1000000000);
    if (app.getACMode(ACDevice) !== c.ACMODE.HEAT) throw new Error('Incorrect AC mode');
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testTicket223PowerAtLoad() {
  console.log('[......] Test Github ticket #223: Energy at load was wrong');
  const curTime = new Date('March 31, 2023, 13:48:11:398 GMT+2:00');
  const stateDump = 'testing/states/Frode_0.20.14.txt';
  const app = new PiggyBank();
  try {
    await app.disableLog();
    await applyStateFromFile(app, stateDump, false);
    app.homey.settings.set('safeShutdown__current_power', 5000);
    await app.onInit(curTime);
    await app.onPowerUpdate(4000, new Date(curTime.getTime()));
    if (JSON.stringify(app.__pendingEnergy) !== '[265.8305555555556,4000,4000,4000]') {
      throw new Error('Pending energy was incorrectly calculated');
    }
  } finally {
    await app.onUninit();
  }
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

// Start all tests
async function startAllTests() {
  try {
    await testLanguages();
    await testCurrencyConverter();
    await testApp();
    await testEntsoe();
    await testNewHour(20000);
    await testCharging();
    await testReliability();
    await testPricePoints();
    await testArchive();
    await testPowerOnAll();
    await testIssue63();
    await testIssue84();
    await testIssue83And87();
    await testTicket88();
    await testTicket115();
    await testAppRestart();
    await testMissingPulse();
    await testLocalTime();
    await testCurrencies();
    await testTicket158NotControllingOther();
    await testTicket149BadDevices();
    await testTicket223PowerAtLoad();
    await testBelgiumPowerTariff(10000);
    await testLimiters();
    await testMeter();
    await testMeterWithReset();
    await testMeterAndPower();
    await testACModes();
    await testMail();
  } catch (err) {
    console.log('\x1b[1A[\x1b[31mFAILED\x1b[0m]');
    console.log(err);
  }
}

// Run all the testing
startAllTests();
// testState('testing/states/Anders_0.18.31_err.txt', 100);
