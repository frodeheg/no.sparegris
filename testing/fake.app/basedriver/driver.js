'use strict';

const { Driver } = require('homey');

class MyDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log(`${this.homey.app.id}:${this.manifest.id} has been initialized`);
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return [
      // Example device data, note that `store` is optional
      {
        name: `Fake ${this.manifest.id}`,
        data: {
          id: `my-device ${Math.floor(Math.random() * 10000)}`,
        },
      //   store: {
      //     address: '127.0.0.1',
      //   },
      },
    ];
  }

}

module.exports = MyDriver;
