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

}

module.exports = MyDriver;
