/* eslint-disable comma-dangle */

'use strict';

module.exports = {
  async getVersion({ homey, query }) {
    const result = `{"version": "${homey.app.manifest.version}"}`;
    return result;
  }
};
