/* eslint-disable brace-style */
/* eslint-disable node/no-unsupported-features/es-syntax */
/* eslint-disable no-loop-func */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-prototype-builtins */
/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint comma-dangle: ["error", "never"] */

'use strict';

// NOTES:
// * As the Zigbee implementation of Homey is extremely poor when it comes to recovering after a reboot,
//   this app will prevent sending commands to other devices using the Homey api for the first 15 minutes
//   after the app was started unless the commands was user initiated (e.g. by using the setup).
//   This will ensure that the Zigbee driver is not interrupted during the recovery process and as such
//   has a higher get enough time to recover after a reboot.
//   (yes, it has been tested that the Zigbee driver does not recover unless this measure is taken)
let preventZigbee = false;

const Homey = require('homey');
const nodemailer = require('nodemailer');
const os = require('node:os');
const { Log } = require('homey-log');
const { Mutex } = require('async-mutex');
const { HomeyAPIApp } = require('homey-api');
const { resolve } = require('path');
const c = require('./common/constants');
const d = require('./common/devices');
const { addToArchive, cleanArchive, getArchive } = require('./common/archive');
const {
  daysInMonth, toLocalTime, timeDiff, timeSinceLastHour, timeToNextHour, roundToNearestHour, roundToStartOfDay, isSameHour, hoursInDay, fromLocalTime
} = require('./common/homeytime');
const { isNumber, toNumber, combine } = require('./common/tools');
const prices = require('./common/prices');
const { close } = require('node:fs');

const WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MIN = 1 * 60 * 1000; // Wait 1 minute
const WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MAX = 5 * 60 * 1000; // Wait 5 minutes
const TIME_FOR_POWERCYCLE_MIN = 5 * 60 * 1000; // 5 minutes left
const TIME_FOR_POWERCYCLE_MAX = 30 * 60 * 1000; // more than 30 minutes left

const { MAIN_OP, TARGET_OP } = c;

/**
 * PiggyBank Class definition
 */
class PiggyBank extends Homey.App {

  /**
   * Validates the settings
   */
  validateSettings() {
    // this.log('Validating settings.');
    // this.log(`frostList: ${JSON.stringify(this.homey.settings.get('frostList'))}`);
    // this.log(`modeList: ${JSON.stringify(this.homey.settings.get('modeList'))}`);
    // this.log(`priceActionList: ${JSON.stringify(this.homey.settings.get('priceActionList'))}`);
    try {
      if (this.homey.settings.get('operatingMode') === null) return false;
      if (this.homey.settings.get('maxPower') === null) return false;
      const frostList = this.homey.settings.get('frostList');
      const numControlledDevices = Object.keys(frostList).length;
      if (numControlledDevices === 0) return false;
      const modeList = this.homey.settings.get('modeList');
      const actionList = this.homey.settings.get('priceActionList');
      if (modeList.length < 3 || modeList.length > 8
        || actionList.length < 3) return false; // Do not complain about actionList missing for extremely high prices as this could cause older versions of the app to fail
      if (modeList[0].length !== numControlledDevices
        || modeList[1].length !== numControlledDevices
        || modeList[2].length !== numControlledDevices
        || Object.keys(actionList[0]).length !== numControlledDevices
        || Object.keys(actionList[1]).length !== numControlledDevices
        || Object.keys(actionList[2]).length !== numControlledDevices) return false;
    } catch (err) {
      this.updateLog(`Settings has not been saved yet, cannot enable app before it has been properly configured: (${err})`, c.LOG_ERROR);
      return false;
    }
    return true;
  }

  /**
   * getDevice
   * Overloads the getDevice command from the homeyApi because it's unreliable.
   * Should only be used when the capabilitiesObj list is required.
   */
  async getDevice(deviceId) {
    let device = null;
    for (let retries = 10; retries > 0; retries--) {
      device = await this.homeyApi.devices.getDevice({ id: deviceId });
      if (device && device.capabilitiesObj) return device;
      const delay = ms => new Promise(res => setTimeout(res, ms));
      await delay(100); // 0.1 sec
    }
    return device;
  }

  /**
   * Run the initialization commands for adding devices
   * @return true if state was changed for any of the commands, false if no change was requested
   */
  async runDeviceCommands(deviceId, listRef) {
    if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.resolve(false);
    if (!(deviceId in this.__deviceList)) return Promise.reject(new Error('The deviceId to control does not exist'));
    const { driverId } = this.__deviceList[deviceId];
    if (!(driverId in d.DEVICE_CMD)) return Promise.resolve();
    if (!(listRef in d.DEVICE_CMD[driverId])) return Promise.resolve();
    this.updateLog(`Got ${listRef} for ${driverId}`, c.LOG_DEBUG);
    const list = d.DEVICE_CMD[driverId][listRef];
    const device = await this.getDevice(deviceId);
    if (this.logUnit === deviceId) this.updateLog(`attempt runDeviceCommands(${listRef}) for ${device.name}`, c.LOG_ALL);
    let stateChanged = false;
    for (const capName in list) {
      if (device.capabilitiesObj && !(capName in device.capabilitiesObj)) {
        const newErr = new Error(`Could not find the capability ${capName} for ${device.name}. Please install the most recent driver.`);
        this.updateLog(newErr, c.LOG_ALL);
        return Promise.reject(newErr);
      }
      const maxVal = (device.capabilitiesObj === null) ? 32 : await device.capabilitiesObj[capName].max;
      const setVal = (list[capName] === Infinity) ? maxVal : list[capName];
      const prevVal = (device.capabilitiesObj === null) ? undefined : await device.capabilitiesObj[capName].value;
      try {
        if (prevVal !== setVal) {
          stateChanged = true;
          this.updateLog(`Setting capname: ${capName} = ${setVal}`, c.LOG_INFO);
          if (this.logUnit === deviceId) this.updateLog(`Setting Device ${device.name}.${capName} = ${setVal} | Origin from list ${driverId}.${listRef}`, c.LOG_ALL);
          await device.setCapabilityValue({ capabilityId: capName, value: setVal }); // Just pass errors on
        } else if (this.logUnit === deviceId) {
          this.updateLog(`Ignored setting Device ${device.name}.${capName} = ${setVal} as the value is already ${prevVal}`, c.LOG_ALL);
        }
      } catch (err) {
        this.updateLog(`Error: ${err}`, c.LOG_ERROR);
      }
    }
    if (this.logUnit === deviceId) this.updateLog(`finished runDeviceCommands(${listRef}) for ${device.name}`, c.LOG_ALL);
    return Promise.resolve(stateChanged);
  }

