/* eslint-disable node/no-unpublished-require */
/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

'use strict';

const manifest = { version: '1.0' };
const env = require('../env.json');

/**
 * Fake settings class
 */
class FakeSettingsClass {

  constructor() {
    this.values = {};
  }

  get(target) {
    if (this.values[target] === undefined) {
      return null;
    }
    return this.values[target];
  }

  set(target, value) {
    this.values[target] = String(value);
  }

  on(target, callback) {
    console.log('TBD: Implement settings.on');
  }

  unset(target) {
    if (target in this.values) delete this.values.target;
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

  getApiApp(appName) {
    return new FakeAppApiClass(appName);
  }

  realtime(event, parameter) {
    console.log('TBD: Implement realtime(...)');
  }

}

/**
 * Fake Trigger card class
 */
class FakeTriggerCardClass {

  constructor() {
    console.log('TBD: Implement FakeTriggerCard');
  }

  registerRunListener(callback) {
    console.log('TBD: Implement registerRunListener');
  }

}

/**
 * Fake Action card class
 */
class FakeActionCardClass {

  constructor() {
    console.log('TBD: Implement FakeActionCard');
  }

  registerRunListener(callback) {
    console.log('TBD: Implement registerRunListener');
  }

  registerArgumentAutocompleteListener(callback) {
    console.log('TBD: Implement registerArgumentAutocompleteListener (action)');
  }

}

/**
 * Fake Condition card class
 */
class FakeConditionCardClass {

  constructor() {
    console.log('TBD: Implement FakeConditionCard');
  }

  registerRunListener(callback) {
    console.log('TBD: Implement registerRunListener');
  }

  registerArgumentAutocompleteListener(callback) {
    console.log('TBD: Implement registerArgumentAutocompleteListener (condition)');
  }

}

/**
 * Fake Flow class
 */
class FakeFlowClass {

  getTriggerCard(name) {
    return new FakeTriggerCardClass(name);
  }

  getActionCard(name) {
    return new FakeActionCardClass(name);
  }

  getConditionCard(name) {
    return new FakeConditionCardClass(name);
  }

}

/**
 * Fake Clock class
 */
class FakeClockClass {

  getTimezone() {
    return 'Europe/Oslo';
  }

}

/**
 * Fake Homey class
 */
class FakeHomeyClass {

  constructor(app) {
    this.app = app;
    this.settings = new FakeSettingsClass();
    this.api = new FakeApiClass();
    this.flow = new FakeFlowClass();
    this.clock = new FakeClockClass();
    this.env = env;
  }

  on(event, callback) {
    console.log('TBD implement on(event,callback)');
  }

}

/**
 * Replacement for the Homey API
 */
class App {

  constructor() {
    this.manifest = manifest;
    this.homey = new FakeHomeyClass(this);
    this.log('Replacement for Homey Api Initialized');
  }

  log(value) {
    console.log(value);
  }

}

module.exports = {
  App,
  manifest,
  env,
};
