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
    return [
      {
        // name: 'My Device',
        // icon: '',
        data: {
          id: randomId
        }
      //   store: {
      //     address: '127.0.0.1',
      //   },
      }
    ];
  }

}

module.exports = MyDriver;
