'use strict';

// Max power indices
const TIMESPAN = {
  QUARTER: 0,
  HOUR: 1,
  DAY: 2,
  MONTH: 3,
};

/** ****************************************************************************************************
 * HomeyTime
 ** ****************************************************************************************************
 * Handling of insane localtime implementation for Homey.
 * Do NOT use this for anything other than display as it offset the UTC time!!!
 * Note that the function toLocaleString is used which uses horribly much memory, so the function can
 * not be used for large data sets, or we will run out of memory.
 * @param homeyTime is the localtime as reported by the Date object on Homey
 * @param homey an instance of homey to get which timezone it is in
 */
function toLocalTime(homeyTime, homey) {
  const tz = homey.clock.getTimezone();
  const homeyTimeHourAgo = new Date(homeyTime.getTime() - 3600000);
  const localeStringNow = homeyTime.toLocaleString('en-US', { timeZone: tz });
  const localeStringHourAgo = homeyTimeHourAgo.toLocaleString('en-US', { timeZone: tz });
  const localTime = new Date(localeStringNow);
  if (localeStringNow === localeStringHourAgo) {
    localTime.setTime(localTime.getTime() + 3600000);
  }
  return localTime;
}

/**
 * Returns the UTC time based on a local time
 * @param localTime is the true localtime (not as reported by the Date object on Homey)
 * @param homey an instance of homey to get which timezone it is in
 */
function fromLocalTime(localTime, homey) {
  const UTCTime = toLocalTime(localTime, homey);
  const stupidTimeDiff = (localTime - UTCTime) / (60 * 60 * 1000);
  UTCTime.setUTCHours(UTCTime.getUTCHours() + 2 * stupidTimeDiff); // Cancel the reverse offset and add it in the opposite direction
  return UTCTime;
}

/**
 * Evaluates the amount of minutes until the next time occur
 * TODO: fix this diff when crossing summer time
 */
function timeDiff(HourA, MinA, HourB, MinB) {
  const minSinceMidnightA = HourA * 60 + MinA;
  let minSinceMidnightB = HourB * 60 + MinB;
  const wrapped = minSinceMidnightB < minSinceMidnightA;
  if (wrapped) minSinceMidnightB += 24 * 60; // Add one day
  return minSinceMidnightB - minSinceMidnightA;
}

/**
 * Returns the number of milliseconds since last hour
 */
function timeSinceLastHour(inputTime) {
  return (inputTime.getMinutes() * 60 * 1000)
  + (inputTime.getSeconds() * 1000)
  + inputTime.getMilliseconds();
}

/**
 * Returns the number of milliseconds until next hour
 */
function timeToNextHour(inputTime) {
  return (60 * 60 * 1000) - timeSinceLastHour(inputTime);
}

/**
 * Returns the number of milliseconds since last slot of X minutes
 */
function timeSinceLastSlot(inputTime, minutes) {
  return ((inputTime.getMinutes() % minutes) * 60 * 1000)
  + (inputTime.getSeconds() * 1000)
  + inputTime.getMilliseconds();
}

/**
 * Returns the number of milliseconds until next slot of X minutes
 */
function timeToNextSlot(inputTime, minutes) {
  return (minutes * 60 * 1000) - timeSinceLastSlot(inputTime, minutes);
}

/**
 * Rounds a time object to start of the day in local time
 * Returned time is in UTC. Cache to avoid insane memory usage.
 * Cache 2 items becuase the common usage goes back and forth
 */
const __cachedDayStart = [];
const __cachedDayEnd = [];
let __cachedDayLast;
function roundToStartOfDay(timeUTC, homey) {
  for (let i = 0; i < 2; i++) {
    if (__cachedDayStart[i] && (__cachedDayStart[i] <= timeUTC)
      && __cachedDayEnd[i] && (__cachedDayEnd[i] > timeUTC)) {
      __cachedDayLast = i;
      return __cachedDayStart[i];
    }
  }
  const localTime = toLocalTime(timeUTC, homey);
  localTime.setHours(0, 0, 0, 0);
  __cachedDayStart[1] = __cachedDayStart[0];
  __cachedDayStart[0] = fromLocalTime(localTime, homey);
  localTime.setDate(localTime.getDate() + 1);
  __cachedDayEnd[1] = __cachedDayEnd[0];
  __cachedDayEnd[0] = fromLocalTime(localTime, homey);
  __cachedDayLast = 0;
  return __cachedDayStart[0];
}

