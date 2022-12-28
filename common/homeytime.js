'use strict';

/** ****************************************************************************************************
 * HomeyTime
 ** ****************************************************************************************************
 * Handling of insane localtime implementation for Homey.
 * Do NOT use this for anything other than display as it offset the UTC time!!!
 * @param homeyTime is the localtime as reported by the Date object on Homey
 * @param homey an instance of homey to get which timezone it is in
 */
function toLocalTime(homeyTime, homey) {
  const tz = homey.clock.getTimezone();
  const homeyTimeHourAgo = new Date(homeyTime.getTime() - 3600000);
  const localeStringNow = homeyTime.toLocaleString('en-US', { timeZone: tz });
  const localeStringHourAgo = homeyTimeHourAgo.toLocaleString('en-US', { timeZone: tz })
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
        + `T${String(inputTime.getHours()).padStart(2, '0')}:${String(inputTime.getMinutes()).padStart(2, '0')}`
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
 * Rounds a time object to start of the day in local time
 * Returned time is in UTC
 */
function roundToStartOfDay(time, homey) {
  const localTime = toLocalTime(time, homey);
  localTime.setHours(0, 0, 0, 0);
  return fromLocalTime(localTime, homey);
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

module.exports = {
  toLocalTime,
  fromLocalTime,
  timeDiff,
  toTimeString,
  timeSinceLastHour,
  timeToNextHour,
  roundToNearestHour,
  roundToStartOfHour,
  roundToStartOfDay,
  isSameHour,
  hoursInDay,
  daysInMonth,
};
