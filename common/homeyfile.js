/* eslint-disable comma-dangle */
'use strict';

const fs = require('fs');

/**
 * Try out different variations of the filename as it is referred differently on HP2019 and HP2023
 * The input name should be relative to the app directory
 * The returned name will have a relative location appended to it depending on the product
 * HP2019 example: '../' appended for 'drivers/drivername/assets/images/large.png')
 * HP2023 example: '../app/' appended for 'drivers/drivername/assets/images/large.png')
 */
async function findFile(fileName) {
  // Trying HP2023 way:
  const HP2023Name = `../app/${fileName}`;
  if (fs.existsSync(HP2023Name)) return Promise.resolve(HP2023Name);

  // Trying HP2019 way:
  const HP2019Name = `../${fileName}`;
  if (fs.existsSync(HP2019Name)) return Promise.resolve(HP2019Name);

  // Unresolved
  this.log(`Failed to find file: ${fileName}`);
  return Promise.reject(new Error(`Could not find ${fileName}`));
}

module.exports = {
  findFile
};

// When including this file in a web-page, inform the main page that loading is complete
if (typeof onScriptLoaded === 'function') {
  onScriptLoaded('homeyfile.js');
} // else the script is not used in a web-page
