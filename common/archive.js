/* eslint-disable guard-for-in */
/* eslint-disable object-curly-newline */
/* eslint-disable no-restricted-syntax */

'use strict';

const { toLocalTime, roundToStartOfDay } = require('./homeytime');
const c = require('./constants');

/** ****************************************************************************************************
 * Archive
 ** ****************************************************************************************************
 * The archive is indexed as follows:
 *   archive[dataId][period][time][data]
 * Where the parameters are:
 *   dataId:
 *     - "maxPower"           : value : The maximum power measured in the interval (for monthly this is the 3-day average)
 *     - "dataOk"             : value : Indicates the relative amount of minutes that had power reported
 *     - "powUsage"           : value : The measured power usage for the given interval
 *     - "charged"            : value : The amount of energy charged
 *     - "moneySavedTariff"   : value : The money saved by upholding the tariff in the interval
 *     - "moneySavedUsage"    : value : The money saved by moving power in the interval
 *     - "price"              : value : The electricity price per hour, for period day/month/year = averages
 *     - "pricePoints"        : array : The price point per hour, for period day/month/year then array [0..4] with number of occurances of the price point
 *     - "overShootAvoided"   : bool  : Indicating if the maxPower was indeed saved within the power tariff within the timeframe
 *     - "cost"               : value : The total cost per hour
 *   period:
 *     - "yearly" : One item stored per year (never expires)
 *     - "monthly": One item stored per month (never expires)
 *     - "daily"  : One item stored per day (expires after homey.setting 'expireDaily' days)
 *     - "hourly" : One item stored per hour (expires after homey.setting 'expireHourly' days)
 *     - "quarter": One item stored per quarter (expires after homey.settings 'expireQuarterly' days)
 *   time:
 *     - "YYYY" for period "yearly"
 *     - "YYYY" for period "monthly"
 *     - "YYYY-MM" for period "daily"
 *     - "YYYY-MM-DD" for period "hourly" and "quarter"
 *   data:
 *     - Single value for period "yearly"
 *     - Array going from 0 to 11, one value for every month for period "monthly"
 *     - Array going from 0 to monthDays-1, one value for every day in the month for period "daily"
 *     - Array going from 0 to dayHours-1, one value for every hour for period "hourly"
 *     - Array going from 0 to dayQuarters-1, one value for every 15 minute for period "quarter"
 *
 * NOTES:
 *   - There can only be one of the lowest units "hourly" or "quarter". If both are present it's because the
 *     mode changed during the interval.
 */

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
  maxPower: { minUnit: c.GRANULARITY.HOUR, slots: SCHEMA.MAX, daily: SCHEMA.MAX, monthly: SCHEMA.AVG3, yearly: SCHEMA.MAX },
  dataOk: { minUnit: c.GRANULARITY.QUARTER, slots: SCHEMA.SET, daily: SCHEMA.AVG, monthly: SCHEMA.AVG, yearly: SCHEMA.AVG },
  powUsage: { minUnit: c.GRANULARITY.QUARTER, slots: SCHEMA.SET, daily: SCHEMA.ADD, monthly: SCHEMA.ADD, yearly: SCHEMA.ADD },
  charged: { minUnit: c.GRANULARITY.HOUR, slots: SCHEMA.ADD, daily: SCHEMA.ADD, monthly: SCHEMA.ADD, yearly: SCHEMA.ADD },
  moneySavedTariff: { minUnit: c.GRANULARITY.HOUR, slots: SCHEMA.ADD, daily: SCHEMA.ADD, monthly: SCHEMA.ADD, yearly: SCHEMA.ADD },
  moneySavedUsage: { minUnit: c.GRANULARITY.HOUR, slots: SCHEMA.ADD, daily: SCHEMA.ADD, monthly: SCHEMA.ADD, yearly: SCHEMA.ADD },
  price: { minUnit: c.GRANULARITY.HOUR, slots: SCHEMA.SET, daily: SCHEMA.AVG, monthly: SCHEMA.AVG, yearly: SCHEMA.AVG },
  pricePoints: { minUnit: c.GRANULARITY.HOUR, slots: SCHEMA.SET, daily: SCHEMA.COUNT, monthly: SCHEMA.COUNT, yearly: SCHEMA.COUNT },
  overShootAvoided: { minUnit: c.GRANULARITY.QUARTER, slots: SCHEMA.SET, daily: SCHEMA.OR, monthly: SCHEMA.OR, yearly: SCHEMA.OR },
  cost: { minUnit: c.GRANULARITY.HOUR, slots: SCHEMA.SET, daily: SCHEMA.ADD, monthly: SCHEMA.ADD, yearly: SCHEMA.ADD },
};

