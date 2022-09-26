/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

'use strict';

/**
 * Replacement for the Homey Log
 */
class Log {

  constructor() {
    console.log('Fake Homey logger initialized');
  }

  setExtra(extra) {
  }

}

module.exports = {
  Log,
};
