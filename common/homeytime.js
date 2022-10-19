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
  const localTime = new Date(homeyTime.toLocaleString('en-US', { timeZone: tz }));
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
  UTCTime.setHours(UTCTime.getHours() + 2 * stupidTimeDiff); // Cancel the reverse offset and add it in the opposite direction
  return UTCTime;
}

/**
 * Evaluates the amount of minutes until the next time occur
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
 * Rounds a time object to nearest hour
 */
function roundToNearestHour(date) {
  date.setMinutes(date.getMinutes() + 30);
  date.setMinutes(0, 0, 0);
  return date;
}

/**
 * Rounds a time object to start of the day in local time
 * Returned time is in UTC
 */
function roundToStartOfDay(time, homey) {
  const localTime = toLocalTime(time, homey);
  const localTimeDiff = Math.round((time.getTime() - localTime.getTime()) / (60 * 60 * 1000));
  localTime.setHours(localTimeDiff, 0, 0, 0);
  return localTime;
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

module.exports = {
  toLocalTime,
  fromLocalTime,
  timeDiff,
  toTimeString,
  timeSinceLastHour,
  timeToNextHour,
  roundToNearestHour,
  roundToStartOfDay,
  isSameHour,
};