  /**
   * onInit is called when the app is initialized.
   */
  async onInit(now = new Date()) {
    this.log('OnInit');
    this.homey.on('unload', () => this.onUninit());

    /* DEBUG_BEGIN
    // Reset settings to simulate fresh device in case of debug
    if (this.homey.app.manifest.id === 'no.sparegris2') {
      this.log('===== DEBUG MODE =====');
      const settings = this.homey.settings.getKeys();
      this.log(`Settings available: ${JSON.stringify(settings)}`);
      // this.log('Deleting all settings...');
      // for (let i = 0; i < settings.length; i++) {
      //   this.homey.settings.unset(settings[i]);
      // }
    }
    DEBUG_END */

    // Logging
    try {
      this.logInit();
    } catch (err) {} // Ignore logging errors, normal users don't care

    await prices.currencyApiInit(this.homey.i18n.getLanguage());
    await prices.entsoeApiInit(Homey.env.ENTSOE_TOKEN);

    // ===== BREAKING CHANGES =====
    // 1 person on 0.10.7 (2022.10.17)
    // 1 person on 0.14.4 (2022.10.17)
    // 1 person on 0.16.0 (2022.10.17)
    // 3 persons on 0.17.14 (2022.10.19)
    // 360 persons on 0.18.6 (2022.10.19)
    // Version 0.10.8 changes from having maxPower per mode to one global setting
    if (Array.isArray(this.homey.settings.get('maxPowerList'))) {
      const maxPowerList = this.homey.settings.get('maxPowerList');
      this.homey.settings.set('maxPower', maxPowerList[0]);
      this.homey.settings.unset('maxPowerList');
      const maxPowerText = `${this.homey.__('breaking.maxPower')} ${maxPowerList[0]} kWh`;
      this.log(maxPowerText);
      this.homey.notifications.createNotification({ excerpt: maxPowerText });
    }
    // Version 0.12.1 : An earlier version added an option to disregard temperature, this should default to 1 or problems arise
    if (this.homey.settings.get('controlTemp') === null) {
      this.homey.settings.set('controlTemp', 1);
    }

    // Version 0.8.15 and 0.14.3: Added new price modes
    const oldPriceActionList = this.homey.settings.get('priceActionList');
    if (oldPriceActionList !== null && oldPriceActionList.length < 5) {
      const cheapActionList = oldPriceActionList[0];
      const normalActionList = oldPriceActionList[1];
      const highActionList = oldPriceActionList[2];
      const extremeActionList = oldPriceActionList[3] || highActionList; // Added in version 0.8.15
      const dirtCheapActionList = oldPriceActionList[4] || cheapActionList; // Added in version 0.14.3
      const newPriceActionList = [cheapActionList, normalActionList, highActionList, extremeActionList, dirtCheapActionList];
      this.homey.settings.set('priceActionList', newPriceActionList);
    }

    // Version 0.12.12 Moved some settings into api commands
    this.homey.settings.unset('logLevel');
    this.homey.settings.unset('showState');
    this.homey.settings.unset('showCaps');
    this.homey.settings.unset('showPriceApi');
    this.homey.settings.unset('diagLog');
    this.homey.settings.unset('sendLog');
    this.homey.settings.unset('charger');

    // Version 0.14.5 Adds custom Modes
    const modeNames = this.homey.settings.get('modeNames');
    const modeList = this.homey.settings.get('modeList');
    if (Array.isArray(modeList) && !Array.isArray(modeNames)) {
      const modeNames = modeList.slice(3, 8).map(x => this.homey.__('settings.opMode.custom'));
      this.homey.settings.set('modeNames', modeNames);
    }

    // Version 0.16.2 removed some settings:
    this.homey.settings.unset('stats_tmp_max_power_today');

    // Version 0.17.0 Added direct support for spot price
    let futureData = this.homey.settings.get('futurePriceOptions');
    const oldPriceKind = !futureData ? undefined : futureData.priceKind;
    if ((+this.homey.settings.get('priceMode') === c.PRICE_MODE_INTERNAL)
      && (oldPriceKind === undefined)) {
      // The old setting was Spot price from external app, keep it that way
      if (!futureData) futureData = {};
      futureData.priceKind = c.PRICE_KIND_EXTERNAL; // The new default is SPOT, just set to EXTERNAL for those that used it
      this.homey.settings.set('futurePriceOptions', futureData);
      this.log('priceKind was set to External for backward compatability');
    }

    // Version 0.18.0 removed chargerOptions.minSwitchTime
    // Also fix the broken history for the last few weeks + notify the user about the incident
    const chargerOptionsRepair = this.homey.settings.get('chargerOptions');
    if (chargerOptionsRepair && 'minSwitchTime' in chargerOptionsRepair) {
      // Deprecate minSwitchTime
      this.log('minSwitchTime has been deprecated and was removed from charger options');
      delete chargerOptionsRepair.minSwitchTime;
      this.homey.settings.set('chargerOptions', chargerOptionsRepair);
      // Remove broken Graph elements
      let dailyMax = this.homey.settings.get('stats_daily_max');
      let dailyMaxOk = this.homey.settings.get('stats_daily_max_ok');
      dailyMax = dailyMax.map((val, index) => (dailyMaxOk[index] ? val : undefined));
      dailyMaxOk = dailyMaxOk.map(val => val || undefined);
      this.homey.settings.set('stats_daily_max', dailyMax);
      this.homey.settings.set('stats_daily_max_ok', dailyMaxOk);
      // Notify the user about the incident
      this.homey.notifications.createNotification({ excerpt: this.homey.__('breaking.fixGraph') });
    }

    // Version 0.18.1 removed {numPhases, chargeMax, chargeMargin, chargeDevice} from chargerOptions
    if (chargerOptionsRepair && 'numPhases' in chargerOptionsRepair) {
      // Set correct value for new values
      chargerOptionsRepair.chargeThreshold = chargerOptionsRepair.chargeMin + chargerOptionsRepair.chargeMargin;
      // Deprecate numPhases, chargeMax, chargeMargin and chargeDevice
      this.log('numPhases, chargeMax, chargeMargin and chargeDevice has been deprecated and was removed from charger options');
      delete chargerOptionsRepair.numPhases;
      delete chargerOptionsRepair.chargeMax;
      delete chargerOptionsRepair.chargeMargin;
      delete chargerOptionsRepair.chargeDevice;
      this.homey.settings.set('chargerOptions', chargerOptionsRepair);
      // Remove broken Graph elements (again)
      let dailyMax = this.homey.settings.get('stats_daily_max');
      let dailyMaxOk = this.homey.settings.get('stats_daily_max_ok');
      dailyMax = dailyMax.map((val, index) => (dailyMaxOk[index] ? val : undefined));
      dailyMaxOk = dailyMaxOk.map(val => val || undefined);
      this.homey.settings.set('stats_daily_max', dailyMax);
      this.homey.settings.set('stats_daily_max_ok', dailyMaxOk);
    }

    // Version 0.18.24 moved stats_daily_max into archive
    let archive = await this.homey.settings.get('archive');
    const maxes = await this.homey.settings.get('stats_daily_max');
    const maxesOk = await this.homey.settings.get('stats_daily_max_ok');
    if (archive === null && maxes !== null) {
      // Add max power
      for (let i = 0; i < maxes.length; i++) {
        if (maxes[i] !== undefined) {
          const data = {
            maxPower: maxes[i],
            dataOk: maxesOk[i]
          };
          const dataTimeStart = new Date('October 1, 2022, 01:00:00 GMT+2:00');
          const dataTime = new Date(dataTimeStart.getTime() + i * 24 * 60 * 60 * 1000);
          await addToArchive(this.homey, data, dataTime, true);
        }
      }

      // Add saved money, month only as per day is missing
      let dataTime = new Date('September 15, 2022, 01:00:00 GMT+2:00');
      let data = {
        moneySavedTariff: +this.homey.settings.get('stats_savings_all_time_power_part') || 0
      };
      await addToArchive(this.homey, data, dataTime, true, true);
      dataTime = new Date('October 15, 2022, 01:00:00 GMT+2:00');
      data = {
        moneySavedUsage: +this.homey.settings.get('stats_savings_all_time_use') || 0
      };
      await addToArchive(this.homey, data, dataTime, true, true);
    }

    // Version 0.18.38 - The minimum toggle time was changed to never come above 90 and a new default was set to 120s
    if (chargerOptionsRepair && ('minToggleTime' in chargerOptionsRepair) && (+chargerOptionsRepair.minToggleTime < 90)) {
      chargerOptionsRepair.minToggleTime = 120;
      this.homey.settings.set('chargerOptions', chargerOptionsRepair);
    }

    // Version 0.18.40
    if (chargerOptionsRepair && ('experimentalMode' in chargerOptionsRepair)) {
      delete chargerOptionsRepair.experimentalMode;
      this.homey.settings.set('chargerOptions', chargerOptionsRepair);
    }

    // Version 0.19.13 - Corrects the Price points in the archive (issue #102)
    const settingsVersion = await this.homey.settings.get('settingsVersion');
    if (+settingsVersion < 1) {
      archive = await this.homey.settings.get('archive');
      if (archive !== null && archive.pricePoints !== undefined) {
        this.log('Fixing broken price point in archive:');
        for (const period in { daily: 1, monthly: 1, yearly: 1 }) {
          this.log(`${period}`);
          if (!(period in archive.pricePoints)) continue;
          for (const time in archive.pricePoints[period]) {
            this.log(`  ${time}`);
            for (const data in archive.pricePoints[period][time]) {
              const oldValues = archive.pricePoints[period][time][data];
              const newSource = period === 'daily' ? archive.pricePoints.hourly[`${time}-${(+data + 1).toString().padStart(2, '0')}`]
                : period === 'monthly' ? archive.pricePoints.daily[`${time}-${(+data + 1).toString().padStart(2, '0')}`]
                  : archive.pricePoints.monthly[time];
              let newValues = [];
              if (newSource) {
                for (let i = 0; i < newSource.length; i++) {
                  if (newSource[i] === null) continue;
                  if (Array.isArray(newSource[i])) {
                    for (let j = newValues.length; j <= newSource[i].length; j++) {
                      newValues[j] = 0;
                    }
                    for (let j = 0; j < newSource[i].length; j++) {
                      newValues[j] += newSource[i][j];
                    }
                  } else {
                    for (let j = newValues.length; j <= newSource[i]; j++) {
                      newValues[j] = 0;
                    }
                    newValues[newSource[i]] += 1;
                  }
                }
              }
              if (newValues.length === 0) newValues = null;
              this.log(`    ${data}: ${oldValues} => ${newValues}  | ${JSON.stringify(newSource)}`);
              archive.pricePoints[period][time][data] = newValues;
            }
          }
        }
        this.homey.settings.set('archive', archive);
      }
      this.homey.settings.set('settingsVersion', 1);
    }

    // Version 0.19.18
    if (+settingsVersion < 2) {
      this.homey.settings.set('crossHourSmooth', 20);
      this.homey.settings.set('settingsVersion', 2);
    }

    // Version 0.19.27
    if (+settingsVersion < 3) {
      // Update the default value of stats history
      const expireDaily = this.homey.settings.get('expireDaily');
      if (!expireDaily || (expireDaily < 62)) this.homey.settings.set('expireDaily', 365);
      const expireHourly = this.homey.settings.get('expireHourly');
      if (!expireHourly || (expireHourly < 31)) this.homey.settings.set('expireHourly', 31);
      // Delete the old statistics as they has been in the archive for a while
      this.homey.settings.unset('stats_daily_max');
      this.homey.settings.unset('stats_daily_max_ok');
      this.homey.settings.unset('stats_this_month_maxes');
      this.homey.settings.unset('stats_this_month_average');
      this.homey.settings.unset('stats_last_month_max');
      this.homey.settings.set('settingsVersion', 3);
    }

    // Internal state that preferably should be removed as it is in the archive
    // this.homey.settings.unset('stats_savings_all_time_use');
    // this.homey.settings.unset('stats_savings_all_time_power_part');

    // ===== BREAKING CHANGES END =====

    // ===== KEEPING STATE ACROSS RESTARTS =====
    this.__accum_energy = toNumber(await this.homey.settings.get('safeShutdown__accum_energy'));
    this.__current_power = toNumber(await this.homey.settings.get('safeShutdown__current_power'));
    this.__current_power_time = new Date(await this.homey.settings.get('safeShutdown__current_power_time')); // When null then date is start of unix time
    this.__power_last_hour = toNumber(await this.homey.settings.get('safeShutdown__power_last_hour'));
    this.__offeredEnergy = toNumber(await this.homey.settings.get('safeShutdown__offeredEnergy'));
    if (((now - this.__current_power_time) > (1000 * 60 * 5))
      || (this.__accum_energy === undefined)) {
      // More than five minutes since safe shutdown, pointless to try to restore state
      this.__accum_energy = 0;
      this.__current_power = undefined;
      this.__current_power_time = new Date(now.getTime());
      this.__power_last_hour = undefined;
      this.__offeredEnergy = 0;
      this.updateLog('No state from previous shutdown? Powerloss, deactivated or forced restart.', c.LOG_ALL);
    } else {
      // We got safe shutdown data, remove the old data
      this.homey.settings.unset('safeShutdown__accum_energy');
      this.homey.settings.unset('safeShutdown__current_power');
      this.homey.settings.unset('safeShutdown__current_power_time');
      this.homey.settings.unset('safeShutdown__power_last_hour');
      this.homey.settings.unset('safeShutdown__offeredEnergy');
      this.updateLog(`Restored state from safe shutdown values ${this.__accum_energy} ${this.__current_power} ${this.__current_power_time} ${this.__power_last_hour}`, c.LOG_ALL);
    }
    this.__accum_since = new Date(this.__current_power_time.getTime());
    this.__accum_since.setMinutes(0, 0, 0);
    // ===== KEEPING STATE ACROSS RESTARTS END =====
    // Initialize missing settings
    if (this.homey.settings.get('crossHourSmooth') === null) {
      this.homey.settings.set('crossHourSmooth', 20);
    }
    let futurePriceOptions = this.homey.settings.get('futurePriceOptions');
    if (!futurePriceOptions
      || !('minCheapTime' in futurePriceOptions)
      || !('minExpensiveTime' in futurePriceOptions)
      || !('averageTime' in futurePriceOptions)
      || !('dirtCheapPriceModifier' in futurePriceOptions)
      || !('lowPriceModifier' in futurePriceOptions)
      || !('highPriceModifier' in futurePriceOptions)
      || !('extremePriceModifier' in futurePriceOptions)
      || !('priceKind' in futurePriceOptions)
      || !('priceCountry' in futurePriceOptions)
      || !('priceRegion' in futurePriceOptions)
      || !('surcharge' in futurePriceOptions)
      || !('priceFixed' in futurePriceOptions)
      || !('gridTaxDay' in futurePriceOptions)
      || !('gridTaxNight' in futurePriceOptions)
      || !('VAT' in futurePriceOptions)
      || !('currency' in futurePriceOptions)
      || !prices.isValidCurrency(futurePriceOptions.currency)
      || !(Array.isArray(futurePriceOptions.gridCosts))) {
      if (!futurePriceOptions) futurePriceOptions = {};
      if (!('minCheapTime' in futurePriceOptions)) futurePriceOptions.minCheapTime = 4;
      if (!('minExpensiveTime' in futurePriceOptions)) futurePriceOptions.minExpensiveTime = 4;
      if (!('averageTime' in futurePriceOptions)) futurePriceOptions.averageTime = 0;
      if (!('dirtCheapPriceModifier' in futurePriceOptions)) futurePriceOptions.dirtCheapPriceModifier = -50;
      if (!('lowPriceModifier' in futurePriceOptions)) futurePriceOptions.lowPriceModifier = -10;
      if (!('highPriceModifier' in futurePriceOptions)) futurePriceOptions.highPriceModifier = 10;
      if (!('extremePriceModifier' in futurePriceOptions)) futurePriceOptions.extremePriceModifier = 100;
      if (!('priceKind' in futurePriceOptions)) futurePriceOptions.priceKind = c.PRICE_KIND_SPOT;
      if (!('priceCountry' in futurePriceOptions)) futurePriceOptions.priceCountry = 'Norway (NO)';
      if (!('priceRegion' in futurePriceOptions)) futurePriceOptions.priceRegion = 0;
      if (!('surcharge' in futurePriceOptions)) futurePriceOptions.surcharge = 0.0198; // Ramua kraft energi web
      if (!('priceFixed' in futurePriceOptions)) futurePriceOptions.priceFixed = 0.6;
      if (!('gridTaxDay' in futurePriceOptions)) futurePriceOptions.gridTaxDay = 0.3626; // Tensio default
      if (!('gridTaxNight' in futurePriceOptions)) futurePriceOptions.gridTaxNight = 0.2839; // Tensio default
      if (!('VAT' in futurePriceOptions)) futurePriceOptions.VAT = 25;
      if (!('currency' in futurePriceOptions) || !prices.isValidCurrency(futurePriceOptions.currency)) futurePriceOptions.currency = this.homey.__(prices.defaultCurrency);
      if (!(Array.isArray(futurePriceOptions.gridCosts))) futurePriceOptions.gridCosts = await this.fetchTariffTable();
      this.updateLog(`Resetting futurePriceOptions to ${JSON.stringify(futurePriceOptions)}`, c.LOG_DEBUG);
      this.homey.settings.set('futurePriceOptions', futurePriceOptions);
    }
    let chargerOptions = this.homey.settings.get('chargerOptions');
    if (!chargerOptions
      || !('chargeTarget' in chargerOptions)
      || !('chargeMin' in chargerOptions)
      || !('chargeThreshold' in chargerOptions)
      || !('minToggleTime' in chargerOptions)
      || !('chargeRemaining' in chargerOptions)
      || !('chargeCycleType' in chargerOptions)
      || !('chargeEnd' in chargerOptions)
      || !('overrideEnable' in chargerOptions)
      || !('overrideStop' in chargerOptions)
      || !('overridePause' in chargerOptions)
      || !('overrideMinCurrent' in chargerOptions)) {
      if (!chargerOptions) chargerOptions = {};
      if (!('chargeTarget' in chargerOptions)) chargerOptions.chargeTarget = c.CHARGE_TARGET_AUTO;
      if (!('chargeMin' in chargerOptions)) chargerOptions.chargeMin = 1500;
      if (!('chargeThreshold' in chargerOptions)) chargerOptions.chargeThreshold = 2000;
      if (!('minToggleTime' in chargerOptions)) chargerOptions.minToggleTime = 120;
      if (!('chargeRemaining' in chargerOptions)) chargerOptions.chargeRemaining = 0;
      if (!('chargeCycleType' in chargerOptions)) chargerOptions.chargeCycleType = c.OFFER_HOURS;
      if (!('chargeEnd' in chargerOptions)) chargerOptions.chargeEnd = now;
      if (!('overrideEnable' in chargerOptions)) chargerOptions.overrideEnable = 0;
      if (!('overrideStop' in chargerOptions)) chargerOptions.overrideStop = 0;
      if (!('overridePause' in chargerOptions)) chargerOptions.overridePause = 4;
      if (!('overrideMinCurrent' in chargerOptions)) chargerOptions.overrideMinCurrent = 7;
      this.updateLog(`Resetting chargerOptions to ${JSON.stringify(chargerOptions)}`, c.LOG_DEBUG);
      this.homey.settings.set('chargerOptions', chargerOptions);
    }
    const expireDaily = this.homey.settings.get('expireDaily');
    if (!expireDaily) this.homey.settings.set('expireDaily', 62);
    const expireHourly = this.homey.settings.get('expireHourly');
    if (!expireHourly) this.homey.settings.set('expireHourly', 7);

    // Initialize current state
    this.__hasAC = false;
    this.__intervalID = undefined;
    this.__newHourID = undefined;
    this.__reserved_energy = 0;
    this.__free_power_trigger_time = new Date(now.getTime());
    this.__power_estimated = undefined;
    this.__alarm_overshoot = false;
    this.__free_capacity = 0;
    this.__num_forced_off_devices = 0;
    this.__num_off_devices = 0;
    this.__all_prices = this.homey.settings.get('all_prices');
    this.__current_prices = [];
    this.__current_price_index = undefined;
    this.mutex = new Mutex();
    this.homeyApi = new HomeyAPIApp({ homey: this.homey });
    this.__last_power_off_time = new Date(now.getTime());
    this.__last_power_on_time = new Date(now.getTime());
    this.__last_power_off_time.setUTCMinutes(this.__last_power_off_time.getUTCMinutes() - 5); // Time in the past to allow turning on devices at app start
    this.__charge_plan = []; // No charge plan
    this.__charge_power_active = 0;
    this.__spookey_check_activated = undefined;
    this.__missing_power_this_hour = 0;
    // All elements of current_state will have the following:
    //  nComError: Number of communication errors since last time it worked - Used to depriorotize devices so we don't get stuck in an infinite retry loop
    //  lastCmd: The last onoff command that was sent to the device
    //  temp: The temperature of the device
    //  ongoing: true if the state has not been confirmed yet
    // Need to be refreshed whenever the device list is created
    this.__current_state = {};

    // See comment at the top of the file why zigbee is prevented
    const timeToPreventZigbee = Math.min(15 * 60 - os.uptime(), 15 * 60);
    if (timeToPreventZigbee > 0) {
      preventZigbee = true;
      this.updateLog(`Homey reboot detected. Delaying device control by ${timeToPreventZigbee} seconds to improve Zigbee recovery.`, c.LOG_ERROR);
      setTimeout(() => {
        this.updateLog('Device constrol is once again enabled.', c.LOG_INFO);
        preventZigbee = false;
      }, timeToPreventZigbee * 1000);
    }

    this.statsInit();

    // Check that settings has been updated
    this.app_is_configured = this.validateSettings();

    // Create list of devices
    while (this.__deviceList === undefined) {
      try {
        await this.createDeviceList();
      } catch (err) {
        // Ignore the error and try to refresh the devicelist once more in 1 sec
        this.updateLog(`Could not create device list on init. Retrying ${err}`, c.LOG_ERROR);
        const delay = ms => new Promise(res => setTimeout(res, ms));
        await delay(1 * 1000);
      }
    }

    // Enable trigger cards
    const freePowerTrigger = this.homey.flow.getTriggerCard('free-power-changed');
    freePowerTrigger.registerRunListener(async (args, state) => {
      return state.freePower >= args.freePower;
    });

    // Enable action cards
    const cardActionEnergyUpdate = this.homey.flow.getActionCard('update-meter-energy'); // Marked as deprecated so nobody will see it yet
    cardActionEnergyUpdate.registerRunListener(async args => {
      const newTotal = args.TotalEnergyUsage;
      this.updateLog(`Total energy changed to: ${String(newTotal)}`, c.LOG_INFO);
    });
    const cardActionPowerUpdate = this.homey.flow.getActionCard('update-meter-power');
    cardActionPowerUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.mutex.runExclusive(async () => this.onPowerUpdate(args.CurrentPower));
    });
    const cardActionModeUpdate = this.homey.flow.getActionCard('change-piggy-bank-mode');
    cardActionModeUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      return this.onModeUpdate(+args.mode);
    });
    const cardActionModeUpdate2 = this.homey.flow.getActionCard('change-piggy-bank-mode2');
    cardActionModeUpdate2.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      return this.onModeUpdate(+args.mode.id);
    });
    cardActionModeUpdate2.registerArgumentAutocompleteListener(
      'mode',
      async (query, args) => {
        return this.generateModeList(query, args);
      }
    );
    const cardActionPricePointUpdate = this.homey.flow.getActionCard('change-piggy-bank-price-point');
    cardActionPricePointUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      if (+this.homey.settings.get('priceMode') !== c.PRICE_MODE_FLOW) return Promise.reject(new Error(this.homey.__('warnings.notPMfromFlow')));
      return this.onPricePointUpdate(+args.mode);
    });
    const cardActionMaxUsageUpdate = this.homey.flow.getActionCard('change-piggy-bank-max-usage');
    cardActionMaxUsageUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onMaxUsageUpdate(args.maxPow);
    });
    const cardActionSafetyPowerUpdate = this.homey.flow.getActionCard('change-piggy-bank-safety-power');
    cardActionSafetyPowerUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onSafetyPowerUpdate(args.reserved);
    });
    const cardActionOverride = this.homey.flow.getActionCard('override-device');
    cardActionOverride.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      return this.onOverrideChanged(args.device.id, +args.mode);
    });
    cardActionOverride.registerArgumentAutocompleteListener(
      'device',
      async (query, args) => {
        return this.generateDeviceList(query, args);
      }
    );
    const cardZoneUpdate = this.homey.flow.getActionCard('change-zone-active');
    cardZoneUpdate.registerArgumentAutocompleteListener(
      'zone',
      async (query, args) => {
        if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
        if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
        if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
        return this.generateZoneList(query, args);
      }
    );
    cardZoneUpdate.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onZoneUpdate(args.zone, args.enabled);
    });
    const noPriceCondition = this.homey.flow.getConditionCard('future-prices-unavailable');
    noPriceCondition.registerRunListener(async (args, state) => {
      return this.__current_prices[args.hours] === undefined;
    });
    const priceCondition = this.homey.flow.getConditionCard('the_price_point_is');
    priceCondition.registerRunListener(async (args, state) => {
      const priceIsEqual = +args.mode === +this.homey.settings.get('pricePoint');
      return priceIsEqual;
    });
    const modeCondition = this.homey.flow.getConditionCard('the_mode_is');
    modeCondition.registerRunListener(async (args, state) => {
      const modeIsEqual = +args.mode.id === +this.homey.settings.get('operatingMode');
      return modeIsEqual;
    });
    modeCondition.registerArgumentAutocompleteListener(
      'mode',
      async (query, args) => {
        return this.generateModeList(query, args);
      }
    );
    const isZoneEnabledCondition = this.homey.flow.getConditionCard('is_zone_enabled');
    isZoneEnabledCondition.registerRunListener(async (args, state) => {
      const activeZones = this.homey.settings.get('zones');
      const zoneIsEnabled = !activeZones.hasOwnProperty(args.zone.id) || activeZones[args.zone.id].enabled;
      return zoneIsEnabled;
    });
    isZoneEnabledCondition.registerArgumentAutocompleteListener(
      'zone', async (query, args) => this.generateZoneList(query, args)
    );
    // Action cards for charging
    const cardActionStartChargingCycle = this.homey.flow.getActionCard('start-charging-cycle');
    cardActionStartChargingCycle.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onChargingCycleStart(args.offerEnergy, args.endTime);
    });
    const cardActionStartChargingCycle2 = this.homey.flow.getActionCard('start-charging-cycle2');
    cardActionStartChargingCycle2.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onChargingCycleStart(undefined, args.endTime, args.offerHours);
    });
    const cardActionStopChargingCycle = this.homey.flow.getActionCard('stop-charging-cycle');
    cardActionStopChargingCycle.registerRunListener(async args => {
      if (preventZigbee) return Promise.reject(new Error(this.homey.__('warnings.homeyReboot')));
      if (!this.app_is_configured) return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
      if (+this.homey.settings.get('operatingMode') === c.MODE_DISABLED) return Promise.reject(new Error(this.homey.__('warnings.notEnabled')));
      return this.onChargingCycleStop();
    });

    // Prepare which devices was on for setting deviceList which is called after this
    this.__oldDeviceList = this.homey.settings.get('deviceList') || [];

    this.homey.settings.on('set', setting => {
      if (setting === 'futurePriceOptions') {
        // For some reason this
        const futurePriceOptions = this.homey.settings.get('futurePriceOptions');
        if (!('currency' in futurePriceOptions)
          || !prices.isValidCurrency(futurePriceOptions.currency)) {
          futurePriceOptions.currency = this.homey.__(prices.defaultCurrency);
        }
      }
      if (setting === 'deviceList') {
        this.__deviceList = this.homey.settings.get('deviceList');
        for (const deviceId in this.__deviceList) {
          if (this.__deviceList[deviceId].use && !((deviceId in this.__oldDeviceList) && this.__oldDeviceList[deviceId].use)) {
            this.runDeviceCommands(deviceId, 'onAdd');
          } else if (!this.__deviceList[deviceId].use && (deviceId in this.__oldDeviceList) && this.__oldDeviceList[deviceId].use) {
            this.runDeviceCommands(deviceId, 'onRemove');
          }
        }
        this.__oldDeviceList = this.__deviceList;
      } else if (setting === 'settingsSaved') {
        const doRefresh = this.homey.settings.get('settingsSaved');
        if (doRefresh === 'true') {
          this.updateLog('Settings saved, refreshing all devices.', c.LOG_INFO);
          this.app_is_configured = this.validateSettings();
          if (!this.app_is_configured) {
            throw (new Error('This should never happen, please contact the developer and the bug will be fixed'));
          }

          const currentMode = +this.homey.settings.get('operatingMode');
          if (!preventZigbee && currentMode !== c.MODE_DISABLED) {
            this.refreshAllDevices();
          }
          // Prices might have changed, need to fetch them again
          this.__all_prices = undefined;
          this.__current_prices = [];
          this.__current_price_index = undefined;
          this.homey.settings.set('all_prices', this.__all_prices);
          this.onNewHour(false, now); // Just to refresh prices and reschedule charging.
          this.homey.settings.set('settingsSaved', '');
          // The callback only returns on error so notify success with failure
          throw (new Error(this.homey.__('settings.alert.settingssaved')));
        }
      }
    });

    // ============= RUN ONADD EVENTS FOR ALL SELECTED DEVICES ==============
    try {
      const frostList = this.homey.settings.get('frostList');
      for (const deviceId in frostList) {
        await this.runDeviceCommands(deviceId, 'onAdd');
      }
    } catch (err) {
      this.updateLog(`onInit error, could not run onAdd for relevant devices: ${err}`);
    }

    // ============== ON NEW HOUR SAFETY GUARD WHEN RESTARTING ==============
    // Check if the onNewHour was missed due to a restart
    const timeWithinHour = timeSinceLastHour(now);
    if (this.__current_power === undefined) {
      // First time app was started or the time since restart exceeded an hour
      // Reserve energy for the time we have no data on
      const maxPower = this.homey.settings.get('maxPower');
      const errorMargin = this.homey.settings.get('errorMargin') ? (parseInt(this.homey.settings.get('errorMargin'), 10) / 100) : 1;
      const lapsedTime = timeWithinHour;
      // Assume 100% use this hour up until now (except for the errorMargin so we gett less warnings the first hour)
      this.__reserved_energy = (1 - errorMargin) * ((maxPower * lapsedTime) / (1000 * 60 * 60));
      if (Number.isNaN(this.__reserved_energy)) {
        this.__reserved_energy = 0;
      }
      await this.onNewHour(false, now); // Not a new hour, hense false
    } else {
      // Got some data from safe shutdown... Use this to calculate if new hour was crossed
      const lapsedTime = now - this.__current_power_time;
      const timeLeftInHour = timeToNextHour(this.__current_power_time);
      let timeToProcess = lapsedTime;
      if (lapsedTime > timeLeftInHour) {
        timeToProcess = timeLeftInHour;
      }
      const energyUsed = (this.__current_power * timeToProcess) / (1000 * 60 * 60);
      this.__accum_energy += energyUsed;
      this.__current_power_time = new Date(now.getTime());
      this.__reserved_energy = 0;
      if (timeToProcess < lapsedTime || timeWithinHour === 0) {
        // Only call onNewHour if the app restart crossed into a new hour
        await this.onNewHour(true, now);
        // Add up initial part of next hour.
        const energyUsedNewHour = (this.__current_power * timeWithinHour) / (1000 * 60 * 60);
        this.__accum_energy = energyUsedNewHour;
        this.__current_power_time = new Date(now.getTime()); // When adding to this.__accum_energy then last power time must be reset.
        this.log(`NewHour energy from safe restart: ${this.__accum_energy}`, c.LOG_INFO);
      } else {
        await this.onNewHour(false, now); // Not a new hour, hense false
      }
    }

    // Start the onNewHour timer for coming hours
    this.__newHourID = setTimeout(() => this.onNewHourWrapper(), timeToNextHour(new Date(now.getTime())));

    // Monitor energy usage every 5 minute
    this.__monitorError = 0;
    this.__intervalID = setInterval(() => {
      this.mutex.runExclusive(async () => this.onMonitor());
    }, 1000 * 60 * 5);

    this.updateLog('PiggyBank has been initialized', c.LOG_INFO);
    return Promise.resolve();
  }

  /**
   * Warning: homey does not report any errors if this function crashes, so make sure it doesn't crash
   */
  async generateModeList(query, args) {
    const results = [
      { name: this.homey.__('settings.app.disabled'), description: '', id: '0' },
      { name: this.homey.__('settings.opMode.normal'), description: '', id: '1' },
      { name: this.homey.__('settings.opMode.night'), description: '', id: '2' },
      { name: this.homey.__('settings.opMode.holiday'), description: '', id: '3' }
    ];
    const modeNames = this.homey.settings.get('modeNames');
    if (Array.isArray(modeNames)) {
      for (const nameId in modeNames) {
        const mode = {
          name: modeNames[nameId],
          description: `${this.homey.__('settings.opMode.custom')} ${+nameId + 1}`,
          id: `${4 + +nameId}`
        };
        results.push(mode);
      }
    }
    return results.filter(result => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

  /**
   * Applies a mode override for a device
   */
  async applyModeOverride(mode, deviceId) {
    const override = this.homey.settings.get('override') || {};
    return (override[deviceId] === c.OVERRIDE.CONTROLLED) ? c.MAIN_OP.CONTROLLED
      : (override[deviceId] === c.OVERRIDE.ON) ? c.MAIN_OP.ALWAYS_ON
        : (override[deviceId] === c.OVERRIDE.OFF) ? c.MAIN_OP.ALWAYS_OFF
          : mode;
  }

  /**
   * Warning: homey does not report any errors if this function crashes, so make sure it doesn't crash
   */
  async generateDeviceList(query, args) {
    const frostList = this.homey.settings.get('frostList');
    const results = [];
    for (const deviceId in frostList) {
      const device = {
        name: this.__deviceList[deviceId].name,
        description: this.__deviceList[deviceId].room,
        id: deviceId
      };
      results.push(device);
    }
    return results.filter(result => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

  /**
   * Warning: homey does not report any errors if this function crashes, so make sure it doesn't crash
   */
  async generateZoneList(query, args) {
    // Count how many devices there are in every zone
    // The zone object looks like this:
    // {"id":"9919ee1e-ffbc-480b-bc4b-77fb047e9e68","name":"Hjem","order":1,"parent":null,"active":false,"activeLastUpdated":null,"icon":"home"}
    const zones = await this.homeyApi.zones.getZones()
      .catch(err => {
        // Failed to get the zones so just return nothing
        return [];
      });
    const activeZones = {};
    for (const deviceId in this.__deviceList) {
      if (this.__deviceList[deviceId].use) {
        let zoneId = this.__deviceList[deviceId].roomId;
        while (zoneId !== null) {
          if (zoneId in activeZones) {
            activeZones[zoneId] += 1;
          } else {
            activeZones[zoneId] = 1;
          }
          zoneId = zones[zoneId].parent;
        }
      }
    }

    // Generate zone list to return
    const results = [];
    for (const zoneId in activeZones) {
      const room = {
        name: zones[zoneId].name,
        description: `${this.homey.__('settings.zone.zoneNum')}: ${String(activeZones[zoneId])}`,
        id: zoneId
      };
      results.push(room);
    }
    return results.filter(result => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

  /**
   * onUninit() is called when the app is destroyed
   * Note. Due to a bug in HomeyAPI this function is not called automatically and is instead triggered
   * by the app itself, thus when the HomeyAPI bug is fixed it might be that this function will be called twice.
   * It is for this reason essential that the code is safe to run twice.
   */
  async onUninit() {
    // ===== KEEPING STATE ACROSS RESTARTS =====
    // We only got 1s to do this so need to save state before anything else
    // For onPowerUpdate + onNewHour
    this.homey.settings.set('safeShutdown__accum_energy', this.__accum_energy);
    this.homey.settings.set('safeShutdown__current_power', this.__current_power);
    this.homey.settings.set('safeShutdown__current_power_time', this.__current_power_time);
    this.homey.settings.set('safeShutdown__power_last_hour', this.__power_last_hour);
    this.homey.settings.set('safeShutdown__offeredEnergy', this.__offeredEnergy);
    // ===== KEEPING STATE ACROSS RESTARTS END =====

    this.log('OnUnInit');
    // Make sure the interval is cleared if it was started, otherwise it will continue to
    // trigger but on an unknown app.
    if (this.__intervalID !== undefined) {
      clearInterval(this.__intervalID);
      this.__intervalID = undefined;
    }
    if (this.__newHourID !== undefined) {
      clearTimeout(this.__newHourID);
      this.__newHourID = undefined;
    }
    this.statsUnInit();

    this.updateLog('PiggyBank has been uninitialized', c.LOG_INFO);
  }

  /**
   * Create a list of relevant devices
   */
  async createDeviceList() {
    // Call APIs
    const devices = await this.homeyApi.devices.getDevices(); // Error thrown is catched by caller of createDeviceList
    const zones = await this.homeyApi.zones.getZones(); // Error thrown is catched by caller of createDeviceList
    // Note: The API calls above might time out, in which case the rest of the function will never be executed.

    const oldDeviceList = this.homey.settings.get('deviceList');
    const relevantDevices = {};

    // Loop all devices
    for (const device of Object.values(devices)) {
      const driverId = `${device.driverUri.split(':').at(-1)}:${device.driverId}`;
      // Relevant Devices must have an onoff capability
      // Unfortunately some devices like the SensiboSky heat pump controller invented their own onoff capability
      // so unless specially handled the capability might not be detected. The generic detection mechanism below
      // has only been tested on SensiboSky devices so there might be problems with other devices with custom onoff capabilities
      let onoffCap = device.capabilities.includes('onoff') ? 'onoff' : device.capabilities.find(cap => cap.includes('onoff'));
      if ((onoffCap === undefined) && (driverId in d.DEVICE_CMD)) {
        onoffCap = d.DEVICE_CMD[driverId].setOnOffCap;
        if ((typeof onoffCap === 'object') && (onoffCap !== null)) {
          const filteredArray = onoffCap.filter(value => device.capabilities.includes(value));
          onoffCap = filteredArray[0];
        }
      }
      if (onoffCap === undefined) {
        this.updateLog(`ignoring: ${device.name}`, c.LOG_DEBUG);
        continue;
      }
      // Priority 1 devices has class = thermostat & heater - capabilities ['target_temperature' + 'measure_temperature']
      const priority = (((driverId in d.DEVICE_CMD)
        && ((d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.CHARGER)
        || (d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.HEATER)
        || (d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.WATERHEATER)
        || (d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.AC))) ? 1 : 0)
        + (device.capabilities.includes('target_temperature') ? 1 : 0)
        + (device.capabilities.includes('measure_temperature') ? 1 : 0)
        + ((device.class === 'thermostat' || device.class === 'heater') ? 1 : 0);

      // Filter out irrelevant devices (check old device list if possible)
      let useDevice = false;
      let reliability;
      if (oldDeviceList !== null && device.id in oldDeviceList) {
        useDevice = oldDeviceList[device.id].use;
        reliability = oldDeviceList[device.id].reliability;
      } else if (oldDeviceList === null) {
        // App opened for the first time, set usage based on priority
        useDevice = (priority > 0);
      } else {
        // Never seen before device, disable by default
        useDevice = false;
      }
      if (reliability === undefined) {
        reliability = 1;
      }

      // Find which zones the device are within:
      let zoneId = device.zone;
      const memberOfZones = [];
      while (zoneId !== null) {
        memberOfZones.push(zoneId);
        zoneId = zones[zoneId].parent;
      }

      // Check if we have AC devices
      this.__hasAC |= /* useDevice && */ (driverId in d.DEVICE_CMD) && (d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.AC);

      this.updateLog(`Device: ${String(priority)} ${device.id} ${device.name} ${device.class}`, c.LOG_DEBUG);
      const thermostatCap = (driverId in d.DEVICE_CMD)
        ? (d.DEVICE_CMD[driverId].readTempCap && d.DEVICE_CMD[driverId].setTempCap)
        : (device.capabilities.includes('target_temperature') && device.capabilities.includes('measure_temperature'));
      // device.capabilitiesObj should be available but in case homey timed out it could be incomplete
      const targetTemp = (thermostatCap && device.capabilitiesObj && ('target_temperature' in device.capabilitiesObj))
        ? +device.capabilitiesObj['target_temperature'].value : 24;
      const relevantDevice = {
        priority: (priority > 0) ? 1 : 0,
        name: device.name,
        room: device.zoneName,
        roomId: device.zone,
        memberOf: memberOfZones,
        image: device.iconObj == null ? null : device.iconObj.url,
        onoff_cap: onoffCap,
        thermostat_cap: thermostatCap,
        targetTemp, // Default target temp for use when setting up for the first time
        driverId, // If this is found in the supported device list then onoff_cap and thermostat_cap are ignored
        use: useDevice, // Actually only parameter that is kept across reboots (+ reliability)
        reliability // Inherit reliability as devicelist is refreshed whenever setup shows
      };
      relevantDevices[device.id] = relevantDevice;
    }
    this.__deviceList = relevantDevices;

    // Refresh current state for monitoring:
    if (!this.__current_state) {
      this.__current_state = {};
    }
    for (const deviceId in relevantDevices) {
      if (!(deviceId in this.__current_state)) {
        this.__current_state[deviceId] = {
          nComError: 0,
          lastCmd: undefined,
          temp: undefined,
          ongoing: false,
          __monitorError: 0,
          __monitorFixOn: 0,
          __monitorFixTemp: 0
        };
      }
    }
    return this.__deviceList;
  }

  /**
   * Updates the reliability measure of a device
   * This is a floating measure gradually moving to the new state
   * - Old state is given a weight of 99%
   * - New state is given a weight of 1%
   */
  async updateReliability(deviceId, newstate) {
    this.__deviceList[deviceId].reliability = (0.99 * this.__deviceList[deviceId].reliability) + (0.01 * newstate);
  }

  /**
   * Return a tooken describing how well the app has been configured
   */
  async getAppConfigProgress() {
    const appConfigProgress = {};
    this.apiState = await this._checkApi();
    appConfigProgress.numSpookeyChanges = this.__spookey_changes;
    appConfigProgress.energyMeterNotConnected = (this.__energy_meter_detected_time === undefined);
    appConfigProgress.timeSinceEnergyMeter = ((new Date() - this.__energy_meter_detected_time) / 1000);
    appConfigProgress.gotPPFromFlow = this.homey.settings.get('gotPPFromFlow') === 'true';
    appConfigProgress.ApiStatus = this.apiState;
    return appConfigProgress;
  }

  /**
   * Return a list of currencies that can be used
   */
  async getCurrencies() {
    await prices.currencyApiInit(this.homey.i18n.getLanguage());
    const currencies = await prices.fetchCurrencyTable();
    const namesOnly = {};
    const indices = Object.keys(currencies).sort();
    for (const idx in indices) {
      const id = indices[idx];
      namesOnly[id] = currencies[id].name;
    }
    return namesOnly;
  }

  /**
   * Return a json object of the state to be used for backup and debug.
   */
  async getFullState() {
    const myState = {};
    myState.version = Homey.manifest.version;
    myState.settings = {};
    const settings = this.homey.settings.getKeys();
    for (let i = 0; i < settings.length; i++) {
      myState.settings[settings[i]] = await this.homey.settings.get(settings[i]);
    }
    myState.state = {};
    const state = Object.keys(this);
    for (let i = 0; i < state.length; i++) {
      if (state[i].includes('__', 0)) {
        try {
          let abortIfCircular = JSON.stringify(this[state[i]]);
          abortIfCircular = this[state[i]];
          myState.state[state[i]] = abortIfCircular;
        } catch (err) {
          myState.state[state[i]] = '...';
        }
      }
    }
    return myState;
  }

  /**
   * Reduces the power usage for a charger device
   * This function is only called if the device is a charger or a manually selected socket device
   * Note that this function is already throttled by onBelowPowerLimit such that it will not increase power
   * immediately after it was decreased
   * @return [success, noChange] - success means that the result is as requested, noChange indicate if the result was already as requested
   * @throw error in case of failure
   */
  async changeDevicePower(deviceId, powerChange) {
    const chargerOptions = this.homey.settings.get('chargerOptions');
    if (chargerOptions.chargeTarget === c.CHARGE_TARGET_FLOW) {
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for '${deviceId} because you have selected to control charging using flows, not automaticly.`, c.LOG_ALL);
      return Promise.resolve([true, true]);
    }
    this.updateLog(`Requested power change: ${powerChange}`, c.LOG_DEBUG);
    let device;
    try {
      device = await this.getDevice(deviceId);
      this.updateReliability(deviceId, 1);
    } catch (err) {
      // Most likely timeout
      this.updateLog(`Charger device cannot be fetched. ${String(err)}`, c.LOG_ERROR);
      this.__current_state[deviceId].nComError += 10; // Big error so wait more until retry than smaller errors
      this.updateReliability(deviceId, 0);
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for '${deviceId} due to Homey API issues (Homey is busy)`, c.LOG_ALL);
      return Promise.resolve([false, false]); // The unhandled device is solved by the later nComError handling
    }

    if (this.logUnit === deviceId) this.updateLog(`attempt changeDevicePower(${powerChange}) for ${device.name}`, c.LOG_ALL);

    if (device.capabilitiesObj === null) {
      this.updateLog('Charger device capability list missing', c.LOG_ERROR);
      this.__current_state[deviceId].nComError += 10; // This should not happen
      this.updateReliability(deviceId, 0);
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for ${device.name} due to Homey API issues (Homey busy?)`, c.LOG_ALL);
      return Promise.resolve([false, false]);
    }

    const { driverId } = this.__deviceList[deviceId];
    if ((!(driverId in d.DEVICE_CMD))
      || (d.DEVICE_CMD[driverId].measurePowerCap === undefined)
      || (d.DEVICE_CMD[driverId].setCurrentCap === undefined)
      || (d.DEVICE_CMD[driverId].getOfferedCap === undefined)
      || (d.DEVICE_CMD[driverId].onChargeStart === undefined)
      || (d.DEVICE_CMD[driverId].onChargeEnd === undefined)
      || (d.DEVICE_CMD[driverId].statusCap === undefined)
      || (d.DEVICE_CMD[driverId].statusUnavailable === undefined)) {
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for ${device.name} the charger definition in Piggy is incorrect`, c.LOG_ALL);
      return Promise.reject(new Error('Please notify the developer that the charger definition for this charger is incorrect and need to be updated'));
    }
    const ampsOffered = +await device.capabilitiesObj[d.DEVICE_CMD[driverId].setCurrentCap].value;
    const powerUsed = +await device.capabilitiesObj[d.DEVICE_CMD[driverId].measurePowerCap].value;
    const isOn = (powerUsed > 0) || (ampsOffered > 0);
    this.__charge_power_active = powerUsed;
    if ((!isOn) && (powerChange < chargerOptions.chargeThreshold)) {
      // The device should not be turned on if the available power is less than the charge threshold
      if (this.logUnit === deviceId) this.updateLog(`abort changeDevicePower() for ${device.name} - available power was less than charge threshold`, c.LOG_ALL);
      return Promise.resolve([false, false]);
    }
    const isEmergency = (+powerChange < 0) && (
      ((powerUsed + +powerChange) < 0) || (ampsOffered === d.DEVICE_CMD[driverId].minCurrent));
    const now = new Date();
    const end = new Date(chargerOptions.chargeEnd);
    if ((end < now)
      || ((chargerOptions.chargeCycleType === c.OFFER_ENERGY) && (+chargerOptions.chargeRemaining < this.__offeredEnergy))) {
      chargerOptions.chargeRemaining = 0;
    }

    const withinChargingCycle = (+chargerOptions.chargeRemaining > 0);
    const withinChargingPlan = (this.__charge_plan[0] > 0) && withinChargingCycle;
    const { lastCurrent, lastPower } = this.__current_state[deviceId];
    const ampsActualOffer = +await device.capabilitiesObj[d.DEVICE_CMD[driverId].getOfferedCap].value;
    if ((lastCurrent === ampsActualOffer) && (lastPower !== powerUsed)) {
      // note that confirmed is not set when lastCurrent is higher than ampsActualOffer because ampsActualOffer is clamped.
      // Since we don't know the clamp it's difficult to detect confirmed for this case... But: This is ok for our case,
      // because confirmed is only used to ignore charger throttle and it doesn't matter if we throttle a little bit more
      // when increasing power. One possible downside is that when power is becoming available then less prioritized devices
      // will have a possibility to be turned on before the charger.
      this.__current_state[deviceId].confirmed = true;
    }
    const ignoreChargerThrottle = this.__current_state[deviceId].confirmed;
    // Check that we do not toggle the charger too often
    const timeLapsed = (now - this.prevChargerTime) / 1000; // Lapsed time in seconds
    const throttleActive = timeLapsed < +chargerOptions.minToggleTime;
    if (this.prevChargerTime !== undefined && throttleActive && !ignoreChargerThrottle && !isEmergency) {
      // Must wait a little bit more before changing
      this.updateLog(`Wait more: ${+(chargerOptions.minToggleTime)} - ${timeLapsed} = ${+(chargerOptions.minToggleTime) - timeLapsed} sec left`, c.LOG_DEBUG);
      // Report success in case there is an unconfirmed command and we're trying to reduce power... to avoid reporting powerfail too early.
      if (!ignoreChargerThrottle && (+powerChange < 0)) {
        if (this.logUnit === deviceId) this.updateLog(`finished changeDevicePower() for ${device.name} - still waiting for confirmation on previous command`, c.LOG_ALL);
        return Promise.resolve([true, false]); // Also report onChanged=false because of the unconfirmed change
      }
      // Return failure in case the earlier commands was confirmed to allow turning on/off other devices
      if (this.logUnit === deviceId) this.updateLog(`aborted changeDevicePower() for ${device.name} - Must wait for toggle time to expire`, c.LOG_ALL);
      return Promise.resolve([false, false]);
    }
    this.prevChargerTime = now;
    if (isEmergency) this.updateLog('Emergency turn off for charger device (minToggleTime ignored)', c.LOG_WARNING);

    const chargerStatus = await device.capabilitiesObj[d.DEVICE_CMD[driverId].statusCap].value;
    const maxCurrent = +await device.capabilitiesObj[d.DEVICE_CMD[driverId].setCurrentCap].max;
    const stopCurrent = +chargerOptions.overrideEnable ? +chargerOptions.overrideStop : 0;
    const pauseCurrent = +chargerOptions.overrideEnable ? +chargerOptions.overridePause : d.DEVICE_CMD[driverId].pauseCurrent;
    const minCurrent = +chargerOptions.overrideEnable ? +chargerOptions.overrideMinCurrent : d.DEVICE_CMD[driverId].minCurrent;
    const maxPower = +this.homey.settings.get('maxPower');
    const cannotCharge = d.DEVICE_CMD[driverId].statusUnavailable.includes(chargerStatus);
    const newOfferPower = Math.min(Math.max(powerUsed + +powerChange, +chargerOptions.chargeMin), maxPower);
    const newOfferCurrent = (!withinChargingCycle) ? stopCurrent
      : (!withinChargingPlan || isEmergency || cannotCharge) ? pauseCurrent
        : (+powerUsed === 0) ? minCurrent
          : Math.floor(Math.min(Math.max(ampsOffered * (newOfferPower / +powerUsed), minCurrent), +maxCurrent));
    this.updateLog(`Setting ${newOfferCurrent} amp, was ${ampsActualOffer}`, c.LOG_DEBUG);
    if ((newOfferCurrent === ampsActualOffer) && (newOfferCurrent === ampsOffered)) {
      if (this.logUnit === deviceId) this.updateLog(`finished changeDevicePower() for ${device.name} - The new current is the same as the previous`, c.LOG_ALL);
      return Promise.resolve([true, true]);
    }
    this.__current_state[deviceId].lastCurrent = newOfferCurrent;
    this.__current_state[deviceId].lastPower = powerUsed;
    this.__current_state[deviceId].confirmed = false;
    this.__current_state[deviceId].ongoing = true;
    return this.chargeCycleValidation(deviceId, device, withinChargingCycle, throttleActive)
      .then(() => {
        const capName = d.DEVICE_CMD[driverId].setCurrentCap;
        if (this.logUnit === deviceId) this.updateLog(`Setting Device ${device.name}.${capName} = ${newOfferCurrent} | Origin ChangeDevicePower(${powerChange})`, c.LOG_ALL);
        return device.setCapabilityValue({ capabilityId: capName, value: newOfferCurrent });
      })
      .then(() => {
        this.__current_state[deviceId].ongoing = false;
        this.__current_state[deviceId].nComError = 0;
        this.updateReliability(deviceId, 1);
        const noChange = withinChargingPlan ? powerUsed + +powerChange < newOfferPower : !isOn;
        if (this.logUnit === deviceId) this.updateLog(`finished changeDevicePower() for ${device.name} - all success`, c.LOG_ALL);
        return Promise.resolve([true, noChange]); // In case more power is offered but it doesn't get used, let the app turn on other devices
      })
      .catch(err => {
        this.updateLog(`Failed signalling charger: ${String(err)}`, c.LOG_ERROR);
        this.__current_state[deviceId].nComError += 1;
        this.__current_state[deviceId].ongoing = undefined;
        this.updateReliability(deviceId, 0);
        if (this.logUnit === deviceId) this.updateLog(`aborted changeDevicePower() for ${device.name} - failed signalling charger ${String(err)}`, c.LOG_ALL);
        return Promise.resolve([false, false]);
      });
  }

  /**
   * Makes sure that a charge cycle does not move out of the active phase
   * and count spookey changes
   */
  async chargeCycleValidation(deviceId, planActive, throttleActive) {
    const listRef = planActive ? 'onChargeStart' : 'onChargeEnd';
    const changeNeeded = await this.runDeviceCommands(deviceId, listRef); // Pass errors on
    this.__spookey_changes += (this.__spookey_check_activated === planActive && !throttleActive) ? changeNeeded : 0;
    this.__spookey_check_activated = planActive;
    return Promise.resolve();
  }

  /**
   * Checks if the frost guard is active
   */
  isFrostGuardActive(device, deviceId) {
    const tempCap = this.getTempGetCap(deviceId);
    const override = this.homey.settings.get('override') || {};
    let frostGuardIsOn;
    if ((device.capabilitiesObj === null) || (device.capabilitiesObj[tempCap] === undefined)) {
      frostGuardIsOn = false;
    } else {
      const frostList = this.homey.settings.get('frostList');
      frostGuardIsOn = device.capabilitiesObj[tempCap].value < frostList[deviceId].minTemp;
    }
    if (!frostGuardIsOn && override[deviceId] === c.OVERRIDE.FROST_GUARD) {
      delete override[deviceId]; // Done with override
      this.homey.settings.set('override', override);
    } else if (frostGuardIsOn) {
      override[deviceId] = c.OVERRIDE.FROST_GUARD;
      this.homey.settings.set('override', override);
    }
    return frostGuardIsOn;
  }

  /**
   * Changes the state of a device.
   * The state cannot always be changed. The priority of states are as follows:
   * - Below frost-guard results in always on and highest priority
   * - If a zone is off then no devices will be on for devices in the zone
   * - Device always off from mode
   * - Device turns off from price action
   * - Device always on from mode
   * - Device turns off due to power control
   * - Device turns on from price action
   * - Device turns on due to power control
   * @return [success, noChange] - success means that the result is as requested, noChange indicate if the result was already as requested
   * @throw error in case of failure
   */
  async changeDeviceState(deviceId, targetState) {
    if (!(deviceId in this.__deviceList)) {
      // Apparently the stored settings are invalid and need to be refreshed
      this.updateLog('The settings are corrupted, please save the settings again', c.LOG_ERROR);
      return Promise.resolve([false, false]);
    }
    const actionLists = this.homey.settings.get('priceActionList');
    const priceMode = +this.homey.settings.get('priceMode');
    const actionListIdx = +this.homey.settings.get('pricePoint');
    const currentAction = actionLists[actionListIdx][deviceId]; // Action state: .operation
    const modeLists = this.homey.settings.get('modeList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const override = this.homey.settings.get('override') || {};
    const forceControlled = (override[deviceId] === c.OVERRIDE.CONTROLLED);
    const currentModeList = modeLists[currentMode - 1];
    const currentModeIdx = this.findModeIdx(deviceId);
    const currentModeState = forceControlled ? c.MAIN_OP.CONTROLLED : parseInt(currentModeList[currentModeIdx].operation, 10); // Mode state
    const replacementOp = (currentModeState === MAIN_OP.ALWAYS_OFF) ? TARGET_OP.TURN_OFF : TARGET_OP.TURN_ON;
    const currentActionOp = (priceMode === c.PRICE_MODE_DISABLED) ? replacementOp : parseInt(currentAction.operation, 10); // Override the current action if price actions are disabled

    // Do not attempt to control any devices if the app is disabled
    if (currentMode === 0) { // App is disabled
      return Promise.resolve([false, false]);
    }

    // In case the new state was not set it will be the same as the preferred state.
    // This can happen for 3 cases:
    // - priceMode is DISABLED
    // - zone control turns on devices again
    // - there is sufficient power to turn on devices again
    let newState;
    if ((targetState === undefined) || (targetState === TARGET_OP.DELTA_TEMP)) {
      switch (currentActionOp) {
        case TARGET_OP.DELTA_TEMP:
          // Override as changedevicestate only handles onoff
          newState = TARGET_OP.TURN_ON;
          break;
        default:
          newState = currentActionOp;
      }
    } else {
      newState = targetState;
    }

    // Do not attempt to change the device state if it is in IGNORE
    // or EMERGENCY_OFF mode unless it is an EMERGENCY_OFF operation
    if ((currentActionOp === TARGET_OP.IGNORE) || (newState === TARGET_OP.IGNORE)
      || (currentActionOp === TARGET_OP.EMERGENCY_OFF && newState !== TARGET_OP.EMERGENCY_OFF)) {
      if (this.logUnit === deviceId) this.updateLog(`aborted changeDeviceState() for '${deviceId} - Action was ignore or Emergency was not emergency`, c.LOG_ALL);
      return Promise.resolve([false, false]);
    }

    let device;
    try {
      device = await this.getDevice(deviceId);
      if (this.logUnit === deviceId) this.updateLog(`attempt changeDeviceState(${targetState}) for ${device.name}`, c.LOG_ALL);
      this.updateReliability(deviceId, 1);
    } catch (err) {
      // Most likely timeout
      this.updateLog(`Device cannot be fetched. ${String(err)}`, c.LOG_ERROR);
      this.__current_state[deviceId].nComError += 10; // Big error so wait more until retry than smaller errors
      this.updateReliability(deviceId, 0);
      if (this.logUnit === deviceId) this.updateLog(`aborted changeDeviceState() for '${deviceId} - Homey API failure (Homey is busy)`, c.LOG_ALL);
      return Promise.resolve([false, false]); // The unhandled device is solved by the later nComError handling
    }
    const frostGuardActive = this.isFrostGuardActive(device, deviceId);

    if (this.getOnOffCap(deviceId) === undefined) {
      if (this.logUnit === deviceId) this.updateLog(`aborted changeDeviceState() for ${device.name} - Homey API failure (Homey busy?)`, c.LOG_ALL);
      return Promise.resolve([false, false]); // Homey was busy, will have to retry later
    }
    const isOn = this.getIsOn(device, deviceId);
    if (override[deviceId] === c.OVERRIDE.OFF_UNTIL_MANUAL_ON && isOn) {
      delete override[deviceId];
      this.homey.settings.set('override', override);
    }
    const forceOn = (override[deviceId] === c.OVERRIDE.ON);
    const forceOff = (override[deviceId] === c.OVERRIDE.OFF)
      || (override[deviceId] === c.OVERRIDE.OFF_UNTIL_MANUAL_ON);
    const activeZones = this.homey.settings.get('zones');
    const isEmergency = targetState === TARGET_OP.EMERGENCY_OFF;
    const newStateOn = frostGuardActive || (forceOn && !isEmergency)
      || (currentActionOp !== TARGET_OP.TURN_OFF && !isEmergency && !forceOff
        && !this.__deviceList[deviceId].memberOf.some(z => (activeZones.hasOwnProperty(z) && !activeZones[z].enabled))
        && ((newState === TARGET_OP.TURN_ON && currentModeState !== MAIN_OP.ALWAYS_OFF)
          || (newState === TARGET_OP.TURN_OFF && currentModeState === MAIN_OP.ALWAYS_ON)
          || (newState === TARGET_OP.EMERGENCY_OFF && isOn)));

    if (newState === TARGET_OP.EMERGENCY_OFF && newStateOn === undefined) {
      // Early exit because it's no emergency and we don't know whether to be on or off
      if (this.logUnit === deviceId) this.updateLog(`aborted changeDeviceState() for ${device.name} - mode is EMERGENCY_OFF but there is no emergency`, c.LOG_ALL);
      return Promise.resolve([false, false]);
    }

    this.__current_state[deviceId].lastCmd = newStateOn ? TARGET_OP.TURN_ON : (newState === TARGET_OP.EMERGENCY_OFF) ? TARGET_OP.EMERGENCY_OFF : TARGET_OP.TURN_OFF;
    if (newStateOn === undefined) {
      this.updateLog(`isOn was set to undefined ${frostGuardActive}`, c.LOG_ERROR);
    }
    this.__current_state[deviceId].ongoing = false; // If already ongoing then it should already have been completed, try again
    if (newStateOn && ((isOn === undefined) || !isOn)) {
      // Turn on
      const deviceName = this.__deviceList[deviceId].name;
      this.updateLog(`Turning on device: ${deviceName}`, c.LOG_INFO);
      this.__current_state[deviceId].ongoing = true;
      this.__current_state[deviceId].confirmed = false;
      return this.setOnOff(device, deviceId, true)
        .then(() => {
          this.updateReliability(deviceId, 1);
          this.__current_state[deviceId].nComError = 0;
          this.__num_off_devices--;
          // Always change temperature when turning on
          if (this.logUnit === deviceId) this.updateLog(`finished changeDeviceState() for ${device.name} - successfully turned on`, c.LOG_ALL);
          return this.refreshTemp(deviceId); // Will not return error
        })
        .then(() => Promise.resolve([newState === TARGET_OP.TURN_ON, false]))
        .catch(error => {
          this.updateReliability(deviceId, 0);
          this.statsCountFailedTurnOn();
          this.__current_state[deviceId].ongoing = undefined;
          this.__current_state[deviceId].nComError += 1;
          this.updateLog(`Failed to turn on device ${deviceName}, will retry later`, c.LOG_ERROR);
          if (this.logUnit === deviceId) this.updateLog(`aborted changeDeviceState() for ${device.name} due to ${String(error)}`, c.LOG_ALL);
          return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
        });
    } // ignore case !wantOn && isOn

    if (!newStateOn && ((isOn === undefined) || isOn)) {
      // Turn off
      const deviceName = this.__deviceList[deviceId].name;
      this.updateLog(`Turning off device: ${deviceName} ${targetState} ${newStateOn} ${isOn} | ${isEmergency}`, c.LOG_INFO);
      this.__current_state[deviceId].ongoing = true;
      this.__current_state[deviceId].confirmed = false;
      return this.setOnOff(device, deviceId, false)
        .then(() => {
          this.updateReliability(deviceId, 1);
          this.__current_state[deviceId].nComError = 0;
          this.__current_state[deviceId].ongoing = false;
          this.__num_off_devices++;
          if (this.logUnit === deviceId) this.updateLog(`finished changeDeviceState() for ${device.name} - successfully turned off`, c.LOG_ALL);
          return Promise.resolve([newState === TARGET_OP.TURN_OFF, false]);
        })
        .catch(error => {
          this.updateReliability(deviceId, 0);
          this.__current_state[deviceId].ongoing = undefined;
          this.statsCountFailedTurnOff();
          this.__current_state[deviceId].nComError += 1;
          this.updateLog(`Failed to turn off device ${deviceName}, will try to turn off other devices instead. (${error})`, c.LOG_ERROR);
          if (this.logUnit === deviceId) this.updateLog(`aborted changeDeviceState() for ${device.name} due to: ${String(error)}`, c.LOG_ALL);
          return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
        });
    }

    if (newStateOn && isOn && (targetState === undefined || targetState === TARGET_OP.DELTA_TEMP)
      && ((this.__current_state[deviceId].nComError === 0)
        || ((this.__deviceList[deviceId].reliability > 0.5) && (this.__current_state[deviceId].ongoing === false)))) {
      // Update temperature if it changed (unreliable devices will only refresh temp up until a certain point)
      if (this.logUnit === deviceId) this.updateLog(`finished changeDeviceState() for ${device.name} - device onoff state was already correct - now checking temp`, c.LOG_ALL);
      return this.refreshTemp(deviceId);
    }

    // Nothing happened - Everything is ok or Homey is not in synch with the actual device states
    if (this.logUnit === deviceId) this.updateLog(`finished changeDeviceState() for ${device.name} - Nothing happened`, c.LOG_ALL);
    return Promise.resolve([newStateOn === (newState === TARGET_OP.TURN_ON), isOn === (newState === TARGET_OP.TURN_ON)]);
  }

  /**
   * Wrapper function for onNewHour
   * - Whenever called it calculates the time until next hour and starts a timeout function
   */
  async onNewHourWrapper() {
    return this.mutex.runExclusive(async () => this.onNewHour())
      .finally(() => {
        // Start timer to start exactly when a new hour starts
        const now = new Date();
        let timeToNextTrigger = timeToNextHour(now) + 100; // Add 100 usec to make sure the trigger does not trigger too early
        if (timeToNextTrigger < 60000) {
          // If less than a minute to next hour then obviously the trigger has has fired too early
          // See Bug #7 for details
          // Hopefully this code never gets executed as 100 usec is added above
          timeToNextTrigger += 60 * 60 * 1000;
        }
        this.__newHourID = setTimeout(() => this.onNewHourWrapper(), timeToNextTrigger);
        this.updateLog(`New hour in ${String(timeToNextTrigger)} ms (now is: ${String(now)})`, c.LOG_DEBUG);
      });
  }

  /**
   * onNewHour runs whenever a new hour starts + once at the app start
   * if and only if we crossed into a new hour while the app was restarting.
   */
  async onNewHour(isNewHour = true, now = new Date()) {
    if (isNewHour) {
      // Add up missing power
      const lapsedTime = now - this.__current_power_time;
      this.__missing_power_this_hour += (lapsedTime > (1000 * 60 * 5));

      // Crossed into new hour
      const energyOk = this.__power_last_hour !== undefined // If undefined then this is not for the full hour
        && (this.__missing_power_this_hour === 0); // If set then there is more than 5 minutes gap between power reporting

      await this.statsSetLastHourEnergy(this.__accum_energy, energyOk, now);
      this.updateLog(`Hour finalized: ${String(this.__accum_energy)} Wh`, c.LOG_INFO);
      this.__power_last_hour = this.__accum_energy;
      this.__reserved_energy = 0;
      this.__accum_energy = 0;
      this.__current_power_time = new Date(now.getTime());
      this.__missing_power_this_hour = 0;
      this.__accum_since = new Date(now.getTime());
    }

    if (+this.homey.settings.get('operatingMode') !== c.MODE_DISABLED) {
      await this.doPriceCalculations(now)
        .then(() => this.rescheduleCharging(isNewHour))
        .catch(err => {
          // Either the app is not configured yet or the utility price API is not installed, just ignore
          return Promise.resolve();
        });
    }
    // Number of forced off devices can change every hour.
    // Instead of counting it here it is set whenever all devices has been tried to turn off
    // In the meantime it is just set to 0 to prevent the onFreePowerChanged to send out too much free power
    this.__num_forced_off_devices = 0;
  }

  /**
   * onMonitor runs regurarly to monitor the actual state
   * Similar to refreshAllDevices(), but it will only refresh states that are not correct
   */
  async onMonitor() {
    this.updateLog('onMonitor()', c.LOG_INFO);
    if (!this.app_is_configured) {
      // Early exit if the app is not configured
      return Promise.resolve(false);
    }
    // Go through all actions for this new mode;
    const actionLists = this.homey.settings.get('priceActionList');
    const currentPricePoint = +this.homey.settings.get('pricePoint');
    const currentActions = actionLists[currentPricePoint];
    const promises = [];
    for (const deviceId in currentActions) {
      if (!(deviceId in this.__deviceList)) {
        // Apparently the stored settings are invalid and need to be refreshed
        continue;
      }
      const { confirmed } = this.__current_state[deviceId];
      if (confirmed) continue;
      promises.push(Promise.resolve()
        .then(() => {
          const isOngoing = this.__current_state[deviceId].ongoing;
          if (isOngoing) return new Promise(resolve => setTimeout(resolve, 2 * 60 * 1000)); // Give it some time to resolve
          return Promise.resolve();
        })
        .then(() => {
          const isOngoing = this.__current_state[deviceId].ongoing;
          if (isOngoing === true) {
            this.__current_state[deviceId].__monitorError += 1;
          }
          // Go on to confirm device states
          return this.getDevice(deviceId);
        })
        .then(device => {
          if (this.getOnOffCap(deviceId) === undefined) {
            return Promise.reject(new Error('The onoff capability is non-existing, this should never happen.'));
          }
          const { driverId } = this.__deviceList[deviceId];
          if ((driverId in d.DEVICE_CMD) && (d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.CHARGER)) {
            // Just ignore monitoring charger devices for now
            return Promise.resolve(true);
          }
          const isOn = this.getIsOn(device, deviceId);
          const { lastCmd } = this.__current_state[deviceId];
          const onConfirmed = ((lastCmd === TARGET_OP.TURN_ON) && isOn) || ((lastCmd !== TARGET_OP.TURN_ON) && (!isOn));
          if (!onConfirmed) {
            // Try to change the on state.....
            this.__current_state[deviceId].__monitorFixOn += 1;
            const newOp = this.__current_state[deviceId].lastCmd;
            return this.changeDeviceState(deviceId, newOp)
              .then(() => this.refreshTemp(deviceId))
              .then(() => {
                return Promise.resolve(false);
              });
          }
          if ((!isOn) || (!this.__deviceList[deviceId].thermostat_cap)) {
            this.__current_state[deviceId].confirmed = 2;
            this.__current_state[deviceId].nComError = 0; // nComError must have been set in error
            return Promise.resolve(true);
          }
          // Thermostat capabilities
          const tempConfirmed = this.__current_state[deviceId].temp && (device.capabilitiesObj[this.getTempSetCap(deviceId)].value === this.__current_state[deviceId].temp);
          if (tempConfirmed) {
            this.__current_state[deviceId].confirmed = 3;
            this.__current_state[deviceId].nComError = 0; // nComError must have been set in error
            return Promise.resolve(true);
          }
          // Try to change the temp state.....
          this.__current_state[deviceId].__monitorFixTemp += 1;
          return this.refreshTemp(deviceId)
            .then(() => {
              return Promise.resolve(false);
            });
        })
        .catch(err => {
          // Ignore the error, just count the error for statistics
          // A fix will be attempted next time the monitor runs anyway
          this.__current_state[deviceId].__monitorError += 1;
          return Promise.resolve(false);
        }));
    }

    return Promise.all(promises)
      .then(values => {
        let allOk = true;
        for (let i = 0; i < values.length; i++) {
          allOk &&= values[i];
        }
        this.updateLog(`Monitor completed with state: ${allOk}`, c.LOG_DEBUG);
        return Promise.resolve(allOk);
      })
      .catch(error => {
        this.__monitorError += 1;
        this.updateLog(`Monitor failed to inspect devices: ${error}`, c.LOG_ERROR);
        return Promise.resolve(false); // Ignore errors as this is for monitoring
      });
  }

  /**
   * onPowerUpdate is the action called whenever the power is updated from the power meter
   * Must never be called when operatingMode is set to Disabled
   */
  async onPowerUpdate(newPower, now = new Date()) {
    if (Number.isNaN(+newPower)) {
      // If newPower is invalid or app is not configured just ignore it
      return Promise.resolve();
    }
    const remainingTime = timeToNextHour(now);
    if (this.__current_power === undefined) {
      // First time called ever
      this.__accum_energy = 0;
      this.__offeredEnergy = 0;
    } else {
      let lapsedTime = now - this.__current_power_time;
      const energyUsed = (this.__current_power * lapsedTime) / (1000 * 60 * 60);
      this.__missing_power_this_hour += (lapsedTime > (1000 * 60 * 5));
      const timeWithinHour = timeSinceLastHour(now);
      if (lapsedTime > timeWithinHour) lapsedTime = timeWithinHour;
      this.__accum_energy += energyUsed;
      const energyOffered = (this.__charge_power_active * lapsedTime) / (1000 * 60 * 60);
      this.__offeredEnergy += energyOffered; // Offered or given, depending on flow or device
    }
    this.__energy_meter_detected_time = new Date(now.getTime());
    this.__current_power_time = new Date(now.getTime());
    this.__current_power = newPower;
    this.__power_estimated = (isSameHour(now, this.__accum_since) ? this.__accum_energy : 0) + (newPower * remainingTime) / (1000 * 60 * 60);

    // Check if power can be increased or reduced
    const errorMargin = this.homey.settings.get('errorMargin') ? (parseInt(this.homey.settings.get('errorMargin'), 10) / 100) : 0;
    const trueMaxPower = this.homey.settings.get('maxPower');
    const errorMarginWatts = trueMaxPower * errorMargin;
    const maxPower = trueMaxPower - errorMarginWatts;
    const safetyPower = +this.homey.settings.get('safetyPower');
    const crossHourSmooth = (+this.homey.settings.get('crossHourSmooth') / 100) * (maxPower - this.__accum_energy);
    const negativeReserve = crossHourSmooth * (1 - (timeSinceLastHour(now) / 3600000));

    this.updateLog(`${'onPowerUpdate: '
      + 'Using: '}${String(newPower)}W, `
      + `Accum: ${String(this.__accum_energy.toFixed(2))} Wh, `
      + `Limit: ${String(maxPower)} Wh, `
      + `Reserved: ${String(Math.ceil(this.__reserved_energy + safetyPower))}W, `
      + `Smoothing: ${String(Math.ceil(negativeReserve))}W, `
      + `(Estimated end: ${String(this.__power_estimated.toFixed(2))})`, c.LOG_DEBUG);

    // Try to control devices if the power is outside of the preferred bounds
    let powerDiff = (((maxPower - this.__accum_energy - this.__reserved_energy) * (1000 * 60 * 60)) / remainingTime) - newPower - safetyPower + negativeReserve;
    const mainFuse = this.homey.settings.get('mainFuse'); // Amps
    const maxDrain = Math.round(1.732050808 * 230 * mainFuse);
    const maxFreeDrain = ((isNumber(maxDrain) && (maxDrain > 0)) ? maxDrain : (trueMaxPower * 10)) - newPower;
    if (powerDiff > maxFreeDrain) {
      powerDiff = maxFreeDrain; // Cannot use more than the main fuse
    }
    if (powerDiff < -maxDrain) {
      powerDiff = -maxDrain; // If this is the case then we have most likely crossed the power roof already for this hour.
    }
    // Report free capacity:
    this.onFreePowerChanged(powerDiff + safetyPower);
    let promise;
    if (powerDiff < 0) {
      promise = this.onAbovePowerLimit(-powerDiff, errorMarginWatts + safetyPower, now)
        .catch(() => resolve()); // Ignore failures
    } else if (powerDiff > 0) {
      promise = this.onBelowPowerLimit(powerDiff, now)
        .catch(() => resolve()); // Ignore failures
    }
    return promise;
  }

  /**
   * onModeUpdate is called whenever the operation mode is changed
   * 0 = off
   * 1+ = modes 0+
   */
  async onModeUpdate(newMode) {
    const oldMode = +this.homey.settings.get('operatingMode');
    const modeList = this.homey.settings.get('modeList');
    if (newMode < 0) {
      newMode = 0;
    }
    // ===== Workaround code #1, remove in a future version =====
    if (+newMode >= 40 && +newMode <= 44) {
      const modeNames = this.homey.settings.get('modeNames');
      const modeId = +newMode % 40;
      this.homey.notifications.createNotification({
        excerpt: 'The flow card you\'re using for setting operating mode is broken. '
        + 'The bug has been fixed but you need to delete the old flow card and recreate it in order for correct operation in the future. '
        + `The flow card in question is trying to change mode to ${modeNames[modeId]}`
      });
      newMode = 4 + +modeId;
      this.updateLog(`Bugfix for broken flow card, changed mode to: ${newMode} (was 4${modeId})`, c.LOG_ERROR);
    }
    // ===== Workaround code #1 end =====
    if (newMode > modeList.length) {
      newMode = modeList.length;
    }
    if (newMode === oldMode) {
      return Promise.resolve();
    }
    this.updateLog(`Changing the current mode to: ${String(newMode)}`, c.LOG_INFO);
    this.homey.settings.set('operatingMode', newMode);
    if (+newMode === c.MODE_DISABLED) {
      return Promise.resolve([true, true]);
    }
    return this.refreshAllDevices();
  }

  /**
   * onZoneUpdate is called whenever a zone is turned on/off
   */
  async onZoneUpdate(zone, enabled) {
    this.updateLog(`Changing zone ${zone.name} (ID: ${zone.id}) to ${String(enabled)}`, c.LOG_INFO);
    let activeZones = this.homey.settings.get('zones');
    if (activeZones === null) {
      activeZones = {};
    }
    activeZones[zone.id] = {
      name: zone.name,
      enabled
    };
    this.homey.settings.set('zones', activeZones);

    // Go through all controllable devices
    const promises = [];
    for (const deviceId in this.__deviceList) {
      if (this.__deviceList[deviceId].use
        && this.__deviceList[deviceId].memberOf.includes(zone.id)) {
        promises.push(this.changeDeviceState(deviceId, enabled ? undefined : TARGET_OP.TURN_OFF));
      }
    }

    // Resolve if the devices was turned on/off correctly
    return Promise.all(promises)
      .then(values => {
        let allOk = true;
        for (let i = 0; i < values.length; i++) {
          allOk &&= values[i][0];
        }
        return Promise.resolve(allOk);
      })
      .catch(error => Promise.reject(new Error(`Unknown error: ${error}`))); // Should never happen
  }

  /**
   * onPricePointUpdate is called whenever the price point is changed
   */
  async onPricePointUpdate(newMode) {
    // Do not continue if price points are disabled:
    if (+this.homey.settings.get('priceMode') === c.PRICE_MODE_DISABLED) {
      return Promise.resolve();
    }
    if (this.gotPPFromFlow === undefined) {
      // Store it in settings as well so it is remembered across reboots, but don't save settings all the time
      this.homey.settings.set('gotPPFromFlow', true);
      this.gotPPFromFlow = true;
    }
    // Do not continue if the price point did not change
    const oldPricePoint = this.homey.settings.get('pricePoint');
    this.statsSetLastHourPricePoint(+oldPricePoint);
    if ((+newMode === +oldPricePoint) && (oldPricePoint !== null)) {
      return Promise.resolve();
    }

    // ==================== LEGACY CODE BEGIN ===========================
    // Find the translation table for price points from the app manifest
    const ppTableOld = [
      { en: 'Low', no: 'Lav' },
      { en: 'Normal', no: 'Normal' },
      { en: 'High', no: 'Høy' },
      { en: 'Extremely high', no: 'Ekstremt høy' },
      { en: 'Dirt cheap', no: 'Grisebillig' }
    ];

    // Send price point trigger
    const pricePointTriggerOld = this.homey.flow.getTriggerCard('price-point-changed');
    const pricePointStringOld = this.homey.__(ppTableOld[newMode]);
    const tokensOld = { pricePoint: pricePointStringOld };
    pricePointTriggerOld.trigger(tokensOld);
    // ==================== LEGACY CODE END ===========================

    // Find the translation table for price points from the app manifest
    let ppTriggerId = 0;
    const keys = this.manifest.flow.actions;
    for (let key = 0; key < keys.length; key++) if (keys[key].id === 'change-piggy-bank-price-point') ppTriggerId = key;
    const keys2 = this.manifest.flow.actions[ppTriggerId].args[0].values;
    const ppTable = keys2.reduce((outTable, item) => { return { ...outTable, [item.id]: item.label }; }, []);

    // Send price point trigger
    const pricePointTrigger = this.homey.flow.getTriggerCard('price-point-changed2');
    const pricePointString = this.homey.__(ppTable[newMode]);
    const tokens = { pricePoint: pricePointString };
    pricePointTrigger.trigger(tokens);

    this.updateLog(`Changing the current price point to: ${String(newMode)}`, c.LOG_INFO);
    this.homey.settings.set('pricePoint', newMode);
    return this.refreshAllDevices();
  }

  /**
   * onMaxUsageUpdate is called whenever the max usage per hour is changed
   */
  async onMaxUsageUpdate(newVal) {
    this.updateLog(`Changing the max usage per hour to: ${String(newVal)}`, c.LOG_INFO);
    this.homey.settings.set('maxPower', newVal);
  }

  /**
   * onSafetyPowerUpdate is called whenever the safety power is changed
   */
  async onSafetyPowerUpdate(newVal) {
    this.updateLog(`Changing the current safety power to: ${String(newVal)}`, c.LOG_INFO);
    this.homey.settings.set('safetyPower', newVal);
  }

  /**
   * onFreePowerChanged is called whenever the amount of free power has changed
   */
  async onFreePowerChanged(powerDiff, now = new Date()) {
    // this.log(`OnFreePowerChanged(${powerDiff})`);
    const freeThreshold = +this.homey.settings.get('freeThreshold') || 100;
    const listOfUsedDevices = this.homey.settings.get('frostList') || {};
    const numDevices = Object.keys(listOfUsedDevices).length;
    const percentDevicesOn = (this.__num_off_devices === this.__num_forced_off_devices) ? 100 : (100 * ((numDevices - this.__num_off_devices) / numDevices));
    if (powerDiff < 0) {
      this.__free_capacity = 0;
    } else if (percentDevicesOn >= freeThreshold) {
      this.__free_capacity = powerDiff;
    } else {
      this.__free_capacity = 0;
    }
    // Trigger charger flows
    const chargerOptions = this.homey.settings.get('chargerOptions');
    if (chargerOptions.chargeTarget === c.CHARGE_TARGET_FLOW) {
      const isOn = this.__charger_flow_is_on;
      const isEmergency = (+powerDiff < 0) && ((this.__charge_power_active + +powerDiff) < 0);
      const now = new Date();
      const end = new Date(chargerOptions.chargeEnd);
      if ((end < now)
        || ((chargerOptions.chargeCycleType === c.OFFER_ENERGY) && (+chargerOptions.chargeRemaining < this.__offeredEnergy))) {
        chargerOptions.chargeRemaining = 0;
      }
      const withinChargingPlan = (this.__charge_plan[0] > 0) && (+chargerOptions.chargeRemaining > 0);
      const wantOn = (isOn || (+powerDiff > 0)) && withinChargingPlan && !isEmergency;
      const timeLapsed = (now - this.prevChargerTime) / 1000; // Lapsed time in seconds
      const waitUpdate = (this.prevChargerTime !== undefined) && (timeLapsed < chargerOptions.minToggleTime) && (!isEmergency);
      if ((!waitUpdate) && ((chargerOptions.chargeRemaining > 0) || this.__charger_flow_is_on)) {
        this.prevChargerTime = new Date(now.getTime());
        const maxPower = +this.homey.settings.get('maxPower');
        const newOfferPower = Math.min(Math.max(this.__charge_power_active + +powerDiff, +chargerOptions.chargeMin), maxPower);
        if (wantOn && !isOn && (+powerDiff >= chargerOptions.chargeThreshold)) {
          const startChargingTrigger = this.homey.flow.getTriggerCard('start-charging');
          const tokens = { offeredPower: newOfferPower };
          startChargingTrigger.trigger(tokens);
          this.__charge_power_active = newOfferPower;
          this.__charger_flow_is_on = true;
        } else if (wantOn && isOn) {
          const changeChargingPowerTrigger = this.homey.flow.getTriggerCard('change-charging-power');
          const tokens = { offeredPower: newOfferPower };
          changeChargingPowerTrigger.trigger(tokens);
          this.__charge_power_active = newOfferPower;
        } else if (isOn && !wantOn) {
          const stopChargingTrigger = this.homey.flow.getTriggerCard('stop-charging');
          stopChargingTrigger.trigger();
          this.__charge_power_active = 0;
          this.__charger_flow_is_on = false;
        }
      }
    }
    // Prevent the trigger from triggering more than once a minute
    const timeSinceLastTrigger = now - this.__free_power_trigger_time;
    if (!timeSinceLastTrigger > (60 * 1000)) {
      this.__free_power_trigger_time = now;
      const freePowerTrigger = this.homey.flow.getTriggerCard('free-power-changed');
      const tokens = { freePower: Math.round(this.__free_capacity) };
      const state = tokens;
      return freePowerTrigger.trigger(tokens, state);
    }
    return Promise.resolve();
  }

  /**
   * onBelowPowerLimit is called whenever power changed and we're allowed to use more power
   */
  async onBelowPowerLimit(morePower, now = new Date()) {
    this.updateLog(`Below power Limit: ${morePower}`, c.LOG_DEBUG);
    morePower = Math.round(morePower);
    // Reset the power alarm as we now have sufficient power available
    this.__alarm_overshoot = false;

    // If power was turned _OFF_ within the last 1-5 minutes then abort turning on anything.
    // The waiting time is 5 minutes at the beginning of an hour and reduces gradually to 1 minute for the last 5 minutes
    // This is to avoid excessive on/off cycles of high power devices such as electric car chargers
    this.__last_power_on_time = new Date(now.getTime());
    const timeLeftInHour = timeToNextHour(this.__last_power_on_time);
    const powerCycleInterval = (timeLeftInHour > TIME_FOR_POWERCYCLE_MAX) ? WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MAX
      : (timeLeftInHour < TIME_FOR_POWERCYCLE_MIN) ? WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MIN
        : (WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MIN + (WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MAX - WAIT_TIME_TO_POWER_ON_AFTER_POWEROFF_MIN)
          * ((timeLeftInHour - TIME_FOR_POWERCYCLE_MIN) / (TIME_FOR_POWERCYCLE_MAX - TIME_FOR_POWERCYCLE_MIN)));

    const timeSincePowerOff = this.__last_power_on_time - this.__last_power_off_time;
    if (timeSincePowerOff < powerCycleInterval) {
      this.updateLog(`Could use ${String(morePower)} W more power but was aborted due to recent turn off activity. Remaining wait = ${String((5 * 60 * 1000 - timeSincePowerOff) / 1000)} s`,
        c.LOG_DEBUG);
      return Promise.resolve();
    }
    this.updateLog(`Can use ${String(morePower)}W more power`, c.LOG_DEBUG);

    const modeList = this.homey.settings.get('modeList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    const numDevices = currentModeList.length;
    const reorderedModeList = [...currentModeList]; // Make sure all devices with communication errors are handled last (e.g. in case nothing else was possible)
    reorderedModeList.sort((a, b) => { // Err last
      return this.__current_state[a.id].nComError
        - this.__current_state[b.id].nComError;
    });
    // Turn on devices from top down in the priority list
    // Only turn on one device at the time
    let numForcedOffDevices = 0;
    for (let idx = 0; idx < numDevices; idx++) {
      const deviceId = reorderedModeList[idx].id;
      if (!(deviceId in this.__deviceList)) {
        // Apparently the stored settings are invalid and need to be refreshed
        continue;
      }
      // Check if the on state complies with the settings
      const operation = await this.applyModeOverride(reorderedModeList[idx].operation, deviceId);
      switch (operation) {
        case MAIN_OP.CONTROLLED:
        case MAIN_OP.ALWAYS_ON:
          // Always on is overridden by price actions
          try {
            let success; let noChange;
            const { driverId } = this.__deviceList[deviceId];
            if ((driverId in d.DEVICE_CMD) && (d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.CHARGER)) {
              [success, noChange] = await this.changeDevicePower(deviceId, morePower);
            } else {
              [success, noChange] = await this.changeDeviceState(deviceId, undefined);
            }
            if (success && !noChange) {
              // Sucessfully Turned on
              this.updateLog('Turn on success', c.LOG_DEBUG);
              return Promise.resolve();
            } // else try to modify another device
            if (!success) {
              numForcedOffDevices++;
            }
          } catch (err) {
            this.updateLog(`Error ${err}`, c.LOG_DEBUG);
            return Promise.reject(new Error(`Unknown error: ${err}`));
          }
          break;
        case MAIN_OP.ALWAYS_OFF:
          // Keep off / let it be on if it has been overridden by a user
          break;
        default:
          this.updateLog(`Invalid op: ${reorderedModeList[idx].operation}`, c.LOG_ERROR);
          return Promise.reject(new Error('Invalid operation'));
      }
    }
    // If this point was reached then all devices are on and still below power limit
    this.updateLog('Reached end without anything to turn on', c.LOG_DEBUG);
    this.__num_off_devices = numForcedOffDevices; // Reset the off counter in case it was incorrect
    this.__num_forced_off_devices = numForcedOffDevices;
    return Promise.resolve();
  }

  /**
   * onAbovePowerLimit is called whenever the power changed and we need to reduce it
   */
  async onAbovePowerLimit(lessPower, marginWatts, now = new Date()) {
    lessPower = Math.ceil(lessPower);

    // Do not care whether devices was just recently turned on
    this.__last_power_off_time = new Date(now.getTime());

    const modeList = this.homey.settings.get('modeList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    const numDevices = currentModeList.length;
    const reorderedModeList = [...currentModeList]; // Make sure all devices with communication errors are handled last (e.g. in case nothing else was possible)
    reorderedModeList.sort((a, b) => { // Err first
      return this.__current_state[b.id].nComError
        - this.__current_state[a.id].nComError;
    });
    // Turn off devices from bottom and up in the priority list
    // Only turn off one device at the time
    let numForcedOnDevices;
    for (let isEmergency = 0; isEmergency < 2; isEmergency++) {
      this.updateLog(`Running turn-off-cycle in ${isEmergency ? 'Emergency mode' : 'Normal mode'}`, c.LOG_DEBUG);
      numForcedOnDevices = 0;
      for (let idx = numDevices - 1; idx >= 0; idx--) {
        const deviceId = reorderedModeList[idx].id;
        const operation = (isEmergency === 0) ? TARGET_OP.TURN_OFF : TARGET_OP.EMERGENCY_OFF;
        // Try to turn the device off regardless, it might be blocked by the state
        if (!(deviceId in this.__deviceList)) {
          // Apparently the stored settings are invalid and need to be refreshed
          continue;
        }
        try {
          let success; let noChange;
          const { driverId } = this.__deviceList[deviceId];
          if ((driverId in d.DEVICE_CMD) && (d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.CHARGER)) {
            [success, noChange] = await this.changeDevicePower(deviceId, -lessPower);
          } else {
            [success, noChange] = await this.changeDeviceState(deviceId, operation);
          }
          if (success && !noChange) {
            // Sucessfully Turned off
            this.updateLog('Claims to have turned off device successfully', c.LOG_DEBUG);
            return Promise.resolve();
          }
          if (!success) {
            numForcedOnDevices++;
          }
        } catch (err) {
          this.updateLog(`Error while trying to power down: ${err}`, c.LOG_ERROR);
          return Promise.reject(new Error(`Unknown error: ${err}`));
        }
      }
    }

    // If this point was reached then all devices are off and still above power limit
    const errorString = `Failed to reduce power usage by ${String(lessPower)}W (number of forced on devices: ${String(numForcedOnDevices)})`;
    this.updateLog(errorString, c.LOG_ERROR);
    // Alert the user, but not if first hour since app was started or we are within the error margin. Only send one alert before it has been resolved
    // const firstHourEver = this.__reserved_energy > 0;
    if (/* !firstHourEver && */ (lessPower > marginWatts) && !this.__alarm_overshoot) {
      this.__alarm_overshoot = true;
      // this.homey.notifications.createNotification({ excerpt: `Alert: The power must be reduced by ${String(lessPower)} W immediately or the hourly limit will be breached` });
      const alertTrigger = this.homey.flow.getTriggerCard('unable-to-limit-power');
      const tokens = { excessPower: Math.round(lessPower) };
      alertTrigger.trigger(tokens);
    }
    this.__num_off_devices = numDevices - numForcedOnDevices; // Reset off counter in case it was wrong
    return Promise.reject(new Error(errorString));
  }

  /**
   * This is called whenever the override action flow has been started
   */
  async onOverrideChanged(deviceId, forcedState) {
    const frostList = this.homey.settings.get('frostList') || {};
    if (!(deviceId in frostList)) {
      return Promise.reject(new Error('This device is not controllable and cannot be overridden.'));
    }
    const override = this.homey.settings.get('override') || {};
    override[deviceId] = forcedState;
    const device = await this.getDevice(deviceId);
    let promise;
    switch (+forcedState) {
      case c.OVERRIDE.CONTROLLED:
        promise = this.changeDeviceState(deviceId, undefined); // Controlled
        break;
      case c.OVERRIDE.NONE:
        delete override[deviceId];
        promise = this.changeDeviceState(deviceId, undefined); // Go back to default state
        break;
      case c.OVERRIDE.ON:
        promise = this.setOnOff(device, deviceId, true);
        break;
      case c.OVERRIDE.OFF:
      case c.OVERRIDE.OFF_UNTIL_MANUAL_ON:
        promise = this.setOnOff(device, deviceId, false);
        break;
      case c.OVERRIDE.MANUAL_TEMP: // This only means do not touch the temperature
      case c.OVERRIDE.FROST_GUARD: // Actually not enabled as input to the flow
      default:
        promise = Promise.resolve(true);
        break;
    }
    this.homey.settings.set('override', override);
    // Resolve to true even on error because the override has been stopped and as such will the error resolve later
    return promise.then(() => Promise.resolve(true));
  }

  /**
   * Called when the user initiates a charging cycles through a flow
   * @param offerEnergy number of kWh to offer before time runs out (will be undefined if offerHours)
   * @param endTime the localtime for when to end charging
   * @param offerHours number of hours to offer energy before time runs out (will be undefined if offerEnergy)
   */
  async onChargingCycleStart(offerEnergy, endTime, offerHours = undefined, now = new Date()) {
    if ((typeof (endTime) !== 'string') || (!endTime.includes(':'))) {
      return Promise.reject(new Error(this.homey.__('warnings.notValidTime')));
    }
    const hoursEnd = +endTime.split(':').at(0);
    const minutesEnd = +endTime.split(':').at(1);
    if (hoursEnd < 0 || hoursEnd > 23 || Number.isNaN(hoursEnd)
      || minutesEnd < 0 || minutesEnd > 59 || Number.isNaN(minutesEnd)) {
      return Promise.reject(new Error(this.homey.__('warnings.notValidTime')));
    }

    this.updateLog('Charging cycle started', c.LOG_INFO);
    this.__spookey_check_activated = undefined;
    this.__spookey_changes = 0;
    const chargerOptions = this.homey.settings.get('chargerOptions');
    if (chargerOptions) {
      // Convert local end time to UTC
      const nowLocal = toLocalTime(now, this.homey);
      const minutesDiff = timeDiff(nowLocal.getHours(), nowLocal.getMinutes(), hoursEnd, minutesEnd);
      const endTimeUTC = new Date(now.getTime());
      endTimeUTC.setUTCMinutes(endTimeUTC.getUTCMinutes() + minutesDiff, 0, 0);
      chargerOptions.chargeRemaining = offerEnergy ? (offerEnergy * 1000) : +offerHours;
      chargerOptions.chargeCycleType = offerEnergy ? c.OFFER_ENERGY : c.OFFER_HOURS;
      chargerOptions.chargeEnd = endTimeUTC;
      this.homey.settings.set('chargerOptions', chargerOptions);
    }
    await this.rescheduleCharging(false, now);
    return Promise.resolve();
  }

  /**
   * Only called when stopping the charging cycle ahead of time
   */
  async onChargingCycleStop() {
    this.updateLog('Charging cycle abruptly ended', c.LOG_INFO);
    const chargerOptions = this.homey.settings.get('chargerOptions');
    if (chargerOptions) {
      chargerOptions.chargeRemaining = 0;
      this.homey.settings.set('chargerOptions', chargerOptions);
      this.rescheduleCharging(false);
    } else {
      this.__charge_plan = [];
      throw new Error('No charging cycle was to stop');
    }
  }

  /**
   * Called every hour to make sure the Charging is rescheduled most optimal.
   * Whenever a new hour passes, must be called _after_ doPriceCalculations to get correct current_price_index
   */
  async rescheduleCharging(isNewHour, now = new Date()) {
    const chargerOptions = this.homey.settings.get('chargerOptions');
    if (isNewHour) {
      const oldRemaining = chargerOptions.chargeRemaining;
      if (chargerOptions.chargeCycleType === c.OFFER_ENERGY) {
        chargerOptions.chargeRemaining -= this.__offeredEnergy;
        this.__offeredEnergy = 0;
      } else if (this.__charge_plan[0] > 0) {
        // OFFER_HOURS - Only subtract for active hours
        chargerOptions.chargeRemaining -= 1;
      }
      if (chargerOptions.chargeRemaining < 0) chargerOptions.chargeRemaining = 0;
      if (oldRemaining !== 0) this.homey.settings.set('chargerOptions', chargerOptions);
    }

    // Reset charge plan
    this.__charge_plan = [];

    // Ignore rescheduling if there is nothing left to schedule
    if (chargerOptions.chargeRemaining === 0) return Promise.resolve();

    // Calculate new charging plan
    const startOfHour = new Date(now.getTime());
    startOfHour.setUTCMinutes(0, 0, 0);
    const end = new Date(chargerOptions.chargeEnd);
    const timespan = Math.min((end - startOfHour) / (60 * 60 * 1000), 24); // timespan to plan in hours
    const priceArray = this.__current_prices.slice(this.__current_price_index, this.__current_price_index + Math.floor(timespan));
    if (priceArray.length < Math.ceil(timespan)) {
      // Too few prices available, use average as future
      const futurePrice = +this.homey.settings.get('averagePrice') || this.__current_prices[this.__current_price_index];
      while (priceArray.length < Math.ceil(timespan)) {
        priceArray.push(futurePrice);
      }
    }
    const maxPower = this.homey.settings.get('maxPower');
    const priceSorted = Array.from(priceArray.keys()).sort((a, b) => ((priceArray[a] === priceArray[b]) ? (a - b) : (priceArray[a] - priceArray[b])));
    let scheduleRemaining = chargerOptions.chargeRemaining;
    for (let i = 0; (i < priceSorted.length) && (scheduleRemaining > 0); i++) {
      const idx = priceSorted[i];
      const estimatedPower = maxPower * 0.75; // Assume 75% available to the charger
      this.__charge_plan[idx] = estimatedPower;
      scheduleRemaining -= chargerOptions.chargeCycleType === c.OFFER_ENERGY ? estimatedPower : 1;
    }
    return Promise.resolve();
  }

  findModeIdx(deviceId) {
    const modeList = this.homey.settings.get('modeList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const currentModeList = modeList[currentMode - 1];
    for (let i = 0; i < currentModeList.length; i++) {
      if (currentModeList[i].id === deviceId) {
        return i;
      }
    }
    return null; // Nothing found
  }

  /**
   * Find the new target temperature for a device
   * @return [success, noChange] - success means that the result is as requested, noChange indicate if the result was already as requested
   */
  async refreshTemp(deviceId) {
    // Do not refresh temperature if the temperature control is disabled
    if (+this.homey.settings.get('controlTemp') === 0) {
      if (this.logUnit === deviceId) this.updateLog(`aborted refreshTemp() for '${deviceId} - Temperature control has been disabled`, c.LOG_ALL);
      return Promise.resolve([true, true]);
    }
    const modeList = this.homey.settings.get('modeList');
    const frostList = this.homey.settings.get('frostList');
    const currentMode = +this.homey.settings.get('operatingMode');
    const actionLists = this.homey.settings.get('priceActionList');
    const actionListIdx = +this.homey.settings.get('pricePoint');
    const currentModeList = modeList[currentMode - 1];
    const modeIdx = this.findModeIdx(deviceId);
    const modeTemp = +currentModeList[modeIdx].targetTemp;
    const currentAction = actionLists[actionListIdx][deviceId]; // Action state: .operation
    const currentPriceMode = +this.homey.settings.get('priceMode');
    const deltaTemp = ((currentPriceMode !== c.PRICE_MODE_DISABLED) && (currentAction.operation === TARGET_OP.DELTA_TEMP)) ? +currentAction.delta : 0;
    return this.getDevice(deviceId)
      .then(device => {
        if (this.logUnit === deviceId) this.updateLog(`attempt refreshTemp() for ${device.name}`, c.LOG_ALL);
        if (this.getOnOffCap(deviceId) === undefined) {
          if (this.logUnit === deviceId) this.updateLog(`aborted refreshTemp() for ${device.name} - No onoff cap???`, c.LOG_ALL);
          return Promise.reject(new Error('The onoff capability is non-existing, this should never happen.'));
        }
        const isOn = this.getIsOn(device, deviceId);
        if (isOn === undefined) {
          // This most likely happens when a driver has been disabled
          this.updateLog(`Refreshtemp: isOn was set to undefined for device ${device.name}`, c.LOG_ERROR);
          return Promise.resolve([false, true]);
        }
        if (!isOn) {
          if (this.logUnit === deviceId) this.updateLog(`aborted refreshTemp() for ${device.name} - Device is off`, c.LOG_ALL);
          return Promise.resolve([true, true]);
        }
        const tempSetCap = this.getTempSetCap(deviceId);
        const tempGetCap = this.getTempGetCap(deviceId);
        const hasTargetTemp = device.capabilities.includes(tempSetCap);
        const hasMeasureTemp = device.capabilities.includes(tempGetCap);
        if ((!hasTargetTemp) || (!hasMeasureTemp)) {
          if (this.logUnit === deviceId) this.updateLog(`aborted refreshTemp() for ${device.name} - Device does not have temperature capabilities`, c.LOG_ALL);
          return Promise.resolve([true, true]);
        }
        const frostGuardActive = this.isFrostGuardActive(device, deviceId);
        let newTemp = frostGuardActive ? +frostList[deviceId].minTemp : (modeTemp + deltaTemp);
        const minTemp = this.getTempCapMin(device, deviceId);
        const maxTemp = this.getTempCapMax(device, deviceId);
        if (newTemp < minTemp) newTemp = minTemp;
        if (newTemp > maxTemp) newTemp = maxTemp;
        this.__current_state[deviceId].temp = newTemp;
        if (device.capabilitiesObj[tempSetCap].value === newTemp) {
          if (this.logUnit === deviceId) this.updateLog(`finished refreshTemp() for ${device.name} - Old temperature was equal to new one ${newTemp}`, c.LOG_ALL);
          return Promise.resolve([true, true]);
        }
        this.__current_state[deviceId].ongoing = true;
        this.__current_state[deviceId].confirmed = false;
        const override = this.homey.settings.get('override') || {};
        if (override[deviceId] === c.OVERRIDE.MANUAL_TEMP) {
          if (this.logUnit === deviceId) this.updateLog(`aborted refreshTemp() for ${device.name} - Manual override`, c.LOG_ALL);
          return Promise.resolve([true, true]);
        }
        if (this.logUnit === deviceId) this.updateLog(`Setting Device ${device.name}.${tempSetCap} = ${newTemp} | Origin RefreshTemp(${modeTemp} + ${deltaTemp})`, c.LOG_ALL);
        return device.setCapabilityValue({ capabilityId: tempSetCap, value: newTemp })
          .then(() => Promise.resolve([true, false]));
      })
      .then(([success, noChange]) => {
        this.updateReliability(deviceId, 1);
        this.__current_state[deviceId].nComError = 0;
        this.__current_state[deviceId].ongoing = false;
        if (this.logUnit === deviceId) this.updateLog(`finished refreshTemp() for '${deviceId} - Success`, c.LOG_ALL);
        return Promise.resolve([success, noChange]);
      }).catch(error => {
        this.statsCountFailedTempChange();
        this.updateReliability(deviceId, 0);
        this.__current_state[deviceId].nComError += 1;
        this.__current_state[deviceId].ongoing = undefined;
        this.updateLog(`Failed to set temperature for device ${this.__deviceList[deviceId].name}, will retry later (${error})`, c.LOG_ERROR);
        if (this.logUnit === deviceId) this.updateLog(`aborted refreshTemp() for '${deviceId} - Failure ${error}`, c.LOG_ALL);
        return Promise.resolve([false, false]); // The unresolved part is solved by the later nComError handling
      });
  }

  /**
   * Refreshes the state of all devices. It will be called when the state has changed
   * This will trigger a full refresh of all the devices.
   */
  async refreshAllDevices() {
    const currentPricePoint = +this.homey.settings.get('pricePoint');
    const currentPriceMode = +this.homey.settings.get('priceMode');

    // Go through all actions for this new mode;
    const actionLists = this.homey.settings.get('priceActionList');
    const currentActions = actionLists[currentPricePoint];
    const promises = [];
    for (const deviceId in currentActions) {
      if (!(deviceId in this.__deviceList)) {
        // Apparently the stored settings are invalid and need to be refreshed
        this.updateLog('A device has been deleted after setup was saved last time, please enter the setup and save the updated config');
        continue;
      }
      const operation = (currentPriceMode === c.PRICE_MODE_DISABLED) ? undefined : currentActions[deviceId].operation;
      switch (operation) {
        case TARGET_OP.TURN_ON:
        case TARGET_OP.TURN_OFF:
        case TARGET_OP.DELTA_TEMP: // Delta temp will abort if the device is off so run changeDevicestate instead
        case undefined: // undefined only means leave it to the changeDeviceState function to decide the operation
          promises.push(this.changeDeviceState(deviceId, operation));
          break;
        case TARGET_OP.IGNORE:
        case TARGET_OP.EMERGENCY_OFF:
          // Ignore the device state, it should only be turned off in case of emergency
          break;
        default:
          promises.push(Promise.reject(new Error('Invalid Action')));
          break;
      }
    }
    return Promise.all(promises)
      .then(values => {
        let allOk = true;
        for (let i = 0; i < values.length; i++) {
          allOk &&= values[i][0];
        }
        return Promise.resolve(allOk);
      })
      .catch(error => Promise.reject(error));
  }

  /** ****************************************************************************************************
   * Device handling
   ** ****************************************************************************************************
   */
  getTempSetCap(deviceId) {
    try {
      return d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setTempCap;
    } catch (err) {
      return 'target_temperature';
    }
  }

  getTempCapMin(device, deviceId) {
    try {
      const definedCap = d.DEVICE_CMD[this.__deviceList[deviceId].driverId].tempMin;
      if (definedCap === undefined) throw new Error(); // Fall back to the capability.min
      return definedCap;
    } catch (err) {
      try {
        return device.capabilitiesObj[this.getTempSetCap(deviceId)].min;
      } catch (err2) {
        return 5;
      }
    }
  }

  getTempCapMax(device, deviceId) {
    try {
      const definedCap = d.DEVICE_CMD[this.__deviceList[deviceId].driverId].tempMax;
      if (definedCap === undefined) throw new Error(); // Fall back to the capability.max
      return definedCap;
    } catch (err) {
      try {
        return device.capabilitiesObj[this.getTempSetCap(deviceId)].max;
      } catch (err2) {
        return 30;
      }
    }
  }

  getTempGetCap(deviceId) {
    try {
      return d.DEVICE_CMD[this.__deviceList[deviceId].driverId].readTempCap;
    } catch (err) {
      return 'measure_temperature';
    }
  }

  getOnOffCap(deviceId) {
    try {
      const onOffCap = d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setOnOffCap;
      if (typeof onOffCap === 'object') {
        // The devicelist onoff cap should already have been set for this
        return this.__deviceList[deviceId].onoff_cap;
      }
      return onOffCap;
    } catch (err) {
      return this.__deviceList[deviceId].onoff_cap;
    }
  }

  getOnOffTrue(deviceId) {
    try {
      const onOffValue = d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setOnValue;
      if (typeof onOffValue === 'object') {
        // The devicelist onoff cap should already have been set for this
        return onOffValue[this.getOnOffCap(deviceId)];
      }
      return onOffValue;
    } catch (err) {
      return true;
    }
  }

  getOnOffFalse(deviceId) {
    try {
      const onOffValue = d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setOffValue;
      if (typeof onOffValue === 'object') {
        // The devicelist onoff cap should already have been set for this
        return onOffValue[this.getOnOffCap(deviceId)];
      }
      return onOffValue;
    } catch (err) {
      return false;
    }
  }

  getIsOn(device, deviceId) {
    if (device.capabilitiesObj === null) return undefined;
    const onOffCap = this.getOnOffCap(deviceId);
    if (onOffCap === null) {
      // Heater without off option, treat off as min temperature
      const targetTempCap = d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setTempCap;
      if (!(targetTempCap in device.capabilitiesObj)) return undefined;
      const offTemp = (d.DEVICE_CMD[this.__deviceList[deviceId].driverId].tempMin - 1);
      return device.capabilitiesObj[targetTempCap].value !== offTemp;
    }
    if (!(onOffCap in device.capabilitiesObj)) return undefined;
    const onValue = device.capabilitiesObj[onOffCap].value;
    if (onValue === this.getOnOffTrue(deviceId)) return true;
    if (onValue === this.getOnOffFalse(deviceId)) return false;
    return undefined;
  }

  async setOnOff(device, deviceId, onOff) {
    if (this.logUnit === deviceId) this.updateLog(`attempt setOnOff(${onOff}) for ${device.name}`, c.LOG_ALL);
    let onOffCap = this.getOnOffCap(deviceId);
    let onOffValue = onOff ? this.getOnOffTrue(deviceId) : this.getOnOffFalse(deviceId);
    if (onOffCap === null) {
      onOffCap = d.DEVICE_CMD[this.__deviceList[deviceId].driverId].setTempCap;
      onOffValue = onOff ? d.DEVICE_CMD[this.__deviceList[deviceId].driverId].tempMin
        : (d.DEVICE_CMD[this.__deviceList[deviceId].driverId].tempMin - 1);
    }
    if (this.logUnit === deviceId) this.updateLog(`Setting Device ${device.name}.${onOffCap} = ${onOffValue} | Origin setOnOff(${onOff})`, c.LOG_ALL);
    return device.setCapabilityValue({ capabilityId: onOffCap, value: onOffValue });
  }

  /** ****************************************************************************************************
   * Statistics
   ** ****************************************************************************************************
   * Tracked date:
   * - Power last hour
   * - Price last hour
   * - Price point last hour
   * - Number of failed temp settings
   * - Number of failed turn on's
   * - Number of failed turn off's
   * Output data:
   * - Number of hours with low/high/normal price => Percentage in each mode
   * - Average power for low/hih/normal price => Power moved from high to low price
   * - Average Price for low/high/normal => Money saved moving power
   */

  /**
   * Reset stats - called on app init
   */
  statsInit() {
    this.__stats_failed_turn_on = +this.homey.settings.get('stats_failed_turn_on') | 0;
    this.__stats_failed_turn_off = +this.homey.settings.get('stats_failed_turn_off') | 0;
    this.__stats_failed_temp_change = +this.homey.settings.get('stats_failed_temp_change') | 0;
    this.__statsIntervalID = undefined;
    this.__stats_energy = undefined;
    this.__stats_price = undefined;
    this.__stats_price_point = undefined;
    this.__stats_dirtcheap_energy = this.homey.settings.get('stats_dirtcheap_energy');
    this.__stats_low_energy = this.homey.settings.get('stats_low_energy');
    this.__stats_norm_energy = this.homey.settings.get('stats_norm_energy');
    this.__stats_high_energy = this.homey.settings.get('stats_high_energy');
    this.__stats_extreme_energy = this.homey.settings.get('stats_extreme_energy');

    this.__stats_cost_if_smooth = undefined;
    this.__stats_savings_yesterday = undefined;
    this.__stats_savings_all_time_use = +this.homey.settings.get('stats_savings_all_time_use') || 0;
    this.__stats_savings_all_time_power_part = +this.homey.settings.get('stats_savings_all_time_power_part') || 0;
    this.__stats_n_hours_today = 0;
    this.__stats_accum_price_today = 0;
    this.__stats_accum_use_today = 0;
    this.__stats_actual_cost = 0;

    this.__stats_app_restarts = this.homey.settings.get('stats_app_restarts'); // Reset every month
    if (this.__stats_app_restarts === null) {
      this.__stats_app_restarts = 0;
    } else {
      this.__stats_app_restarts = +this.__stats_app_restarts + 1;
    }
    this.homey.settings.set('stats_app_restarts', this.__stats_app_restarts);
    this.statsNewHour();
  }

  /**
   * Deinitializes the stats
   */
  statsUnInit() {
    if (this.__statsIntervalID !== undefined) {
      clearInterval(this.__statsIntervalID);
      this.__statsIntervalID = undefined;
    }
  }

  /**
   * Various statistic counting functions
   */
  statsCountFailedTurnOn() {
    this.__stats_failed_turn_on += 1;
    this.updateLog(`Signal failures *On:${this.__stats_failed_turn_on} Off:${this.__stats_failed_turn_off} Temp:${this.__stats_failed_temp_change}`);
    this.homey.settings.set('stats_failed_turn_on', this.__stats_failed_turn_on);
  }

  statsCountFailedTurnOff() {
    this.__stats_failed_turn_off += 1;
    this.updateLog(`Signal failures On:${this.__stats_failed_turn_on} *Off:${this.__stats_failed_turn_off} Temp:${this.__stats_failed_temp_change}`);
    this.homey.settings.set('stats_failed_turn_off', this.__stats_failed_turn_off);
  }

  statsCountFailedTempChange() {
    this.__stats_failed_temp_change += 1;
    this.updateLog(`Signal failures On:${this.__stats_failed_turn_on} Off:${this.__stats_failed_turn_off} *Temp:${this.__stats_failed_temp_change}`);
    this.homey.settings.set('stats_failed_temp_change', this.__stats_failed_temp_change);
  }

  // Must only be called once every month
  async statsSetLastMonthPower(energy, timeLastUpdatedUTC) {
    const maxPower = this.homey.settings.get('maxPower');
    const overShootAvoided = this.homey.settings.get('overShootAvoided');

    // Add savings for power tariff, always assume one step down
    const { gridCosts } = this.homey.settings.get('futurePriceOptions');
    const tariffIndex = this.findTariffIndex(gridCosts, energy);
    const didMeetTariff = (energy < maxPower);
    const avoidedOvershooting = (overShootAvoided <= maxPower);
    if (didMeetTariff && avoidedOvershooting && (tariffIndex < gridCosts.length - 2)) {
      const newSaving = gridCosts[tariffIndex + 1].price - gridCosts[tariffIndex].price;
      this.__stats_savings_all_time_power_part += newSaving;
      const data = { moneySavedTariff: newSaving };
      addToArchive(this.homey, data, timeLastUpdatedUTC, true, true);
      this.homey.settings.set('stats_savings_all_time_power_part', this.__stats_savings_all_time_power_part);
    } // else max tariff, nothing saved
  }

  async statsSetLastDayMaxEnergy(timeLastUpdatedUTC, newMonthTriggered) {
    // Get last Day Max
    const timeLastUpdatedLocal = toLocalTime(timeLastUpdatedUTC, this.homey);
    const ltYear = timeLastUpdatedLocal.getFullYear();
    const ltMonth = timeLastUpdatedLocal.getMonth();
    const ltDay = timeLastUpdatedLocal.getDate() - 1;
    const timeIdx = `${String(ltYear).padStart(4, '0')}-${String(ltMonth + 1).padStart(2, '0')}`;
    const lastDayMax = await getArchive(this.homey, 'maxPower', 'daily', timeIdx, ltDay);

    // Average of Monthly max:
    const thisMonthTariff = await getArchive(this.homey, 'maxPower', 'monthly', ltYear, ltMonth) || lastDayMax;

    // On new month:
    if (newMonthTriggered) {
      await this.statsSetLastMonthPower(thisMonthTariff, timeLastUpdatedUTC);
      this.__stats_app_restarts = 0;
      this.homey.settings.set('stats_app_restarts', 0);
      this.homey.settings.set('overShootAvoided', 0);
    }
  }

  /**
   * Called when we have crossed into a new hour
   */
  async statsSetLastHourEnergy(energy, energyOk, timeOfNewHourUTC) {
    if (energyOk) {
      this.__stats_energy_time = roundToNearestHour(new Date(timeOfNewHourUTC.getTime()));
      this.updateLog(`Stats last energy time: ${this.__stats_energy_time}`, c.LOG_INFO);
      this.__stats_energy = energy;
    }

    const hourAgoUTC = roundToNearestHour(new Date(timeOfNewHourUTC.getTime() - (1000 * 60 * 60)));
    const hourAgoLocal = toLocalTime(hourAgoUTC, this.homey);

    let overShootAvoided = this.homey.settings.get('overShootAvoided');
    const maxPower = this.homey.settings.get('maxPower');
    const dailyMaxPrevUpdateUTC = new Date(this.homey.settings.get('stats_daily_max_last_update_time'));
    const dailyMaxPrevUpdateLocal = toLocalTime(dailyMaxPrevUpdateUTC, this.homey);
    const lastHourMissed = (hourAgoUTC - dailyMaxPrevUpdateUTC) > (1000 * 60 * 90); // More than 90 minutes ago
    const firstEverHour = getArchive(this.homey, 'maxPower') === null;
    const newDayTriggered = ((hourAgoUTC - dailyMaxPrevUpdateUTC) > (1000 * 60 * 60 * 24) // More than 24 hours or different day
      || (hourAgoLocal.getDate() !== dailyMaxPrevUpdateLocal.getDate()));
    const newMonthTriggered = ((hourAgoUTC - dailyMaxPrevUpdateUTC) > (1000 * 60 * 60 * 24 * 31) // More than 31 days or different month
      || (hourAgoLocal.getMonth() !== dailyMaxPrevUpdateLocal.getMonth()));
    if (newDayTriggered && !firstEverHour) {
      await cleanArchive(this.homey, timeOfNewHourUTC);
      await this.statsSetLastDayMaxEnergy(dailyMaxPrevUpdateUTC, newMonthTriggered);
    }
    const timeSincePowerOff = this.__last_power_on_time - this.__last_power_off_time;
    overShootAvoided = (energyOk && (energy < maxPower) && (energy > maxPower * 0.9) && (timeSincePowerOff < 1000 * 60 * 15) && (maxPower > +overShootAvoided)) ? maxPower : overShootAvoided;
    this.homey.settings.set('stats_daily_max_last_update_time', hourAgoUTC);
    this.homey.settings.set('overShootAvoided', overShootAvoided);

    this.updateLog(`Adding data. isOk: ${energyOk} && ${!lastHourMissed}`, c.LOG_ALL);
    const data = {
      maxPower: energy,
      dataOk: energyOk && !lastHourMissed,
      powUsage: this.__accum_energy,
      overShootAvoided
    };
    if (+this.homey.settings.get('priceMode') !== c.PRICE_MODE_DISABLED) {
      data.pricePoints = +this.homey.settings.get('pricePoint');
    }
    if (Array.isArray(this.__current_prices)) {
      data.price = this.__current_prices[this.__current_price_index];
    }
    await addToArchive(this.homey, data, hourAgoUTC);
  }

  statsSetLastHourPrice(price) {
    this.__stats_price_time = new Date();
    this.updateLog(`Stats price set to: ${this.__stats_price}`, c.LOG_INFO);
    this.__stats_price = price;
  }

  statsSetLastHourPricePoint(pp) {
    this.__starts_price_point_time = new Date();
    this.__stats_price_point = pp;
  }

  statsNewHour() {
    const now = new Date();
    const tenMinutes = 10 * 60 * 1000;

    try {
      // Energy based statistics
      const timeSinceEnergy = now - this.__stats_energy_time;
      if (timeSinceEnergy < tenMinutes) {
        // Only register statistics if reported for the current hour
        let pricePointLastHour;
        const timeSincePricePoint = now - this.__starts_price_point_time;
        if (timeSincePricePoint > tenMinutes) {
          pricePointLastHour = this.__stats_price_point;
        } else {
          pricePointLastHour = +this.homey.settings.get('pricePoint');
        }
        switch (pricePointLastHour) {
          case c.PP.DIRTCHEAP:
            this.__stats_dirtcheap_energy = (!this.__stats_dirtcheap_energy) ? this.__stats_energy : ((+this.__stats_dirtcheap_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_dirtcheap_energy', this.__stats_dirtcheap_energy);
            break;
          case c.PP.LOW:
            this.__stats_low_energy = (!this.__stats_low_energy) ? this.__stats_energy : ((+this.__stats_low_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_low_energy', this.__stats_low_energy);
            break;
          case c.PP.NORM:
            this.__stats_norm_energy = (!this.__stats_norm_energy) ? this.__stats_energy : ((+this.__stats_norm_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_norm_energy', this.__stats_norm_energy);
            break;
          case c.PP.HIGH:
            this.__stats_high_energy = (!this.__stats_high_energy) ? this.__stats_energy : ((+this.__stats_high_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_high_energy', this.__stats_high_energy);
            break;
          case c.PP.EXTREME:
            this.__stats_extreme_energy = (!this.__stats_extreme_energy) ? this.__stats_energy : ((+this.__stats_extreme_energy * 99 + this.__stats_energy) / 100);
            this.homey.settings.set('stats_extreme_energy', this.__stats_extreme_energy);
            break;
          default:
        }
      }

      // Price statistics
      const timeSincePrice = now - this.__stats_price_time;
      if (timeSincePrice < tenMinutes && this.__stats_price && this.__stats_energy) {
        // Calculate how much money has been saved today
        this.__stats_n_hours_today++;
        this.__stats_accum_price_today += this.__stats_price;
        this.__stats_accum_use_today += this.__stats_energy;
        this.__stats_actual_cost += (this.__stats_price * this.__stats_energy) / 1000;
        // If new day
        if (toLocalTime(this.__stats_price_time, this.homey).getHours() === 0
          && this.__stats_n_hours_today > 1) { // Guard to prevent double trigger at summer time changes
          // Accumulate and reset dayliy stats:
          this.__stats_cost_if_smooth = (this.__stats_accum_use_today * (this.__stats_accum_price_today / this.__stats_n_hours_today)) / 1000;
          this.__stats_savings_yesterday = this.__stats_cost_if_smooth - this.__stats_actual_cost;
          if (Number.isFinite(this.__stats_savings_yesterday)) {
            const data = { moneySavedUsage: this.__stats_savings_yesterday };
            addToArchive(this.homey, data, now, true);
            this.__stats_savings_all_time_use += this.__stats_savings_yesterday;
            this.homey.settings.set('stats_savings_all_time_use', this.__stats_savings_all_time_use);
          }
          this.__stats_n_hours_today = 0;
          this.__stats_accum_price_today = 0;
          this.__stats_accum_use_today = 0;
          this.__stats_actual_cost = 0;
        }
      }
    } finally {
      // Start timer to start exactly 5 minutes after the next hour starts
      const timeToNextTrigger = timeToNextHour(now) + 5 * 60 * 1000;
      this.__statsIntervalID = setTimeout(() => this.statsNewHour(), timeToNextTrigger);
    }
  }

  /**
   * Maintenance action: reset statistics
   */
  async resetStatistics() {
    this.__monitorError = 0;
    this.__stats_app_restarts = 0;
    this.__stats_failed_turn_on = 0;
    this.__stats_failed_turn_off = 0;
    this.__stats_failed_temp_change = 0;
    this.homey.settings.set('stats_app_restarts', this.__stats_app_restarts);
    this.homey.settings.set('stats_failed_turn_on', this.__stats_failed_turn_on);
    this.homey.settings.set('stats_failed_turn_off', this.__stats_failed_turn_off);
    this.homey.settings.set('stats_failed_temp_change', this.__stats_failed_temp_change);
    return Promise.resolve();
  }

  /**
   * Maintenance action: turn off AC devices
   */
  async filterChangeAC() {
    const frostList = this.homey.settings.get('frostList');
    const override = this.homey.settings.get('override') || {};
    for (const deviceId in frostList) {
      const { driverId } = this.__deviceList[deviceId];
      if ((driverId in d.DEVICE_CMD) && (d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.AC)) {
        override[deviceId] = c.OVERRIDE.OFF_UNTIL_MANUAL_ON;
        const device = await this.getDevice(deviceId);
        await this.setOnOff(device, deviceId, false);
      }
    }
    this.homey.settings.set('override', override);
    this.log('Turn off AC devices');
  }

  /**
   * Set up arrays for graph generation and return
   * All data is fetched from the archive except for future prices.
   * If future prices are requested then the price points are automatically calculated.
   * @param type = type of statistics to return
   * @param index = index of statistics to return
   * @returns Statistics to generate graphs
   */
  async getStats(type = 'maxPower', time = null, granularity = c.GRANULARITY.DAY) {
    if (type[0] === '[' && type.slice(-1) === ']') {
      type = type.slice(1, -1).split(',');
    } else {
      type = [type];
    }

    const priceMode = +this.homey.settings.get('priceMode');
    let statsTimeUTC = new Date(this.homey.settings.get('stats_daily_max_last_update_time'));
    let statsTimeLocal = (time === null) ? toLocalTime(statsTimeUTC, this.homey) : new Date(+time);
    statsTimeUTC = fromLocalTime(statsTimeLocal, this.homey);
    const archive = await getArchive(this.homey);
    let period;
    let timeId;
    let data = {};
    let dataGood;
    switch (+granularity) {
      default:
      case c.GRANULARITY.DAY:
        period = 'daily';
        timeId = `${statsTimeLocal.getFullYear()}-${String(statsTimeLocal.getMonth() + 1).padStart(2, '0')}`;
        break;
      case c.GRANULARITY.MONTH:
        period = 'monthly';
        timeId = `${statsTimeLocal.getFullYear()}`;
        break;
      case c.GRANULARITY.YEAR:
        period = 'yearly';
        timeId = `${statsTimeLocal.getFullYear()}`;
        break;
      case c.GRANULARITY.HOUR:
        period = 'hourly';
        timeId = `${statsTimeLocal.getFullYear()}-${String(statsTimeLocal.getMonth() + 1).padStart(2, '0')}-${String(statsTimeLocal.getDate()).padStart(2, '0')}`;
        break;
    }
    // Fetch future data in case it's needed
    let futureArchive = {};
    const todayStart = roundToStartOfDay(new Date(), this.homey);
    if ((+granularity === c.GRANULARITY.HOUR) && type.includes('price') && (statsTimeUTC >= todayStart)) {
      futureArchive = await this.buildFutureData();
    }
    // Fetch data from archive
    let searchData;
    const searchDataGood = ('dataOk' in archive) ? archive.dataOk[period] : {};
    dataGood = searchDataGood[timeId];
    for (const partIdx in type) {
      const part = type[partIdx];
      switch (part) {
        case 'chargePlan':
          data['chargeShedule'] = this.__charge_plan;
          data['elPrices'] = this.__current_prices;
          data['currentHour'] = (priceMode === c.PRICE_MODE_DISABLED) ? toLocalTime(new Date(), this.homey).getHours() : this.__current_price_index;
          break;
        case 'maxPower':
        case 'powUsage':
        case 'moneySavedTariff':
        case 'moneySavedUsage':
        case 'price':
        case 'pricePoints':
        case 'overShootAvoided':
          this.log(`trying: ${part} ${period} ${timeId} granularity: ${granularity}`);
          try {
            const futureData = (part in futureArchive) ? futureArchive[part][period] : undefined;
            const archiveData = (part in archive) ? archive[part][period] : undefined;
            searchData = combine(archiveData, futureData);
            data[part] = searchData[timeId];
            if (searchData === undefined) throw new Error('No searchData');
            if (data[part] === undefined) throw new Error('No data');
          } catch (err) {
            if (searchData) {
              let closestTime = statsTimeLocal;
              let closestItem;
              let closestTimeDiff = Infinity;
              for (const timestamp in searchData) {
                const timeStampDate = new Date(timestamp);
                if (Math.abs(timeStampDate - statsTimeLocal) < closestTimeDiff) {
                  closestItem = timestamp;
                  closestTimeDiff = Math.abs(timeStampDate - statsTimeLocal);
                  closestTime = timeStampDate;
                }
              }
              data[part] = searchData[closestItem];
              dataGood = searchDataGood[closestItem];
              statsTimeLocal = closestTime;
              statsTimeUTC = fromLocalTime(statsTimeLocal, this.homey);
            } else {
              data = { error: err };
              dataGood = false;
            }
          }
          break;
        default:
      }
    }

    const stats = {
      daysInMonth: daysInMonth(statsTimeUTC, this.homey),
      hoursInDay: hoursInDay(statsTimeUTC, this.homey),
      localTime: statsTimeLocal.getTime(),
      localDay: statsTimeLocal.getDate(),
      localMonth: statsTimeLocal.getMonth(),
      localYear: statsTimeLocal.getFullYear(),
      data,
      dataGood
    };
    return stats;
  }

  /** ****************************************************************************************************
   *  LOGGING
   ** **************************************************************************************************** */

  logInit() {
    if (this.logInitDone === true) {
      this.log('Init done, so skipping');
      return;
    }
    try {
      this.homeyLog = new Log({ homey: this.homey });
      this.mylog = {};
      this.mylog.diagLog = '';
      this.logInitDone = true;
      this.logLevel = c.LOG_ERROR;
      this.logUnit = '';
    } catch (err) {
      this.logInitDone = false;
    }
  }

  setLogLevel(newLevel) {
    this.logLevel = +newLevel;
    if (!Number.isInteger(this.logLevel)) this.logLevel = c.LOG_ERROR;
  }

  setLogUnit(newUnit) {
    this.logUnit = newUnit;
  }

  updateLog(newMessage, ignoreSetting = c.LOG_INFO) {
    if (!this.logInitDone) {
      try {
        this.logInit();
      } catch (err) {
        this.log(`Unable to initialize logging: ${err}`);
        return; // Skip sending log
      }
    }

    if (ignoreSetting > this.logLevel) {
      return;
    }

    if (newMessage !== '') {
      this.log(newMessage);

      let oldText = this.mylog.diagLog || '';
      if (oldText.length > 20000) {
        // Remove the first 5000 characters.
        oldText = oldText.substring(5000);
        const n = oldText.indexOf('\n');
        if (n >= 0) {
          // Remove up to and including the first \n so the log starts on a whole line
          oldText = oldText.substring(n + 1);
        }
      }

      const nowTime = new Date(Date.now());

      if (oldText.length === 0) {
        oldText = `Log ID: ${nowTime.toJSON()}\r\n`;
        oldText += `App version ${Homey.manifest.version}\r\n\r\n`;
      }

      let milliText = nowTime.getMilliseconds().toString();
      if (milliText.length === 2) {
        milliText = `0${milliText}`;
      } else if (milliText.length === 1) {
        milliText = `00${milliText}`;
      }

      oldText += `+${nowTime.getHours()}:${nowTime.getMinutes()}:${nowTime.getSeconds()}.${milliText}: ${newMessage}\r\n`;

      this.mylog.diagLog = oldText;
      this.homeyLog.setExtra({
        diagLog: this.mylog.diagLog
      });
    }

    this.homey.api.realtime('logUpdate', this.mylog.diagLog);
  }

  clearLog() {
    if (!this.logInitDone) {
      try {
        this.logInit();
      } catch (err) {
        this.log(`Unable to initialize logging: ${err}`);
        return;
      }
    }
    this.mylog.diagLog = '';
    this.homey.api.realtime('logUpdate', this.mylog.diagLog);
  }

  async sendLog() {
    if (!this.logInitDone) {
      try {
        this.logInit();
      } catch (err) {
        this.log(`Unable to initialize logging: ${err}`);
        throw (err); // Skip sending log
      }
    }
    // Do not send empty logs
    if (this.mylog.diagLog === '') {
      throw (new Error('Empty log will not be sent'));
    }

    let tries = 5;
    while (tries-- > 0) {
      try {
        this.updateLog('Sending log', c.LOG_ERROR);
        // create reusable transporter object using the default SMTP transport
        const transporter = nodemailer.createTransport(
          {
            host: Homey.env.MAIL_HOST, // Homey.env.MAIL_HOST,
            port: 587,
            ignoreTLS: false,
            secure: false, // true for 465, false for other ports
            auth:
            {
              user: Homey.env.MAIL_USER, // generated ethereal user
              pass: Homey.env.MAIL_SECRET // generated ethereal password
            },
            tls:
            {
              // do not fail on invalid certs
              rejectUnauthorized: false
            }
          }
        );

        // send mail with defined transport object
        const mailMessage = {
          from: `"Homey User" <${Homey.env.MAIL_USER}>`, // sender address
          to: Homey.env.MAIL_RECIPIENT, // list of receivers
          subject: 'Sparegris log', // Subject line
          text: String(this.mylog.diagLog) // plain text body
        };
        const info = await transporter.sendMail(mailMessage);

        this.updateLog(`Message sent: ${info.messageId}`, c.LOG_INFO);
        // Preview only available when sending through an Ethereal account
        this.log('Preview URL: ', nodemailer.getTestMessageUrl(info));
        // transporter.close();
        return;
      } catch (err) {
        this.updateLog(`Send log error: ${err}`, c.LOG_ERROR);
        this.log(`Error stack: ${err.stack}`);
        throw (err);
      }
    }
    this.updateLog('Send log FAILED', c.LOG_ERROR);
    throw new Error('Failed sending the log, please try again later or wait for app update');
  }

  async logShowState() {
    const frostList = this.homey.settings.get('frostList');
    const numControlledDevices = Array.isArray(frostList) ? Object.keys(frostList).length : 0;
    this.updateLog('========== INTERNAL STATE ==========', c.LOG_ALL);
    this.updateLog(`Number of devices under control: ${numControlledDevices}`, c.LOG_ALL);
    this.updateLog(`Current operating mode: ${this.homey.settings.get('operatingMode')}`, c.LOG_ALL);
    this.updateLog(`Current price mode: ${this.homey.settings.get('priceMode')}`, c.LOG_ALL);
    this.updateLog(`Current price point: ${this.homey.settings.get('pricePoint')}`, c.LOG_ALL);
    this.updateLog(`Total signal failures On:${this.__stats_failed_turn_on} Off:${this.__stats_failed_turn_off} Temp:${this.__stats_failed_temp_change}`, c.LOG_ALL);
    this.updateLog(`Total number of monitor errors: ${this.__monitorError}`, c.LOG_ALL);
    this.updateLog('Device Name               | Location        | Is On      | Temperature | Com errors | Ongoing', c.LOG_ALL);
    for (const deviceId in frostList) {
      if (!(deviceId in this.__deviceList) || !this.__deviceList[deviceId].use) continue;
      const { name, room } = this.__deviceList[deviceId];
      const { lastCmd, nComError } = this.__current_state[deviceId];
      const { temp, ongoing, confirmed } = this.__current_state[deviceId];
      const { __monitorError, __monitorFixTemp, __monitorFixOn } = this.__current_state[deviceId];
      this.getDevice(deviceId)
        .then(device => {
          const isOnActual = (this.getOnOffCap(deviceId) === undefined) ? undefined : this.getIsOn(device, deviceId);
          const tempTargetCap = this.getTempSetCap(deviceId);
          const tempMeasureCap = this.getTempGetCap(deviceId);
          const tempActualTarget = (tempTargetCap in device.capabilitiesObj) ? device.capabilitiesObj[tempTargetCap].value : 'undef';
          const tempActualMeasure = (tempMeasureCap in device.capabilitiesObj) ? device.capabilitiesObj[tempMeasureCap].value : 'undef';
          this.updateLog(`${String(name).padEnd(25)} | ${String(room).padEnd(15)} | ${String(lastCmd).padEnd(10)} | ${
            String(temp).padStart(11)} | ${String(nComError).padStart(10)} | ${String(ongoing).padEnd(7)}`, c.LOG_ALL);
          this.updateLog(`${String('--->Actual').padEnd(13)} - Errs: ${String(__monitorError).padEnd(3)} | ${
            String(__monitorFixOn).padEnd(7)},${String(__monitorFixTemp).padEnd(7)} | ${String(isOnActual).padEnd(10)} | ${
            String(tempActualMeasure).padStart(5)}/${String(tempActualTarget).padStart(5)} | ${''.padStart(10)} | ${String(confirmed).padEnd(7)}`, c.LOG_ALL);
        })
        .catch(err => {
          this.log(`Error log failed for device with name: ${name}`);
        });
    }
    this.updateLog('======== INTERNAL STATE END ========', c.LOG_ALL);
  }

  async logShowCaps(deviceId, filter) {
    const problems = [
      'No device',
      'Experimental device is working',
      'Device is not being turned on/off',
      'Device does not set temperature',
      'Device is not listed'
    ];
    this.updateLog('----- ANALYZING DEVICE -----', c.LOG_ALL);
    this.updateLog(`Report type: ${(+filter >= 0 && +filter <= 4) ? problems[filter] : 'Invalid'}`, c.LOG_ALL);
    this.updateLog(`Device ID:   ${deviceId}`, c.LOG_ALL);
    // const flows = await this.homeyApi.flow.getFlowCardActions(); // TBD: Remove???
    await this.getDevice(deviceId)
      .then(device => {
        this.updateLog(`Device name: ${device.name}`, c.LOG_ALL);
        try {
          this.updateLog(`Driver Uri: ${device.driverUri}`, c.LOG_ALL);
          this.updateLog(`Driver Id: ${device.driverId}`, c.LOG_ALL);
          this.updateLog(`Found onoff cap: ${this.__deviceList[deviceId].onoff_cap}`, c.LOG_ALL);
          this.updateLog(`Found temp cap: ${this.__deviceList[deviceId].thermostat_cap}`, c.LOG_ALL);
          this.updateLog(`Device reliability: ${this.__deviceList[deviceId].reliability}`, c.LOG_ALL);
        } catch (err) {
          this.updateLog(`Error: ${err}`, c.LOG_ERROR);
        } // Ignore

        this.updateLog(`Capabilities: ${String(device.capabilities)}`, c.LOG_ALL);
        for (const capIdx in Object.keys(device.capabilities)) {
          const cap = device.capabilities[capIdx];
          let opts;
          try {
            opts = JSON.stringify(device.capabilitiesObj[cap]);
          } catch (err) {
            opts = `Error: ${err}`;
          }
          this.updateLog(`Options for '${cap}': ${opts}`, c.LOG_ALL);
        }

        // this.updateLog('Actions:', c.LOG_ALL); // TBD: Remove???
        // for (let i = 0; i < flows.length; i++) {
        //   if (flows[i].uri === `homey:device:${deviceId}` || flows[i].uri === `${device.driverUri}`) {
        //     this.updateLog(`ID: ${flows[i].id}`, c.LOG_ALL);
        //     this.updateLog(`Title: ${flows[i].title}`, c.LOG_ALL);
        //     this.updateLog(`Args: ${JSON.stringify(flows[i].args)}`, c.LOG_ALL);
        //   }
        // }
      })
      .catch(err => {
        const errText = `Failed to generate report: ${err}`;
        this.updateLog(errText, c.LOG_ERROR);
        throw new Error(errText);
      })
      .finally(done => {
        this.updateLog('--- ANALYZING DEVICE DONE ---', c.LOG_ALL);
      });
  }

  async logShowPriceApi() {
    this.updateLog('========== UTILITYCOST INTEGRATION ==========', c.LOG_ALL);
    const apiState = await this._checkApi();
    const installed = await this.elPriceApi.getInstalled();
    const version = await this.elPriceApi.getVersion();
    const prices = await this.elPriceApi.get('/prices');
    const gridcosts = await this.elPriceApi.get('/gridcosts');
    if (this.apiState === c.PRICE_API_NO_APP) this.updateLog('No Api or wrong version');
    if (this.apiState === c.PRICE_API_NO_DEVICE) this.updateLog('No device found');
    this.updateLog(`ApiState: ${apiState}`, c.LOG_ALL);
    this.updateLog(`Installed: ${installed}`, c.LOG_ALL);
    this.updateLog(`Version: ${version}`, c.LOG_ALL);
    this.updateLog(`Prices: ${JSON.stringify(prices)}`, c.LOG_ALL);
    this.updateLog(`GridCosts: ${JSON.stringify(gridcosts)}`, c.LOG_ALL);
    this.updateLog('======== UTILITYCOST INTEGRATION END ========', c.LOG_ALL);
  }

  /** ****************************************************************************************************
   *  DEVICE API's
   ** **************************************************************************************************** */
  async getState() {
    let listOfUsedDevices = await this.homey.settings.get('frostList');
    if (listOfUsedDevices === null) {
      listOfUsedDevices = {};
    }
    const priceMode = +await this.homey.settings.get('priceMode');
    const futureData = await this.homey.settings.get('futurePriceOptions');
    const priceKind = !futureData ? null : +futureData.priceKind;
    const apiNeeded = (priceMode === c.PRICE_MODE_INTERNAL) && (priceKind === c.PRICE_KIND_EXTERNAL);
    if (apiNeeded && this.apiState !== c.PRICE_API_OK) {
      this.apiState = await this._checkApi();
    }
    const appState = (this.__deviceList === undefined) ? c.APP_NOT_READY
      : (apiNeeded && (this.apiState === c.PRICE_API_NO_APP)) ? c.APP_MISSING_PRICE_API
        : (apiNeeded && (this.apiState === c.PRICE_API_NO_DEVICE)) ? c.APP_MISSING_PRICE_DEVICE
          : (apiNeeded && (this.apiState === c.PRICE_API_NO_DATA)) ? c.APP_MISSING_PRICE_DATA
            : c.APP_READY;

    const timeLastUpdatedLocal = toLocalTime(new Date(), this.homey);
    const ltYear = +timeLastUpdatedLocal.getFullYear();
    const ltMonth = +timeLastUpdatedLocal.getMonth();
    const ltMonthm1 = (ltMonth === 0) ? 11 : (ltMonth - 1);
    const ltYearm1 = (ltMonth === 0) ? (ltYear - 1) : ltYear;
    const ltDay = timeLastUpdatedLocal.getDate() - 1;
    const timeIdx = (ltDay === 0)
      ? (ltMonth === 0)
        ? `${String(ltYearm1).padStart(4, '0')}-${String(ltMonthm1 + 1).padStart(2, '0')}`
        : `${String(ltYear).padStart(4, '0')}-${String(ltMonthm1 + 1).padStart(2, '0')}`
      : `${String(ltYear).padStart(4, '0')}-${String(ltMonth + 1).padStart(2, '0')}`;

    // Read archive data
    const eachDayMax = await getArchive(this.homey, 'maxPower', 'daily', timeIdx);
    const lastDayMax = Array.isArray(eachDayMax) ? eachDayMax.slice(-1)[0] : eachDayMax ? eachDayMax[ltDay - 1] : undefined;
    const thisMonthTariff = await getArchive(this.homey, 'maxPower', 'monthly', ltYear, ltMonth) || 0;
    const lastMonthTariff = await getArchive(this.homey, 'maxPower', 'monthly', ltYearm1, ltMonthm1);

    return {
      power_last_hour: parseInt(this.__power_last_hour, 10), // Actually NaN the first hour of operation
      power_estimated: this.__power_estimated === undefined ? undefined : parseInt(this.__power_estimated.toFixed(0), 10),
      price_point: +await this.homey.settings.get('pricePoint'),
      operating_mode: +await this.homey.settings.get('operatingMode'),
      alarm_overshoot: this.__alarm_overshoot,
      free_capacity: this.__free_capacity,
      num_devices: Object.keys(listOfUsedDevices).length,
      num_devices_off: this.__num_off_devices,
      safety_power: parseInt(await this.homey.settings.get('safetyPower'), 10),
      num_fail_on: this.__stats_failed_turn_on,
      num_fail_off: this.__stats_failed_turn_off,
      num_fail_temp: this.__stats_failed_temp_change,
      dirtcheap_price_energy_avg: this.__stats_dirtcheap_energy,
      low_price_energy_avg: this.__stats_low_energy,
      norm_price_energy_avg: this.__stats_norm_energy,
      high_price_energy_avg: this.__stats_high_energy,
      extreme_price_energy_avg: this.__stats_extreme_energy,
      power_yesterday: lastDayMax,
      power_average: thisMonthTariff,
      power_last_month: lastMonthTariff,
      num_restarts: this.__stats_app_restarts,

      currency: futureData.currency,
      decimals: await prices.getDecimals(futureData.currency),
      average_price: +await this.homey.settings.get('averagePrice') || undefined,
      current_price: this.__current_prices[this.__current_price_index],
      dirtcheap_price_limit: this.__dirtcheap_price_limit,
      low_price_limit: this.__low_price_limit,
      high_price_limit: this.__high_price_limit,
      extreme_price_limit: this.__extreme_price_limit,
      savings_yesterday: this.__stats_savings_yesterday,
      savings_all_time_use: this.__stats_savings_all_time_use,
      savings_all_time_power_part: this.__stats_savings_all_time_power_part,
      hasAC: this.__hasAC,

      appState
    };
  }

  /**
   * API part developed for internal use
   */
  async getDevices(type) {
    const retval = [];
    retval.push({ name: this.homey.__('settings.deviceinfo.noDeviceSelected'), value: '' });
    await this.homeyApi.devices.getDevices()
      .then(devices => {
        // Loop all devices
        for (const device of Object.values(devices)) {
          const deviceId = device.id;
          const onoffCap = (deviceId in this.__deviceList) ? this.__deviceList[deviceId].onoff_cap : undefined;
          const isInUse = (deviceId in this.__deviceList) ? this.__deviceList[deviceId].use : false;
          const isExperimental = (deviceId in this.__deviceList)
            && (!(this.__deviceList[deviceId].driverId in d.DEVICE_CMD)
              || (d.DEVICE_CMD[this.__deviceList[deviceId].driverId].beta === true));
          const driverId = `${device.driverUri.split(':').at(-1)}:${device.driverId}`;
          const ignoreDevice = (driverId in d.DEVICE_CMD) && (d.DEVICE_CMD[driverId].type === d.DEVICE_TYPE.IGNORE);
          if ((onoffCap === undefined && +type === 4 && !ignoreDevice) // Not listed
            || (onoffCap !== undefined && +type === 2) // Onoff problem
            || (onoffCap !== undefined && +type === 1 && isExperimental) // Experimental device
            || (onoffCap !== undefined && +type === 3) // Temp problem
            || (onoffCap !== undefined && +type === 5 && isInUse)
          ) {
            retval.push({ name: device.name, value: device.id });
          }
        }
      })
      .catch(err => {
        this.log(`Failed to fetch devicelist: ${err}`);
      });
    return retval;
  }

  /** ****************************************************************************************************
   *  Price Handling
   ** **************************************************************************************************** */
  async _checkApi() {
    try {
      this.elPriceApi = this.homey.api.getApiApp('no.almli.utilitycost');
      const isInstalled = await this.elPriceApi.getInstalled();
      const version = await this.elPriceApi.getVersion();
      if (isInstalled && !!version) {
        const split = version.split('.');
        const apiOk = (Number(split[0]) >= 1 && Number(split[1]) >= 5);
        const testData = await this.elPriceApi.get('/prices');
        const deviceOk = apiOk ? (testData !== undefined) : false;
        const dataOk = deviceOk ? (Array.isArray(testData) && testData.length > 0) : false;
        this.updateLog(`Electricity price api version ${version} installed${apiOk ? ' and version is ok' : ', but wrong version'}. Device ${deviceOk ? 'is installed and ok'
          : 'must be installed'}. Data ${dataOk ? 'was returned' : 'was not returned'}.`, c.LOG_INFO);
        return dataOk ? c.PRICE_API_OK : deviceOk ? c.PRICE_API_NO_DATA : apiOk ? c.PRICE_API_NO_DEVICE : c.PRICE_API_NO_APP;
      }
      this.updateLog('Electricity price api not installed', c.LOG_ERROR);
    } catch (err) {
      this.updateLog(`Failed checking electricity price API: ${err.message}`, c.LOG_ERROR);
      this.updateLog('Please install the app "Strømregning" to fetch electricity prices', c.LOG_ERROR);
    }
    return c.PRICE_API_NO_APP;
  }

  /**
   * currentPrices - assumes that the api check has already been done
   * @returns an array of all prices today + an index for the current hour
   */
  async currentPrices(priceMode, priceKind, now = new Date()) {
    const nowSeconds = now.getTime() / 1000;
    try {
      const todayStart = roundToStartOfDay(now, this.homey);
      const todayStartSec = todayStart.getTime() / 1000;
      let newestPriceWeGot = 0;
      // First delete prices older than today
      if (!Array.isArray(this.__all_prices)) {
        this.__all_prices = [];
      }
      for (let i = this.__all_prices.length - 1; i >= 0; i--) {
        if (this.__all_prices[i].time < todayStartSec) {
          this.__all_prices.splice(i, 1);
        } else if (this.__all_prices[i].time > newestPriceWeGot) {
          newestPriceWeGot = this.__all_prices[i].time;
        }
      }
      // If it is midnight then wait 2 minutes for the price api to update its prices.
      if ((priceMode === c.PRICE_MODE_INTERNAL) && (priceKind === c.PRICE_KIND_EXTERNAL)) {
        const delay = ms => new Promise(res => setTimeout(res, ms));
        if ((nowSeconds - (15 * 60)) < todayStartSec) {
          await delay(2 * 60 * 1000);
        }
      }
      // Fetch new prices if needed and add them
      // Nordpool updates the prices around 13-14 every day, meaning that there is no point in
      // fetching new prices before we have less than 12 hours with future prices left
      if ((!isNumber(this.__current_price_index)) || (this.__all_prices.length - this.__current_price_index) < 12) {
        let futurePrices;
        if (priceMode === c.PRICE_MODE_INTERNAL) {
          const futurePriceOptions = await this.homey.settings.get('futurePriceOptions');
          if (priceKind === c.PRICE_KIND_EXTERNAL) {
            futurePrices = await this.elPriceApi.get('/prices');
          } else if (priceKind === c.PRICE_KIND_SPOT) {
            const biddingZone = (futurePriceOptions.priceCountry in c.ENTSOE_BIDDING_ZONES)
              && (futurePriceOptions.priceRegion in c.ENTSOE_BIDDING_ZONES[futurePriceOptions.priceCountry])
              ? c.ENTSOE_BIDDING_ZONES[futurePriceOptions.priceCountry][futurePriceOptions.priceRegion].id : undefined;
            const priceData = await prices.entsoeGetData(todayStart, futurePriceOptions.currency, biddingZone);
            futurePrices = await prices.applyTaxesOnSpotprice(
              priceData,
              futurePriceOptions.surcharge,
              futurePriceOptions.VAT / 100,
              futurePriceOptions.gridTaxDay, // Between 6-22
              futurePriceOptions.gridTaxNight, // Between 22-6
              this.homey
            );
          } else { // priceKind === PRICE_KIND_FIXED
            const priceData = [];
            const intervalStart = todayStart.getTime() / 1000;
            for (let i = 0; i < 48; i++) {
              priceData.push({ time: intervalStart + (i * 60 * 60), price: 0 });
            }
            futurePrices = await prices.applyTaxesOnSpotprice(
              priceData,
              futurePriceOptions.priceFixed,
              0, // VAT is already included in the fixed price
              futurePriceOptions.gridTaxDay, // Between 6-22
              futurePriceOptions.gridTaxNight, // Between 22-6
              this.homey
            );
          }
        } else {
          futurePrices = []; // No prices;
        }

        if (Array.isArray(futurePrices)) {
          for (let i = 0; i < futurePrices.length; i++) {
            if (futurePrices[i].time > newestPriceWeGot) {
              this.__all_prices.push(futurePrices[i]);
            }
          }
          // Probably not necessary to sort but do it just in case
          this.__all_prices.sort((a, b) => {
            return a.time - b.time;
          });
        }
      }
      this.homey.settings.set('all_prices', this.__all_prices);
    } catch (err) {
      this.updateLog(`Electricity price api failed: ${err.message}`, c.LOG_ERROR);
    }

    // Analyze the prizes we got and return 24 values + (today and maybe tomorrow)
    const pricesOnly = [];
    let currentIndex = 0;
    const nPricesToAdd = Math.min(this.__all_prices.length, 48);
    for (let i = 0; i < nPricesToAdd; i++) {
      pricesOnly.push(this.__all_prices[i].price);
      if ((nowSeconds - 3600) >= this.__all_prices[i].time) {
        currentIndex++;
      }
    }
    return { prices: pricesOnly, now: currentIndex };
  }

  /**
   * Builds an array of future data similar to the archive
   */
  async buildFutureData() {
    const nowLocal = toLocalTime(new Date(), this.homey);
    const todayHours = hoursInDay(nowLocal, this.homey);

    const futureData = {};
    futureData['price'] = {};
    futureData['price']['hourly'] = {};
    futureData['pricePoints'] = {};
    futureData['pricePoints']['hourly'] = {};
    let floatingPrice = +this.homey.settings.get('averagePrice') || undefined;
    const todayArray = this.__current_prices.slice(0, todayHours);
    if (this.__current_prices.length > 0) {
      const todayIndex = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
      futureData['price']['hourly'][todayIndex] = [];
      futureData['pricePoints']['hourly'][todayIndex] = [];
      for (let idx = this.__current_price_index; idx < todayHours; idx++) {
        const nextPP = await this.calculateNextPP(floatingPrice, todayArray, idx);
        floatingPrice = nextPP.averagePrice;
        futureData['price']['hourly'][todayIndex][idx] = this.__current_prices[idx];
        futureData['pricePoints']['hourly'][todayIndex][idx] = nextPP.mode;
      }
    }
    if (this.__current_prices.length > todayHours) {
      const tomorrowLocal = new Date(nowLocal.getTime());
      tomorrowLocal.setDate(tomorrowLocal.getDate() + 1);
      const tomorrowIndex = `${tomorrowLocal.getFullYear()}-${String(tomorrowLocal.getMonth() + 1).padStart(2, '0')}-${String(tomorrowLocal.getDate()).padStart(2, '0')}`;
      futureData['price']['hourly'][tomorrowIndex] = [];
      futureData['pricePoints']['hourly'][tomorrowIndex] = [];
      for (let idx = todayHours; idx < this.__current_prices.length; idx++) {
        const nextPP = await this.calculateNextPP(floatingPrice, todayArray, idx);
        floatingPrice = nextPP.averagePrice;
        futureData['price']['hourly'][tomorrowIndex][idx - todayHours] = this.__current_prices[idx];
        futureData['pricePoints']['hourly'][tomorrowIndex][idx] = nextPP.mode;
      }
    }
    return futureData;
  }

  /**
   * Performs the calculation of next price point.
   */
  async calculateNextPP(averagePrice, todayArray, todayIndex) {
    const priceMode = +this.homey.settings.get('priceMode');
    const futureData = this.homey.settings.get('futurePriceOptions');
    const priceKind = !futureData ? null : +futureData.priceKind;
    const outState = {};

    const hoursInInterval = +futureData.averageTime * 24;
    if (!Number.isInteger(hoursInInterval)
      || hoursInInterval === 0
      || typeof (averagePrice) !== 'number'
      || !Number.isFinite(averagePrice)) {
      // Use today price average
      averagePrice = todayArray.reduce((a, b) => a + b, 0) / todayArray.length; // Should always be divide by 24
    } else {
      // Calculate average price over time
      averagePrice = (averagePrice * (hoursInInterval - 1) + todayArray[todayIndex]) / hoursInInterval;
    }

    outState.averagePrice = averagePrice;
    outState.__dirtcheap_price_limit = averagePrice * (+futureData.dirtCheapPriceModifier / 100 + 1);
    outState.__low_price_limit = averagePrice * (+futureData.lowPriceModifier / 100 + 1);
    outState.__high_price_limit = averagePrice * (+futureData.highPriceModifier / 100 + 1);
    outState.__extreme_price_limit = averagePrice * (+futureData.extremePriceModifier / 100 + 1);

    // If min/max limit does not encompas enough hours, change the limits
    const orderedPriceTable = [...todayArray].sort();
    const lowPriceIndex = +futureData.minCheapTime;
    const highPriceIndex = 23 - +futureData.minExpensiveTime;
    if ((lowPriceIndex > 0)
      && (outState.__low_price_limit < orderedPriceTable[lowPriceIndex])) {
      outState.__low_price_limit = orderedPriceTable[lowPriceIndex];
      if (outState.__low_price_limit > outState.__high_price_limit) {
        outState.__high_price_limit = outState.__low_price_limit;
      }
      if (outState.__low_price_limit > outState.__extreme_price_limit) {
        outState.__extreme_price_limit = outState.__low_price_limit;
      }
    }
    if ((highPriceIndex < 23)
      && (outState.__high_price_limit > orderedPriceTable[highPriceIndex])) {
      outState.__high_price_limit = orderedPriceTable[highPriceIndex];
      if (outState.__low_price_limit > outState.__high_price_limit) {
        outState.__low_price_limit = outState.__high_price_limit;
      }
      if (outState.__dirtcheap_price_limit > outState.__high_price_limit) {
        outState.__dirtcheap_price_limit = outState.__high_price_limit;
      }
    }

    // Special case Fixed price
    const isFixedPrice = (priceMode === c.PRICE_MODE_INTERNAL) && (priceKind === c.PRICE_KIND_FIXED);
    if (isFixedPrice) {
      outState.__low_price_limit = todayArray.reduce((a, b) => a + b, 0) / todayArray.length;
    }

    // Trigger new Price points
    const isDirtCheapPrice = isFixedPrice ? false : (todayArray[todayIndex] < this.__dirtcheap_price_limit);
    const isLowPrice = (todayArray[todayIndex] < this.__low_price_limit);
    const isHighPrice = isFixedPrice ? false : (todayArray[todayIndex] > this.__high_price_limit);
    const isExtremePrice = isFixedPrice ? false : (todayArray[todayIndex] > this.__extreme_price_limit) && Number.isInteger(+futureData.extremePriceModifier);
    outState.mode = isDirtCheapPrice ? c.PP.DIRTCHEAP
      : isLowPrice ? c.PP.LOW
        : isExtremePrice ? c.PP.EXTREME
          : isHighPrice ? c.PP.HIGH
            : c.PP.NORM;

    return outState;
  }

  /**
   * Called once every hour (and when app starts + when settings are changed)
   */
  async doPriceCalculations(now = new Date()) {
    // Abort if prices are not available
    const priceMode = +this.homey.settings.get('priceMode');
    const futureData = this.homey.settings.get('futurePriceOptions');
    const priceKind = !futureData ? null : +futureData.priceKind;
    if ((priceMode === c.PRICE_MODE_INTERNAL) && (priceKind === c.PRICE_KIND_EXTERNAL)) {
      this.apiState = await this._checkApi();
      if (this.apiState === c.PRICE_API_NO_APP) return Promise.reject(new Error(this.homey.__('warnings.noPriceApi')));
      if (this.apiState === c.PRICE_API_NO_DEVICE) return Promise.reject(new Error(this.homey.__('warnings.noPriceApiDevice')));
      if (this.apiState === c.PRICE_API_NO_DATA) return Promise.reject(new Error(this.homey.__('warnings.noPriceApiData')));
    }

    if (this.__current_prices && isNumber(+this.__current_price_index)) {
      this.__last_hour_price = this.__current_prices[this.__current_price_index];
    } else {
      this.__last_hour_price = undefined;
    }
    const priceInfo = await this.currentPrices(priceMode, priceKind, now);
    this.__current_prices = priceInfo.prices;
    this.__current_price_index = priceInfo.now;

    this.statsSetLastHourPrice(this.__last_hour_price);

    // === Calculate price point if state is internal and have future prices ===
    if (priceMode !== c.PRICE_MODE_INTERNAL) {
      return Promise.resolve();
    }
    if (this.__current_prices.length < 1) {
      if (this.homey.settings.get('__no_price_notification') === null) {
        this.homey.settings.set('__no_price_notification', true);
        const noPriceText = this.homey.__('settings.welcome.taskNoPrices');
        this.homey.notifications.createNotification({ excerpt: noPriceText });
      }
      return this.onPricePointUpdate(c.PP.NORM);
    }
    if (this.homey.settings.get('__no_price_notification')) {
      this.homey.settings.unset('__no_price_notification');
      const yesPriceText = this.homey.__('settings.welcome.taskYesPrices');
      this.homey.notifications.createNotification({ excerpt: yesPriceText });
    }
    if (!this.app_is_configured) {
      return Promise.reject(new Error(this.homey.__('warnings.notConfigured')));
    }
    const averagePrice = +this.homey.settings.get('averagePrice') || undefined;

    const hoursToday = hoursInDay(now, this.homey);
    const todayArray = this.__current_prices.slice(0, hoursToday);

    const nextPP = await this.calculateNextPP(
      averagePrice,
      todayArray,
      this.__current_price_index
    );

    this.homey.settings.set('averagePrice', nextPP.averagePrice);

    // Calculate min/max limits
    this.__dirtcheap_price_limit = nextPP.__dirtcheap_price_limit;
    this.__low_price_limit = nextPP.__low_price_limit;
    this.__high_price_limit = nextPP.__high_price_limit;
    this.__extreme_price_limit = nextPP.__extreme_price_limit;

    if (!preventZigbee) {
      return this.onPricePointUpdate(nextPP.mode);
    }
    return Promise.resolve();
  }

  // Actually only called once when setting up the app for the first time...
  async fetchTariffTable() {
    const tensioGridCosts = [
      { limit: 2000, price: 73 },
      { limit: 5000, price: 128 },
      { limit: 10000, price: 219 },
      { limit: 15000, price: 323 },
      { limit: 20000, price: 426 },
      { limit: 25000, price: 530 }
    ];
    try {
      this.apiState = await this._checkApi();
      if (this.apiState === c.PRICE_API_OK) {
        const gridFromApi = await this.elPriceApi.get('/gridcosts');
        if (Array.isArray(gridFromApi) && gridFromApi.length > 0) {
          this.homey.settings.set('gridCosts', gridFromApi);
          return gridFromApi;
        }
      }
    } catch (err) {
      // API call probably timed out
      const oldGridCosts = this.homey.settings.get('gridCosts');
      if (oldGridCosts !== null) {
        return oldGridCosts;
      }
    }
    // Could not fetch the table, using tensio price table instead.
    this.homey.settings.set('gridCosts', tensioGridCosts);
    return tensioGridCosts;
  }

  findTariffIndex(tariffTable, energy) {
    for (let i = 0; i < tariffTable.length; i++) {
      if (energy < tariffTable[i].limit) {
        return i;
      }
    }
    return tariffTable.length - 1;
  }

} // class

module.exports = PiggyBank;