/**
 * Rounds a time object to start of the day in local time
 * Returned time is in UTC. Cache to avoid insane memory usage.
 * Cache 2 items becuase the common usage goes back and forth
 */
const __cachedMonthStart = [];
const __cachedMonthEnd = [];
let __cachedMonthLast;
function roundToStartOfMonth(timeUTC, homey) {
  for (let i = 0; i < 2; i++) {
    if (__cachedMonthStart[i] && (__cachedMonthStart[i] <= timeUTC)
      && __cachedMonthEnd[i] && (__cachedMonthEnd[i] > timeUTC)) {
      __cachedMonthLast = i;
      return __cachedMonthStart[i];
    }
  }
  const localTime = toLocalTime(timeUTC, homey);
  localTime.setDate(1);
  localTime.setHours(0, 0, 0, 0);
  __cachedMonthStart[1] = __cachedMonthStart[0];
  __cachedMonthStart[0] = fromLocalTime(localTime, homey);
  localTime.setMonth(localTime.getMonth() + 1);
  __cachedMonthEnd[1] = __cachedMonthEnd[0];
  __cachedMonthEnd[0] = fromLocalTime(localTime, homey);
  __cachedMonthLast = 0;
  return __cachedMonthStart[0];
}

/**
 * Returns the number of milliseconds since last day - daylight savings safe
 */
function timeSinceLastDay(timeUTC, homey) {
  return timeUTC - roundToStartOfDay(timeUTC, homey);
}

/**
 * Returns the number of milliseconds until next slot of X minutes
 */
function timeToNextDay(timeUTC, homey) {
  roundToStartOfDay(timeUTC, homey); // Refresh cache - ignore result
  const startOfNextDayUTC = __cachedDayEnd[__cachedDayLast];
  return startOfNextDayUTC - timeUTC;
}

/**
 * Returns the number of milliseconds since last day - daylight savings safe
 */
function timeSinceLastMonth(timeUTC, homey) {
  return timeUTC - roundToStartOfMonth(timeUTC, homey);
}

/**
 * Returns the number of milliseconds until next slot of X minutes
 */
function timeToNextMonth(timeUTC, homey) {
  roundToStartOfMonth(timeUTC, homey); // Refresh cache - ignore result
  const monthEnd = __cachedMonthEnd[__cachedMonthLast];
  return monthEnd - timeUTC;
}

/**
 * Returns the number of milliseconds until next limiter (defined by TIMESPAN)
 */
function timeSinceLastLimiter(inputTime, limiter, homey) {
  switch (limiter) {
    case TIMESPAN.QUARTER:
      return timeSinceLastSlot(inputTime, 15);
    case TIMESPAN.HOUR:
      return timeSinceLastSlot(inputTime, 60);
    case TIMESPAN.DAY:
      return timeSinceLastDay(inputTime, homey);
    case TIMESPAN.MONTH:
      return timeSinceLastMonth(inputTime, homey);
    default:
      throw (new Error(`Invalid limiter: ${limiter}`));
  }
}

/**
 * Returns the number of milliseconds until next limiter (defined by TIMESPAN)
 */
function timeToNextLimiter(inputTime, limiter, homey) {
  switch (limiter) {
    case TIMESPAN.QUARTER:
      return timeToNextSlot(inputTime, 15);
    case TIMESPAN.HOUR:
      return timeToNextSlot(inputTime, 60);
    case TIMESPAN.DAY:
      return timeToNextDay(inputTime, homey);
    case TIMESPAN.MONTH:
      return timeToNextMonth(inputTime, homey);
    default:
      throw (new Error(`Invalid limiter: ${limiter}`));
  }
}

/**
 * Returns the length in milliseconds of a particular limiter (defined by TIMESPAN)
 */
