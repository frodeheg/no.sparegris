/* eslint-disable comma-dangle */

'use strict';

module.exports = {
  async requestDeviceListRefresh({ homey }) {
    // const result = await homey.app.getsdfsdf();
    await homey.app.createDeviceList();
    // await new Promise(r => setTimeout(r, 5000));
    return 'Done'; // result;
  },

  async getVersion({ homey, query }) {
    const result = `{"version": "${homey.app.manifest.version}"}`;
    return result;
  }
};
