/* eslint-disable import/no-dynamic-require */
/* eslint-disable comma-dangle */

'use strict';

// eslint-disable-next-line no-undef
const homeypath = ('testing' in global && testing) ? '../../testing/' : '';
const { Driver } = require(`${homeypath}homey`);

const supportedDevices = {
  'no.easee:charger': { icon: 'easee.svg' },
  'com.zaptec:go': { icon: 'zaptec.svg' },
  'com.tesla.charger:Tesla': { icon: 'tesla.svg' },
};

class ChargeDriver extends Driver {

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
        targetDriver: null
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
      if (driverId in supportedDevices) {
        const deviceCharger = {
          name: `${this.homey.__('charger.new.controlFor')} ${name}`,
          icon: supportedDevices[driverId].icon,
          data: {
            id: deviceId,
            targetDriver: driverId
          }
        };
        devicelist.push(deviceCharger);
      }
    }

    this.log('onPairListDevices');
    return devicelist;
  }

}

module.exports = ChargeDriver;