function limiterLength(inputTime, limiter, homey) {
  switch (limiter) {
    case TIMESPAN.QUARTER:
      return 15 * 60 * 1000;
    case TIMESPAN.HOUR:
      return 60 * 60 * 1000;
    case TIMESPAN.DAY:
      timeSinceLastDay(inputTime, homey); // Refresh cache, ignore result
      return __cachedDayEnd[__cachedDayLast] - __cachedDayStart[__cachedDayLast];
    case TIMESPAN.MONTH:
      timeSinceLastMonth(inputTime, homey); // Refresh cache, ignore result
      return __cachedMonthEnd[__cachedMonthLast] - __cachedMonthStart[__cachedMonthLast];
    default:
      throw (new Error(`Invalid limiter: ${limiter}`));
  }
}

/**
 * Rounds a time object to nearest hour
 */
function roundToNearestHour(date) {
  const startOfDay = new Date(date.getTime());
  startOfDay.setHours(0, 0, 0, 0);
  const hour = Math.round((date - startOfDay) / (60 * 60 * 1000));
  const newTime = new Date(startOfDay.getTime() + (hour * 60 * 60 * 1000));
  return newTime;
}

/**
 * Rounds a time object to the start of the hour
 */
function roundToStartOfHour(date) {
  const newTime = new Date(date.getTime());
  newTime.setUTCMinutes(0, 0, 0);
  return newTime;
}

/**
 * Rounds a time object to the start of the given slot
 */
function roundToStartOfSlot(date, slotSize) {
  const newTime = new Date(date.getTime());
  const minutes = slotSize * Math.floor(newTime.getUTCMinutes() / slotSize);
  newTime.setUTCMinutes(minutes, 0, 0);
  return newTime;
}

/**
 * Checks if two time objects belong to the same hour or not
 */
function isSameHour(time1, time2) {
  return (time1.getFullYear() === time2.getFullYear())
    && (time1.getMonth() === time2.getMonth())
    && (time1.getDate() === time2.getDate())
    && (time1.getHours() === time2.getHours());
}

/**
 * Returns how many hours it is in a day (local time)
 * (goes from 23-25 due to daylight savings)
 * @param time UTC time
 */
function hoursInDay(timeUTC, homey) {
  const startOfDayUTC = roundToStartOfDay(timeUTC, homey);
  const startOfNextDayUTC = new Date(startOfDayUTC.getFullYear(), startOfDayUTC.getMonth(), startOfDayUTC.getDate() + 1, startOfDayUTC.getHours(), startOfDayUTC.getMinutes());
  return (startOfNextDayUTC - startOfDayUTC) / (60 * 60 * 1000);
}

/**
 * Returns how many slots it is in a day (local time)
 * Hours or quarters
 * @param time UTC time
 * @param slotSize in minutes
 */
function slotsInDay(timeUTC, slotSize, homey) {
  const hours = hoursInDay(timeUTC, homey);
  return hours * (60 / slotSize);
}

/**
 * Returns how many days it is in a month (local time)
 * @param time UTC time
 */
function daysInMonth(timeUTC, homey) {
  const localTime = toLocalTime(timeUTC, homey);
  return new Date(localTime.getFullYear(), localTime.getMonth() + 1, 0).getDate();
}

/** *************
 * HTML FUNCTIONS
 ** ************* */

/**
 * Create a time string
 */
function toTimeString(inputTime) {
  return `${inputTime.getFullYear()}-${String(inputTime.getMonth() + 1).padStart(2, '0')}-${String(inputTime.getDate()).padStart(2, '0')}`
        + `T${String(inputTime.getHours()).padStart(2, '0')}:${String(inputTime.getMinutes()).padStart(2, '0')}`;
}

/**
 * Convert a hour hh:mm to minutes since midnight
 */
function timeToMinSinceMidnight(time) {
  const args = time.split(':');
  return (+args[0]) * 60 + +args[1];
}

/**
 * Convert minutes since midnight to a hour:minutes format
 */
function minToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

module.exports = {
  TIMESPAN,
  toLocalTime,
  fromLocalTime,
  timeDiff,
  timeSinceLastHour,
  timeToNextHour,
  timeSinceLastSlot,
  timeToNextSlot,
  timeSinceLastLimiter,
  timeToNextLimiter,
  limiterLength,
  roundToNearestHour,
  roundToStartOfHour,
  roundToStartOfSlot,
  roundToStartOfDay,
  roundToStartOfMonth,
  isSameHour,
  hoursInDay,
  slotsInDay,
  daysInMonth,
};
