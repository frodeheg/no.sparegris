/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

'use strict';

const fs = require('fs');

let uniqueID = 1;

/**
 * Due to test environment make the homey global and make sure there is only one instance of zones and devices;
 */
let zones;
let devices;

/**
 * Fake Device class
 */
class FakeDeviceClass {

  constructor(homey, definition, zoneId) {
    this.capabilitiesObj = {};
    this.homey = homey;
    this.zone = zoneId;
    this.zoneName = homey.zones.getZones()[zoneId].name;
    if (typeof (definition) === 'string') {
      // File name
      const data = fs.readFileSync(`./doc/devices/${definition}`, 'utf8');
      const lines = data.split('\n');
      let startFound = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].slice(lines[i].indexOf(': ') + 2);
        if (!startFound) {
          if (line.includes('----- ANALYZING DEVICE -----')) startFound = true;
          continue;
        }
        if (line.includes('--- ANALYZING DEVICE DONE ---')) break;
        let parsed = line.slice(line.indexOf(':') + 1);
        parsed = parsed.replace(/^\s+/, '');
        let capName = line.slice(line.indexOf('\'') + 1);
        capName = capName.slice(0, capName.indexOf('\''));
        const numDevices = Object.keys(this.homey.devices.fakeDevices).length;
        if (line.includes('Device ID:')) this.id = `${parsed}-${numDevices}`;
        else if (line.includes('Device Name:')) this.name = `${parsed} ${numDevices}`;
        else if (line.includes('Driver Uri:')) this.driverUri = parsed;
        else if (line.includes('Driver Id:')) this.driverId = parsed;
        else if (line.includes('Options for')) this.capabilitiesObj[capName] = JSON.parse(parsed);
        else if (line.includes('Capabilities:')) this.capabilities = parsed.split(',');
      }
    } else {
      this.manifest = definition;
      this.driverUri = 'homey:app:unknown';
      this.driverId = 'unknown';
      this.id = definition.id;
      this.capabilitiesObj = definition.capabilitiesObj;
      this.capabilities = Object.keys(this.capabilitiesObj);
    }
  }

  async setCapabilityValue(data) {
    this.capabilitiesObj[data.capabilityId].value = data.value;
  }

  /**
   * This function is not part of the Homey api.
   * It has only been added for testing purposes.
   * The idea is that the state will be set without any random behaviour as can be applied to the
   * setCapabilityValue function during testing.
   */
  async overrideDeviceState(data) {
    this.capabilitiesObj[data.capabilityId].value = data.value;
  }

}

/**
 * Fake Devices class
 */
class FakeDevicesClass {

  constructor(homey) {
    this.homey = homey;
    this.fakeDevices = {};
  }

  getDevices() {
    return this.fakeDevices;
  }

  getDevice(deviceId) {
    return this.fakeDevices[deviceId.id];
  }

  addFakeDevice(device, zoneId, deviceId = undefined) {
    const fakeDevice = new FakeDeviceClass(this.homey, device, zoneId);
    if (deviceId) fakeDevice.id = deviceId;
    this.fakeDevices[fakeDevice.id] = fakeDevice;
    return fakeDevice;
  }

  addFakeDevices(devices, zoneId) {
    for (let i = 0; i < devices.length; i++) {
      this.addFakeDevice(devices[i], zoneId);
    }
  }

}

/**
 * Fake Zone class
 */
class FakeZoneClass {

  constructor(name, parent, id) {
    this.name = name;
    this.parent = parent || null;
    this.id = id;
  }

  // toString() {
  //   return this.name;
  // }

}

/**
 * Fake Zones class
 */
class FakeZonesClass {

  constructor(homey) {
    this.homey = homey;
    this.zones = {};
  }

  addZone(zoneName, zoneId = null, parentId = null) {
    if (zoneId === null) {
      zoneId = uniqueID++;
    }
    this.zones[zoneId] = new FakeZoneClass(zoneName, parentId, zoneId);
    return zoneId;
  }

  getZones() {
    return this.zones;
  }

}

/**
 * Replacement for the Homey api
 */
class HomeyAPIApp {

  constructor() {
    if (devices === undefined) devices = new FakeDevicesClass(this);
    if (zones === undefined) zones = new FakeZonesClass(this);
    this.devices = devices;
    this.zones = zones;
  }

}

module.exports = {
  HomeyAPIApp,
};
