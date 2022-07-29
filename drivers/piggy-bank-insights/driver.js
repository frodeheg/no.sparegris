'use strict';

const { Driver } = require('homey');

class MyDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.homey.app.updateLog('Piggy Bank Insights has been initialized', 1);
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return [
      {
        //name: 'My Device',
        data: {
          id: 'there-can-only-be-one-instance',
        }
      //   store: {
      //     address: '127.0.0.1',
      //   },
      }
    ];
  }

}

module.exports = MyDriver;
