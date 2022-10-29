/* eslint-disable object-curly-newline */
/* eslint-disable no-restricted-syntax */

'use strict';

const { toLocalTime, roundToNearestHour, roundToStartOfDay } = require('./homeytime');

/** ****************************************************************************************************
 * Archive
 ** ****************************************************************************************************
 * The archive is indexed as follows:
 *   archive[dataId][period][time][data]
 * Where the parameters are:
 *   dataId:
 *     - "maxPower"           : value : The maximum power measured in the interval (for monthly this is the 3-day average)
 *     - "dataOk"             : bool  : Indicating if the data is reliable or if a reboot / app restart was detected
 *     - "powUsage"           : value : The measured power usage for the given interval
 *     - "moneySavedTariff"   : value : The money saved by upholding the tariff in the interval
 *     - "moneySavedUsage"    : value : The money saved by moving power in the interval
 *     - "price"              : value : The electricity price per hour, for period day/month/year = averages
 *     - "pricePoints"        : array : The price point per hour, for period day/month/year then array [0..4] with number of occurances of the price point
 *   period:
 *     - "yearly" : One item stored per year (never expires)
 *     - "monthly": One item stored per month (never expires)
 *     - "daily"  : One item stored per day (expires after ARCHIVE_EXPIRE_TIME_DAILY)
 *     - "hourly" : One item stored per hour (expires after ARCHIVE_EXPIRE_TIME_HOURLY)
 *   time:
 *     - "YYYY" for period "yearly"
 *     - "YYYY" for period "monthly"
 *     - "YYYY-MM" for period "daily"
 *     - "YYYY-MM-DD" for period "hourly"
 *   data:
 *     - Single value for period "yearly"
 *     - Array going from 0 to 11, one value for every month for period "monthly"
 *     - Array going from 0 to monthDays-1, one value for every day in the month for period "daily"
 *     - Array going from 0 to 23, one value for every hour for period "hourly"
 */

const ARCHIVE_EXPIRE_TIME_DAILY = 2; // In past months to keep
const ARCHIVE_EXPIRE_TIME_HOURLY = 2; // In past days to keep

const SCHEMA = {
  NONE: 0,
  SET: 1,
  MAX: 2,
  AVG3: 3,
  AVG: 4,
  AND: 5,
  ADD: 6,
  COUNT: 7,
  OR: 8,
};

const validTypes = {
  maxPower: { hourly: SCHEMA.SET, daily: SCHEMA.MAX, monthly: SCHEMA.AVG3, yearly: SCHEMA.MAX },
  dataOk: { hourly: SCHEMA.SET, daily: SCHEMA.AND, monthly: SCHEMA.AND, yearly: SCHEMA.AND },
  powUsage: { hourly: SCHEMA.SET, daily: SCHEMA.ADD, monthly: SCHEMA.ADD, yearly: SCHEMA.ADD },
  moneySavedTariff: { hourly: SCHEMA.SET, daily: SCHEMA.ADD, monthly: SCHEMA.ADD, yearly: SCHEMA.ADD },
  moneySavedUsage: { hourly: SCHEMA.SET, daily: SCHEMA.ADD, monthly: SCHEMA.ADD, yearly: SCHEMA.ADD },
  price: { hourly: SCHEMA.SET, daily: SCHEMA.AVG, monthly: SCHEMA.AVG, yearly: SCHEMA.AVG },
  pricePoints: { hourly: SCHEMA.SET, daily: SCHEMA.COUNT, monthly: SCHEMA.COUNT, yearly: SCHEMA.COUNT },
  overShootAvoided: { hourly: SCHEMA.SET, daily: SCHEMA.OR, monthly: SCHEMA.OR, yearly: SCHEMA.OR },
};

/**
 * Calculate the average of the n maximum values
 */
function calcAvg(archive, dataId, period, time, idx, numValues) {
  const levelBelow = { hourly: undefined, daily: 'hourly', monthly: 'daily', yearly: 'monthly' };
  const subIdx = (period === 'yearly') ? '' : `-${String(idx + 1).padStart(2, '0')}`;
  const allValues = [...archive[dataId][levelBelow[period]][`${time}${subIdx}`]];
  const maxN = allValues.sort((a, b) => b - a).filter(data => (data !== undefined) && (data !== null)).slice(0, numValues);
  const avg = maxN.reduce((a, b) => a + b, 0) / maxN.length;
  return avg;
}

