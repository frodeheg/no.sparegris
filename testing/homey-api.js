/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

'use strict';

/**
 * Fake Devices class
 */
class FakeDevicesClass {

  getDevices() {
    console.log('TBD: Implement getDevices');
    return {};
  }

}

/**
 * Fake Zones class
 */
class FakeZonesClass {

  getZones() {
    console.log('TBD: Implement getZones');
    return {};
  }

}

/**
 * Replacement for the Homey api
 */
class HomeyAPIApp {

  constructor() {
    console.log('Fake HomeyAPIApp');
    this.devices = new FakeDevicesClass();
    this.zones = new FakeZonesClass();
  }

}

module.exports = {
  HomeyAPIApp,
};
