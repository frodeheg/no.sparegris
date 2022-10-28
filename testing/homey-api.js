/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

'use strict';

let fs = require('fs');

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
      this.driverUri = 'xxxxxx';
      this.deviceId = definition.id;
      this.capabilities = definition.capabilitiesObj;
    }
  }

}

/**
 * Fake Devices class
 */
class FakeDevicesClass {

  constructor(homey) {
    this.homey = homey;
    this.fakeDevices = [];
  }

  getDevices() {
    return this.fakeDevices;
  }

  getDevice(deviceId) {
    return this.fakeDevices[deviceId];
  }

  addFakeDevice(device, zoneName) {
    const zoneObj = this.homey.zones.addZone(zoneName);
    this.fakeDevices.push(new FakeDeviceClass(this.homey, device, zoneObj));
  }

  addFakeDevices(devices, zone) {
    for (let i = 0; i < devices.length; i++) {
      this.addFakeDevice(devices[i], zone);
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

  addZone(fullZone) {
    const splitZone = fullZone.split('/');
    for (let i = 0; i < splitZone.length; i++) {
      const zoneId = [...splitZone].splice(0, i + 1).join('/');
      const parentId = [...splitZone].splice(0, i).join('/');
      const zoneName = splitZone[i];
      if (zoneId in this.zones) continue;
      this.zones[zoneId] = new FakeZoneClass(zoneName, parentId, zoneId);
    }
    return fullZone;
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
    this.devices = new FakeDevicesClass(this);
    this.zones = new FakeZonesClass(this);
  }

}

module.exports = {
  HomeyAPIApp,
};
