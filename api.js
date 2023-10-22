/* eslint-disable comma-dangle */

'use strict';

const c = require('./common/constants');

module.exports = {
  async getVersion({ homey, query }) {
    const result = `{"version": "${homey.app.manifest.version}"}`;
    return result;
  },

  async getDevices({ homey, query }) {
    if ('type' in query && query.type >= 1 && query.type <= 5) {
      return homey.app.getDevices(query.type);
    }
    throw (new Error(`Incorrect usage of getDevices(), query was: ${JSON.stringify(query)}`));
  },

  async apiCommand({ homey, query }) {
    switch (query.cmd) {
      case 'clearLog':
        return homey.app.clearLog();
      case 'requestLog':
        return homey.app.updateLog('', c.LOG_ALL);
      case 'sendLog':
        return homey.app.sendLog();
      case 'log':
        return homey.app.updateLog(query.text, query.loglevel);
      case 'logShowCaps':
        return homey.app.logShowCaps(query.deviceId, query.filter);
      case 'setLogLevel':
        return homey.app.setLogLevel(query.logLevel);
      case 'setLogUnit':
        return homey.app.setLogUnit(query.logUnit);
      case 'getLogLevel':
        return homey.app.logLevel;
      case 'getLogUnit':
        return homey.app.logUnit;
      case 'createDeviceList':
        return homey.app.createDeviceList();
      case 'getAppConfigProgress':
        return homey.app.getAppConfigProgress();
      case 'getCurrencies':
        return homey.app.getCurrencies();
      case 'getFullState':
        return homey.app.getFullState();
      case 'getMeterReaders':
        return homey.app.__meterReaders;
      case 'getArchiveItem':
        return homey.app.getArchiveRelay(query.param, query.timespan, query.slot, query.item);
      case 'setArchiveItem':
        return homey.app.replaceArchiveValueRelay(query.param, query.timespan, query.slot, query.item, query.value);
      case 'getArchiveSlots':
        return Object.keys(await homey.app.getArchiveRelay(query.param, query.timespan) || {});
      default:
        throw (new Error(`Incorrect api command: ${query.cmd}`));
    }
  },

  async getStats({ homey, query }) {
    if (query) {
      return homey.app.getStats(query.type, query.time, query.granularity);
    }
    return homey.app.getStats();
  }
};