const MODE = {
  NORWAY: {
    id: 'no',
    minUnit: c.GRANULARITY.HOUR,
    maxPower: { minUnit: c.GRANULARITY.HOUR, slots: SCHEMA.MAX, daily: SCHEMA.MAX, monthly: SCHEMA.AVG3, yearly: SCHEMA.MAX },
  },
  BELGIUM: {
    id: 'be',
    minUnit: c.GRANULARITY.QUARTER,
    maxPower: { minUnit: c.GRANULARITY.HOUR, slots: SCHEMA.MAX, daily: SCHEMA.MAX, monthly: SCHEMA.MAX, yearly: SCHEMA.MAX },
  },
};
let mode = MODE.NORWAY;

/**
 * Figures out what is the minimum unit for a set of data and mode
 */
function getMinUnit(dataId) {
  if (mode.minUnit === c.GRANULARITY.HOUR) return 'hourly';
  if (dataId === 'chargePlan') return 'hourly';
  switch (validTypes[dataId].minUnit) {
    case c.GRANULARITY.QUARTER: return 'quarter';
    case c.GRANULARITY.HOUR: return 'hourly';
    case c.GRANULARITY.DAY: return 'daily';
    case c.GRANULARITY.MONTH: return 'monthly';
    default:
    case c.GRANULARITY.YEAR: return 'yearly';
  }
}

/**
 * Clears the entire archive... happens whenever the changing modes
 */
function clearArchive(homey) {
  homey.settings.set('archive', null);
}

/**
 * Changes the Archive Mode
 * returns true if the mode changed, false otherwise
 */
function changeArchiveMode(newMode) {
  const oldMode = mode;
  if (newMode === MODE.BELGIUM.id) {
    mode = MODE.BELGIUM;
    validTypes.maxPower = MODE.BELGIUM.maxPower;
  } else {
    mode = MODE.NORWAY;
    validTypes.maxPower = MODE.NORWAY.maxPower;
  }
  return oldMode !== mode;
}

/**
 * Calculate the average of the n maximum values
 */
