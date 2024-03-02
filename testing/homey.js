/* eslint-disable node/no-unpublished-require */
/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

'use strict';

const { PNG } = require('pngjs/browser');
const manifest = require('../app.json');
const env = require('../env.json');

const drivers = {};

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
 * Fake Device Trigger card class
 */
class FakeDeviceTriggerCardClass {

  constructor(homey, name) {
    this.homey = homey;
    this.name = name;
    if (this.homey.__debug) console.log('TBD: Implement FakeTriggerCard');
  }

  registerRunListener(callback) {
    if (this.homey.__debug) console.log('TBD: Implement registerRunListener');
  }

  trigger(device, tokens) {
    if (device.triggers && (this.name in device.triggers)) {
      device.triggers[this.name](device, tokens);
    }
  }

}

/**
 * Fake Action card class
 */
class FakeActionCardClass {

  constructor(homey, name) {
    this.homey = homey;
    this.name = name;
    this.callback = null;
  }

  registerRunListener(callback) {
    this.callback = callback;
  }

  registerArgumentAutocompleteListener(callback) {
    if (this.homey.__debug) console.log('TBD: Implement registerArgumentAutocompleteListener (action)');
  }

  // Internal function for triggering in test environment
  triggerAction(args) {
    if (this.callback) {
      this.callback(args);
    } else {
      console.log('WARNING: Trying to trigger an action that has not been connected yet');
    }
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
 * Fake token class
 */
class FakeTokenClass {

  constructor(homey, name) {
    this.homey = homey;
    this.name = name;
    this.value = undefined;
    if (this.homey.__debug) console.log('TBD: Implement FakeTokenClass');
  }

  setValue(value) {
    this.value = value;
  }

}

/**
 * Fake Flow class
 */
class FakeFlowClass {

  constructor(homey) {
    this.homey = homey;
    this.triggerCards = {};
    this.actionCards = {};
    this.conditionCards = {};
    this.deviceConditionCards = {};
    this.tokens = {};
  }

  getTriggerCard(name) {
    if (!(name in this.triggerCards)) {
      this.triggerCards[name] = new FakeTriggerCardClass(this.homey, name);
    }
    return this.triggerCards[name];
  }

  getActionCard(name) {
    if (!(name in this.actionCards)) {
      this.actionCards[name] = new FakeActionCardClass(this.homey, name);
    }
    return this.actionCards[name];
  }

  getConditionCard(name) {
    if (!(name in this.conditionCards)) {
      this.conditionCards[name] = new FakeConditionCardClass(this.homey, name);
    }
    return this.conditionCards[name];
  }

  getDeviceTriggerCard(name) {
    if (!(name in this.deviceConditionCards)) {
      this.deviceConditionCards[name] = new FakeDeviceTriggerCardClass(this.homey, name);
    }
    return this.deviceConditionCards[name];
  }

  createToken(name) {
    this.tokens[name] = new FakeTokenClass(this.homey, name);
    return this.tokens[name];
  }

  getToken(name) {
    return this.tokens[name];
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
 * Fake Image class
 */
class FakeImageClass extends PNG {

  constructor() {
    super();
    this.updateFunction = undefined;
    this.path = undefined;
  }

  setStream(stream) {
    this.updateFunction = stream;
  }

  setPath(path) {
    this.path = path;
    if (this.__debug) console.log('TBD load image at path : image.setPath');
  }

  async update() {
    if (this.updateFunction) await this.updateFunction(this);
    return Promise.resolve();
  }

}

/**
 * Fake Images class
 */
class FakeImagesClass {

  constructor(homey) {
    this.homey = homey;
  }

  async createImage() {
    return Promise.resolve(new FakeImageClass());
  }

}

/**
 * Fake Drivers class
 */
class FakeDriversClass {

  constructor(homey) {
    this.homey = homey;
  }

  getDriver(driverId) {
    if (driverId in drivers) {
      return drivers[driverId];
    }
    throw new Error(`Driver Not Initialized: ${driverId}`);
  }

}

/**
 * Fake Homey class
 */
class FakeHomeyClass {

  constructor(app) {
    this.app = app;
    this.settings = new FakeSettingsClass(this);
    this.drivers = new FakeDriversClass(this);
    this.api = new FakeApiClass(this);
    this.flow = new FakeFlowClass(this);
    this.clock = new FakeClockClass(this);
    this.notifications = new FakeNotificationsClass(this);
    this.i18n = new FakeLanguageClass(this);
    this.images = new FakeImagesClass(this);
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

/**
 * Replacement for the Homey device class
 */
class Device {

  constructor(driver) {
    this.homey = driver.homey;
    this.driver = driver;
    this.name = 'Noname';
    this.store = {};
    this.capOptions = {};
    this.caps = {};
    this.camera = {};
    this.data = {};
    this.settings = {};
    this.triggers = {};
    this.driverId = `homey:app:${manifest.id}:${driver.driverId}`;

    // Create default settings
    for (let i = 0; i < manifest.drivers.length; i++) {
      if (manifest.drivers[i].id !== driver.driverId) continue;
      this.setDefaultSettings(manifest.drivers[i].settings);
    }

    driver.__addDevice(this);
  }

  // Internal functions
  setData(newData) {
    this.data = { ...newData };
  }

  setDefaultSettings(settings) {
    for (let i = 0; i < settings.length; i++) {
      if (settings[i].type === 'group') {
        this.setDefaultSettings(settings[i].children);
      } else {
        this.settings[settings[i].id] = settings[i].value;
      }
    }
  }

  setSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  registerTrigger(name, func) {
    this.triggers[name] = func;
  }

  // Public functions
  getData() {
    return this.data;
  }

  getName() {
    return this.name;
  }

  getSetting(setting) {
    return this.settings[setting];
  }

  getSettings() {
    return this.settings;
  }

  getStoreValue(index) {
    return this.store[index];
  }

  setStoreValue(index, value) {
    this.store[index] = value;
  }

  setCapabilityOptions(cap, options) {
    this.capOptions[cap] = options;
  }

  setCapabilityValue(cap, value) {
    this.caps[cap] = value;
  }

  getCapabilityValue(cap) {
    return this.caps[cap];
  }

  registerCapabilityListener(cap, callback) {
    if (this.homey.__debug) console.log('TBD: Implement registerCapabilityListener');
  }

  setCameraImage(id, name, image) {
    this.camera[id] = { name, image };
  }

}

/**
 * Replacement for the Homey driver class
 */
class Driver {

  constructor(driverId, app) {
    this.devices = [];
    this.homey = app.homey;
    this.driverId = driverId;
    for (let i = 0; i < manifest.drivers.length; i++) {
      if (manifest.drivers[i].id === driverId) {
        this.manifest = manifest.drivers[i];
      }
    }
    drivers[driverId] = this;
  }

  __addDevice(device) {
    this.devices.push(device);
  }

  getDevices() {
    return this.devices;
  }

}

module.exports = {
  App,
  manifest,
  env,
  Driver,
  Device,
};
