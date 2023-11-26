/* eslint-disable node/no-unpublished-require */
/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

'use strict';

const manifest = require('../app.json');
const env = require('../env.json');

/**
 * Fake settings class
 */
class FakeSettingsClass {

  constructor(homey) {
    this.homey = homey;
    this.values = {};
    this.callbacks = [];
  }

  get(target) {
    if (this.values[target] === undefined) {
      return null;
    }
    return this.values[target];
  }

  set(target, value) {
    this.values[target] = value;
    for (let i = 0; i < this.callbacks.length; i++) {
      if (this.callbacks[i].when === 'set') {
        this.callbacks[i].callback(target);
      }
    }
  }

  on(target, callback) {
    this.callbacks.push({ when: target, callback });
  }

  unset(target) {
    if (target in this.values) {
      delete this.values[target];
    }
  }

  getKeys() {
    return Object.keys(this.values);
  }

}

/**
 * Fake App API class
 */
class FakeAppApiClass {

  constructor(appName) {
    this.appName = appName;
  }

  getInstalled() {
    return true;
  }

  getVersion() {
    return '1.5.3';
  }

  // command faked from no.almli.utilitycost
  get(command) {
    return [
      { time: 1664402400, price: 0.8981399999999999 },
      { time: 1664406000, price: 0.89343 },
      { time: 1664409600, price: 0.8985399999999999 },
      { time: 1664413200, price: 0.9056 },
      { time: 1664416800, price: 0.9135899999999999 },
      { time: 1664420400, price: 0.9576800000000001 },
      { time: 1664424000, price: 1.03795 },
      { time: 1664427600, price: 1.11999 },
      { time: 1664431200, price: 1.13425 },
      { time: 1664434800, price: 1.14616 },
      { time: 1664438400, price: 1.14983 },
      { time: 1664442000, price: 1.16618 },
      { time: 1664445600, price: 1.24443 },
      { time: 1664449200, price: 1.6057000000000001 },
      { time: 1664452800, price: 2.2863599999999997 },
      { time: 1664456400, price: 2.84875 },
      { time: 1664460000, price: 3.55991 },
      { time: 1664463600, price: 2.34145 },
      { time: 1664467200, price: 1.6439000000000001 },
      { time: 1664470800, price: 1.58843 },
      { time: 1664474400, price: 1.60661 },
      { time: 1664478000, price: 1.42683 },
      { time: 1664481600, price: 1.34918 },
      { time: 1664485200, price: 1.31463 },
    ];
  }

}

/**
 * Fake API class
 */
class FakeApiClass {

  constructor(homey) {
    this.homey = homey;
  }

  getApiApp(appName) {
    return new FakeAppApiClass(appName);
  }

  realtime(event, parameter) {
    if (this.homey.__debug) console.log('TBD: Implement realtime(...)');
  }

}

/**
 * Fake Trigger card class
 */
class FakeTriggerCardClass {

  constructor(homey, name) {
    this.homey = homey;
    this.name = name;
    if (this.homey.__debug) console.log('TBD: Implement FakeTriggerCard');
  }

  registerRunListener(callback) {
    if (this.homey.__debug) console.log('TBD: Implement registerRunListener');
  }

  trigger(tokens) {
    if (this.homey.__debug) console.log('TBD: Implement tokens');
  }

}

/**
 * Fake Action card class
 */
class FakeActionCardClass {

  constructor(homey, name) {
    this.homey = homey;
    this.name = name;
    if (this.homey.__debug) console.log('TBD: Implement FakeActionCard');
  }

  registerRunListener(callback) {
    if (this.homey.__debug) console.log('TBD: Implement registerRunListener');
  }

  registerArgumentAutocompleteListener(callback) {
    if (this.homey.__debug) console.log('TBD: Implement registerArgumentAutocompleteListener (action)');
  }

}

/**
 * Fake Condition card class
 */
class FakeConditionCardClass {

  constructor(homey, name) {
    this.homey = homey;
    this.name = name;
    if (this.homey.__debug) console.log('TBD: Implement FakeConditionCard');
  }

  registerRunListener(callback) {
    if (this.homey.__debug) console.log('TBD: Implement registerRunListener');
  }

  registerArgumentAutocompleteListener(callback) {
    if (this.homey.__debug) console.log('TBD: Implement registerArgumentAutocompleteListener (condition)');
  }

}

/**
 * Fake Flow class
 */
class FakeFlowClass {

  constructor(homey) {
    this.homey = homey;
  }

  getTriggerCard(name) {
    return new FakeTriggerCardClass(this.homey, name);
  }

  getActionCard(name) {
    return new FakeActionCardClass(this.homey, name);
  }

  getConditionCard(name) {
    return new FakeConditionCardClass(this.homey, name);
  }

}

/**
 * Fake Clock class
 */
class FakeClockClass {

  constructor(homey) {
    this.homey = homey;
    this.timeZone = 'Europe/Oslo';
  }

  getTimezone() {
    return this.timeZone;
  }

  setTimezone(newZone) {
    this.timeZone = newZone;
  }

}

/**
 * Fake Notifications class
 */
class FakeNotificationsClass {

  constructor(homey) {
    this.homey = homey;
  }

  createNotification(message) {
    this.homey.app.log(`NOTIFICATION: ${message.excerpt}`);
    return Promise.resolve();
  }

}

/**
 * Fake Language class
 */
class FakeLanguageClass {

  constructor(homey) {
    this.homey = homey;
    this.locale = 'no';
  }

  __(languagestring) {
    if (typeof languagestring === 'string') return languagestring;
    if (this.locale in languagestring) return languagestring[this.locale];
    if ('en' in languagestring) return languagestring['en'];
    throw new Error(`Broken languagestring: ${JSON.stringify(languagestring)}`);
  }

  getLanguage() {
    return this.locale;
  }

}

/**
 * Fake Homey class
 */
class FakeHomeyClass {

  constructor(app) {
    this.app = app;
    this.settings = new FakeSettingsClass(this);
    this.api = new FakeApiClass(this);
    this.flow = new FakeFlowClass(this);
    this.clock = new FakeClockClass(this);
    this.notifications = new FakeNotificationsClass(this);
    this.i18n = new FakeLanguageClass(this);
    this.env = env;
    this.__debug = false;
  }

  __(languagestring) {
    return this.i18n.__(languagestring);
  }

  on(event, callback) {
    if (this.__debug) console.log('TBD implement on(event,callback)');
  }

  enableDebug() {
    this.__debug = true;
  }

}

/**
 * Replacement for the Homey API
 */
class App {

  constructor() {
    this.manifest = manifest;
    this.homey = new FakeHomeyClass(this);
    this.enableLog();
  }

  enableLog() {
    this.logEnabled = true;
  }

  disableLog() {
    this.logEnabled = false;
  }

  log(value) {
    if (this.logEnabled) console.log(value);
  }

}

module.exports = {
  App,
  manifest,
  env,
};