function calcAvg(archive, dataId, period, time, idx, numValues) {
  const levelBelow = { slots: undefined, daily: getMinUnit(dataId), monthly: 'daily', yearly: 'monthly' };
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
  const archivePeriod = (period === 'slots') ? getMinUnit(dataId) : period;
  if (!(dataId in archive)) archive[dataId] = {};
  if (!(archivePeriod in archive[dataId])) archive[dataId][archivePeriod] = {};
  if (!(time in archive[dataId][archivePeriod])) archive[dataId][archivePeriod][time] = [];
  const oldValue = archive[dataId][archivePeriod][time][idx];
  const oldValueUndef = (oldValue === undefined) || (oldValue === null);
  const schema = validTypes[dataId][period];
  let setValue;
  switch (schema) {
    case SCHEMA.NONE:
      return;
    case SCHEMA.COUNT:
      setValue = oldValueUndef ? [] : oldValue;
      for (let i = setValue.length; i <= value; i++) {
        setValue[i] = 0;
      }
      setValue[value] += 1;
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
        // In case slot data is skipped the value is the average
        setValue = value;
      }
      break;
    case SCHEMA.AVG:
      try {
        setValue = calcAvg(archive, dataId, period, time, idx, Infinity);
      } catch (err) {
        // In case slot data is skipped the value is the average
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
  archive[dataId][archivePeriod][time][idx] = setValue;
}

/**
 * Macro for removing items from the archive
 * This is to undo broken operations
 */
function removeDataMacro(archive, dataId, period, time, idx, value) {
  const archivePeriod = (period === 'slots') ? getMinUnit(dataId) : period;
  if (!(dataId in archive)) archive[dataId] = {};
  if (!(archivePeriod in archive[dataId])) archive[dataId][archivePeriod] = {};
  if (!(time in archive[dataId][archivePeriod])) archive[dataId][archivePeriod][time] = [];
  const oldValue = archive[dataId][archivePeriod][time][idx];
  const oldValueUndef = (oldValue === undefined) || (oldValue === null);
  const schema = validTypes[dataId][period];
  let setValue;
  switch (schema) {
    case SCHEMA.NONE:
      return;
    case SCHEMA.COUNT:
      setValue = oldValueUndef ? [] : oldValue;
      if (value < setValue.length) {
        setValue[value] = (setValue[value] > 0) ? (setValue[value] - 1) : 0;
      }
      break;
    case SCHEMA.ADD:
      setValue = oldValueUndef ? value : (oldValue - value);
      break;
    case SCHEMA.AND:
      setValue = value ? oldValue : undefined;
      break;
    case SCHEMA.OR:
      setValue = value ? undefined : oldValue;
      break;
    case SCHEMA.AVG3:
      try {
        setValue = calcAvg(archive, dataId, period, time, idx, 3);
      } catch (err) {
        // In case slot data is skipped the value is unknown
        setValue = undefined;
      }
      break;
    case SCHEMA.AVG:
      try {
        setValue = calcAvg(archive, dataId, period, time, idx, Infinity);
      } catch (err) {
        // In case slot data is skipped the value is unknown
        setValue = undefined;
      }
      break;
    case SCHEMA.MAX:
      setValue = (+value < +oldValue) ? oldValue : undefined;
      break;
    case SCHEMA.SET:
    default:
      setValue = undefined;
      break;
  }
  archive[dataId][archivePeriod][time][idx] = setValue;
}

/**
 * Adds data to the Archive
 * @data is of type Object and contains all the data types to archive: {dataId1: value1, dataId2: value2, ...}
 * @time is of type UTC and will be converted into localtime before deciding how to structure the archive by month/year
 * @fakeArchive is only a workaround to modify the archive in place and then save the archive in the end to avoid 1000 disk writes when fixing archive bugs
 */
async function addToArchive(homey, data, timeUTC = new Date(), skipHours = false, skipDays = false,
  fakeArchive = undefined, fakeYear = undefined, fakeMonth = undefined, fakeDay = undefined, fakeHour = undefined) {
  const archive = fakeArchive || await homey.settings.get('archive') || {};
  const startOfDayUTC = fakeArchive ? undefined : roundToStartOfDay(timeUTC, homey, true);
  const localTime = fakeArchive ? undefined : toLocalTime(timeUTC, homey);
  const ltYear = fakeArchive ? fakeYear : localTime.getFullYear();
  const ltMonth = fakeArchive ? fakeMonth : localTime.getMonth();
  const ltDay = fakeArchive ? fakeDay : localTime.getDate() - 1; // Start index from 0

  for (const dataId in data) {
    if (!(dataId in validTypes)) continue;

    // Update slot first
    if (skipHours === false) {
      const hourIdx = `${String(ltYear).padStart(4, '0')}-${String(ltMonth + 1).padStart(2, '0')}-${String(ltDay + 1).padStart(2, '0')}`;
      const slotLength = (getMinUnit(dataId) === 'quarter') ? 15 : 60;
      const ltSlot = fakeArchive ? fakeHour : Math.floor((timeUTC - startOfDayUTC) / (1000 * 60 * slotLength));
      setDataMacro(archive, dataId, 'slots', hourIdx, ltSlot, data[dataId]);
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
  if (!fakeArchive) homey.settings.set('archive', archive);
}

/**
 * Remove a value from the archive as it is disfunctional
 */
async function removeFromArchive(dataId, fakeArchive, ltYear, ltMonth, ltDay, ltHour) {
  if (!(dataId in validTypes)) throw new Error('Invalid usage, dataId must be an archive element');
  try {
    const hourIdx = `${String(ltYear).padStart(4, '0')}-${String(ltMonth + 1).padStart(2, '0')}-${String(ltDay + 1).padStart(2, '0')}`;
    const oldValue = fakeArchive[dataId][getMinUnit(dataId)][hourIdx][ltHour];
    removeDataMacro(fakeArchive, dataId, 'slots', hourIdx, ltHour, oldValue);
    const dayIdx = `${String(ltYear).padStart(4, '0')}-${String(ltMonth + 1).padStart(2, '0')}`;
    removeDataMacro(fakeArchive, dataId, 'daily', dayIdx, ltDay, oldValue);
    const monthIdx = `${String(ltYear).padStart(4, '0')}`;
    removeDataMacro(fakeArchive, dataId, 'monthly', monthIdx, ltMonth, oldValue);
    const yearIdx = monthIdx;
    removeDataMacro(fakeArchive, dataId, 'yearly', yearIdx, 0, oldValue);
  } catch (err) {
    // Item doesn't exist, nothing to remove from archive
  }
}

/**
 * Returns data from the archive. Only the requested data is returned
 * The archive is build as follows: archive[dataId][period][time][data]
 */
async function getArchive(homey, dataId = undefined, period = undefined, time = undefined, dataIdx = undefined) {
  const archive = await homey.settings.get('archive') || {};
  if (!dataId) return archive;
  if (!(dataId in archive)) return null;
  if (!period) return archive[dataId];
  if (!(period in archive[dataId])) return null;
  if (!time) return archive[dataId][period];
  if (!(time in archive[dataId][period])) return null;
  if (!dataIdx) return archive[dataId][period][time];
  if (!Array.isArray(archive[dataId][period][time])) return null;
  return archive[dataId][period][time][dataIdx];
}

/**
 * Replaces an existing archive value with a new value
 */
async function replaceArchiveValue(homey, dataId, period, time, dataIdx, newVal) {
  console.log('saving');
  const archive = await homey.settings.get('archive') || {};
  if (!(dataId in archive)) throw new Error(`Invalid dataId in archive (${dataId})`);
  if (!(period in archive[dataId])) throw new Error(`Invalid period in archive[${dataId}] (${period})`);
  if (!(time in archive[dataId][period])) throw new Error(`Invalid time in archive[${dataId}][${period}] (${time})`);
  if (!Number.isFinite(+newVal)) throw new Error(`Invalid number '${newVal}'`);
  let oldVal = archive[dataId][period][time];
  if (Array.isArray(oldVal)) {
    if (!(dataIdx in oldVal)) throw new Error(`Invalid dataIdx in archive[${dataId}][${period}][${time}] (${dataIdx})`);
    oldVal[dataIdx] = +newVal;
  } else {
    oldVal = +newVal;
  }
  archive[dataId][period][time] = oldVal;
  console.log(`saved: ${dataId}, ${period}, ${time}, ${JSON.stringify(oldVal)}`);
  homey.settings.set('archive', archive);
}

/**
 * Cleans up the archive by deleting expired content
 */
async function cleanArchive(homey, timeUTC = new Date()) {
  const archive = await homey.settings.get('archive') || {};
  const localTime = toLocalTime(timeUTC, homey);
  const ltYear = localTime.getFullYear();
  const ltMonth = localTime.getMonth();
  const ltDay = localTime.getDate() - 1; // Start index from 0
  const dayId = `${String(ltYear).padStart(4, '0')}-${String(ltMonth + 1).padStart(2, '0')}-${String(ltDay + 1).padStart(2, '0')}`;
  const monthId = `${String(ltYear).padStart(4, '0')}-${String(ltMonth + 1).padStart(2, '0')}`;
  let hourlyExpireDays = +homey.settings.get('expireHourly');
  let dailyExpireDays = +homey.settings.get('expireDaily');
  if (!Number.isInteger(hourlyExpireDays) || (hourlyExpireDays < 1)) {
    hourlyExpireDays = 7; // Set a value to avoid building the archive forever
  }
  if (!Number.isInteger(dailyExpireDays) || (dailyExpireDays < 1)) {
    dailyExpireDays = 31; // Set a value to avoid building the archive forever
  }
  dailyExpireDays = Math.ceil(dailyExpireDays / 31) * 31;
  const hourlyExpire = new Date(new Date(dayId).getTime() - 1000 * 60 * 60 * 24 * hourlyExpireDays);
  const dailyExpire = new Date(new Date(monthId).getTime() - 1000 * 60 * 60 * 24 * dailyExpireDays);
  homey.app.updateLog(`Expire archive trigger time:  ${localTime}`, c.LOG_INFO);
  homey.app.updateLog(`  - Quarter expire older than: ${hourlyExpire}`, c.LOG_INFO);
  homey.app.updateLog(`  - Hourly expire older than: ${hourlyExpire}`, c.LOG_INFO);
  homey.app.updateLog(`  - Daily expire older than:  ${dailyExpire}`, c.LOG_INFO);
  for (const dataId in archive) {
    const quarterData = archive[dataId].quarter;
    if (quarterData) {
      for (const day in quarterData) {
        const timeStamp = new Date(day);
        if (timeStamp < hourlyExpire) {
          delete archive[dataId].quarter[day];
        }
        // console.log(`  Quarter: ${day}: ${expired}: ${timeStamp} ${hourlyExpire}`);
      }
    }
    const hourlyData = archive[dataId].hourly;
    if (hourlyData) {
      for (const day in hourlyData) {
        const timeStamp = new Date(day);
        if (timeStamp < hourlyExpire) {
          delete archive[dataId].hourly[day];
        }
        // console.log(`  Hour: ${day}: ${expired}: ${timeStamp} ${hourlyExpire}`);
      }
    }
    const dailyData = archive[dataId].daily;
    if (dailyData) {
      for (const month in dailyData) {
        const timeStamp = new Date(month);
        if (timeStamp < dailyExpire) {
          delete archive[dataId].daily[month];
        }
        // console.log(`  Daily: ${month}: ${expired}`);
      }
    }
  }
  homey.settings.set('archive', archive);
}

module.exports = {
  getMinUnit,
  clearArchive,
  changeArchiveMode,
  addToArchive,
  removeFromArchive,
  cleanArchive,
  getArchive,
  replaceArchiveValue,
};
