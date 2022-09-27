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
 * Fake API class
 */
class FakeApiClass {

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
 * Fake Homey class
 */
class FakeHomeyClass {

  constructor() {
    this.settings = new FakeSettingsClass();
    this.api = new FakeApiClass();
    this.flow = new FakeFlowClass();
    this.manifest = manifest;
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
    this.homey = new FakeHomeyClass();
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
