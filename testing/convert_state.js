/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

// eslint-disable-next-line import/no-extraneous-dependencies
const c = require('../common/constants');
const PiggyBank = require('../app');
const { disableTimers, applyStateFromFile, dumpStateToFile, validateModeList, applyUnInit } = require('./test-helpers');

// Testing bad devices:
async function convertState(oldFile, newFile) {
  console.log(`Converting old file '${oldFile}' to new format`);
  const app = new PiggyBank();
  await app.disableLog();
  await applyStateFromFile(app, oldFile);
  await applyUnInit(app);
  app.__deviceList = undefined; // Recreate it in onInit
  await app.onInit(app.__current_power_time);
  app.setLogLevel(c.LOG_DEBUG);
  await disableTimers(app);
  await validateModeList(app);

  // Dump the new file
  await dumpStateToFile(app, newFile);

  await app.onUninit();
  console.log('\x1b[1A[\x1b[32m DONE \x1b[0m]');
}

convertState(process.argv[2], process.argv[3]);
