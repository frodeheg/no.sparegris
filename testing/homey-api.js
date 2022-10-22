/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

'use strict';

/**
 * Fake Devices class
 */
class FakeDevicesClass {

  constructor() {
    this.fakeDevices = {};
  }

  getDevices() {
    console.log('TBD: Implement getDevices');
    return {};
  }

  getDevice(deviceId) {
    return this.fakeDevices[deviceId];
  }

  addFakeDevice(device) {
    this.fakeDevices[device.id] = device;
  }

  addFakeDevices(devices) {
    for (let i = 0; i < devices.length; i++) {
      this.addFakeDevice(devices[i]);
    }
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
