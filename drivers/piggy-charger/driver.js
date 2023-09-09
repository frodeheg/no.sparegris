/* eslint-disable comma-dangle */

'use strict';

const { Driver } = require('homey');

class MyDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.homey.app.updateLog('Piggy Bank Charger has been initialized', 1);
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    const randHex = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, '0');
    const randomId = `${randHex()}-${randHex()}-${randHex()}-${randHex()}`;
    const devicelist = [];

    // First entry is a new flow based charge controller
    // There can be many of this, hence a random id
    const flowDevice = {
      name: this.homey.__('charger.new.flowBased'),
      icon: 'flow.svg',
      data: {
        id: randomId,
        easee: false
      }
      //   store: {
      //     address: '127.0.0.1',
      //   },
    };
    devicelist.push(flowDevice);

    // Add all Easee devices
    const devices = await this.homey.app.createDeviceList();
    const deviceIds = Object.keys(devices);
    for (let idx = 0; idx < deviceIds.length; idx++) {
      const deviceId = deviceIds[idx];
      const { driverId, name } = devices[deviceId];
      if (driverId === 'no.easee:charger') {
        const easeeCharger = {
          name: `${this.homey.__('charger.new.controlFor')} ${name}`,
          icon: 'easee.svg',
          data: {
            id: deviceId,
            easee: true
          }
        };
        devicelist.push(easeeCharger);
      }
    }

    this.log('onPairListDevices');
    return devicelist;
  }

}

module.exports = MyDriver;
