'use strict';

const { MAXPOWER } = require('./constants');

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
 * Create a time string
 */
function toTimeString(inputTime) {
  return `${inputTime.getFullYear()}-${String(inputTime.getMonth() + 1).padStart(2, '0')}-${String(inputTime.getDate()).padStart(2, '0')}`
        + `T${String(inputTime.getHours()).padStart(2, '0')}:${String(inputTime.getMinutes()).padStart(2, '0')}`;
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
 */
let __cachedDayStart;
let __cachedDayEnd;
function roundToStartOfDay(timeUTC, homey) {
  if (!__cachedDayStart
    || (__cachedDayStart > timeUTC)
    || !__cachedDayEnd
    || (__cachedDayEnd < timeUTC)) {
    const localTime = toLocalTime(timeUTC, homey);
    localTime.setHours(0, 0, 0, 0);
    __cachedDayStart = fromLocalTime(localTime, homey);
    localTime.setDate(localTime.getDay() + 1);
    __cachedDayEnd = fromLocalTime(localTime, homey);
  }
  return __cachedDayStart;
}

/**
 * Rounds a time object to start of the day in local time
 * Returned time is in UTC. Cache to avoid insane memory usage.
 */
let __cachedMonthStart;
let __cachedMonthEnd;
function roundToStartOfMonth(timeUTC, homey) {
  if (!__cachedMonthStart
    || (__cachedMonthStart > timeUTC)
    || !__cachedMonthEnd
    || (__cachedMonthEnd < timeUTC)) {
    const localTime = toLocalTime(timeUTC, homey);
    localTime.setDate(1);
    localTime.setHours(0, 0, 0, 0);
    __cachedMonthStart = fromLocalTime(localTime, homey);
    localTime.setMonth(localTime.getMonth() + 1);
    __cachedMonthEnd = fromLocalTime(localTime, homey);
  }
  return __cachedMonthStart;
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
  const startOfDayUTC = roundToStartOfDay(timeUTC, homey);
  const startOfNextDayUTC = new Date(startOfDayUTC.getFullYear(), startOfDayUTC.getMonth(), startOfDayUTC.getDate() + 1, startOfDayUTC.getHours(), startOfDayUTC.getMinutes());
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
  const startOfMonthUTC = roundToStartOfMonth(timeUTC, homey);
  const startOfNextMonthUTC = new Date(startOfMonthUTC.getFullYear(), startOfMonthUTC.getMonth() + 1, startOfMonthUTC.getDate(), startOfMonthUTC.getHours(), startOfMonthUTC.getMinutes());
  return startOfNextMonthUTC - timeUTC;
}

/**
 * Returns the number of milliseconds until next limiter (defined by MAXPOWER)
 */
function timeSinceLastLimiter(inputTime, limiter, homey) {
  switch (limiter) {
    case MAXPOWER.QUARTER:
      return timeSinceLastSlot(inputTime, 15);
    case MAXPOWER.HOUR:
      return timeSinceLastSlot(inputTime, 60);
    case MAXPOWER.DAY:
      return timeSinceLastDay(inputTime, homey);
    case MAXPOWER.MONTH:
      return timeSinceLastMonth(inputTime, homey);
    default:
      throw (new Error(`Invalid limiter: ${limiter}`));
  }
}

/**
 * Returns the number of milliseconds until next limiter (defined by MAXPOWER)
 */
function timeToNextLimiter(inputTime, limiter, homey) {
  switch (limiter) {
    case MAXPOWER.QUARTER:
      return timeToNextSlot(inputTime, 15);
    case MAXPOWER.HOUR:
      return timeToNextSlot(inputTime, 60);
    case MAXPOWER.DAY:
      return timeToNextDay(inputTime, homey);
    case MAXPOWER.MONTH:
      return timeToNextMonth(inputTime, homey);
    default:
      throw (new Error(`Invalid limiter: ${limiter}`));
  }
}

/**
 * Returns the length in milliseconds of a particular limiter (defined by MAXPOWER)
 */
function limiterLength(inputTime, limiter, homey) {
  switch (limiter) {
    case MAXPOWER.QUARTER:
      return 15 * 60 * 1000;
    case MAXPOWER.HOUR:
      return 60 * 60 * 1000;
    case MAXPOWER.DAY:
      timeSinceLastDay(inputTime, homey); // Refresh cache, ignore result
      return __cachedDayEnd - __cachedDayStart;
    case MAXPOWER.MONTH:
      timeSinceLastMonth(inputTime, homey); // Refresh cache, ignore result
      return __cachedMonthEnd - __cachedMonthStart;
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
 * Returns how many days it is in a month (local time)
 * @param time UTC time
 */
function daysInMonth(timeUTC, homey) {
  const localTime = toLocalTime(timeUTC, homey);
  return new Date(localTime.getFullYear(), localTime.getMonth() + 1, 0).getDate();
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
  toLocalTime,
  fromLocalTime,
  timeDiff,
  toTimeString,
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
  isSameHour,
  hoursInDay,
  daysInMonth,
  timeToMinSinceMidnight,
  minToTime,
};