/**
 * Set the data macro
 */
function setDataMacro(archive, dataId, period, time, idx, value) {
  if (!(dataId in archive)) archive[dataId] = {};
  if (!(period in archive[dataId])) archive[dataId][period] = {};
  if (!(time in archive[dataId][period])) archive[dataId][period][time] = [];
  const oldValue = archive[dataId][period][time][idx];
  const oldValueUndef = (oldValue === undefined) || (oldValue === null);
  const schema = validTypes[dataId][period];
  let setValue;
  switch (schema) {
    case SCHEMA.NONE:
      return;
    case SCHEMA.COUNT:
      setValue = oldValueUndef ? [0,0] : oldValue;
      if (setValue.includes(value)) {
        setValue[value] += 1;
      } else {
        setValue[value] = 1;
      }
      break;
    case SCHEMA.ADD:
      setValue = oldValueUndef ? value : (oldValue + value);
      break;
    case SCHEMA.AND:
      setValue = oldValueUndef ? value : (oldValue && value);
      break;
    case SCHEMA.OR:
      setValue = oldValueUndef ? value : (oldValue || value);
      break;
    case SCHEMA.AVG3:
      try {
        setValue = calcAvg(archive, dataId, period, time, idx, 3);
      } catch (err) {
        // In case hourly data is skipped the value is the average
        setValue = value;
      }
      break;
    case SCHEMA.AVG:
      try {
        setValue = calcAvg(archive, dataId, period, time, idx, Infinity);
      } catch (err) {
        // In case hourly data is skipped the value is the average
        setValue = value;
      }
      break;
    case SCHEMA.MAX:
      setValue = oldValueUndef ? value : Math.max(+oldValue, +value);
      break;
    case SCHEMA.SET:
    default:
      setValue = +value;
      break;
  }
  archive[dataId][period][time][idx] = setValue;
}

/**
 * Adds data to the Archive
 * @data is of type Object and contains all the data types to archive: {dataId1: value1, dataId2: value2, ...}
 * @time is of type UTC and will be converted into localtime before deciding how to structure the archive by month/year
 */
async function addToArchive(homey, data, timeUTC = new Date(), skipHours = false, skipDays = false) {
  const archive = await homey.settings.get('archive') || {};
  const startOfDayUTC = roundToStartOfDay(timeUTC, homey);
  const localTime = roundToNearestHour(toLocalTime(timeUTC, homey));
  const ltYear = localTime.getFullYear();
  const ltMonth = localTime.getMonth();
  const ltDay = localTime.getDate() - 1; // Start index from 0
  const ltHour = Math.round((timeUTC - startOfDayUTC) / (1000 * 60 * 60));

  for (const dataId in data) {
    if (!(dataId in validTypes)) continue;

    // Update Hourly first
    if (skipHours === false) {
      const hourIdx = `${String(ltYear).padStart(4, '0')}-${String(ltMonth + 1).padStart(2, '0')}-${String(ltDay + 1).padStart(2, '0')}`;
      setDataMacro(archive, dataId, 'hourly', hourIdx, ltHour, data[dataId]);
    }

    // Update Daily
    if (skipDays === false) {
      const dayIdx = `${String(ltYear).padStart(4, '0')}-${String(ltMonth + 1).padStart(2, '0')}`;
      setDataMacro(archive, dataId, 'daily', dayIdx, ltDay, data[dataId]);
    }

    // Update Monthly
    const monthIdx = `${String(ltYear).padStart(4, '0')}`;
    setDataMacro(archive, dataId, 'monthly', monthIdx, ltMonth, data[dataId]);

    // Update Yearly
    const yearIdx = monthIdx;
    setDataMacro(archive, dataId, 'yearly', yearIdx, 0, data[dataId]);
  }
  homey.settings.set('archive', archive);
}

/**
 * Returns data from the archive. Only the requested data is returned
 */
async function getArchive(homey) {
  const archive = await homey.settings.get('archive') || {};
  return archive;
}

/**
 * Cleans up the archive by deleting expired content
 */
async function cleanArchive(homey, timeUTC = new Date()) {
  const archive = await homey.settings.get('archive') || {};
  const localTime = toLocalTime(timeUTC, homey);
  console.log(`Expire archive TODO: ${localTime}`);
  homey.settings.set('archive', archive);
}

module.exports = {
  addToArchive,
  cleanArchive,
  getArchive,
};
