/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

'use strict';

const prices = require('./prices');

// Test Currency Converter
// Test that the date for the last currency fetched is recent... otherwise the API could have changed
async function testCurrencyConverter() {
  console.log('Testing Currency Converter');
  const currencyTable = await prices.fetchCurrencyTable('EUR');
  const now = new Date();
  for (const currency in currencyTable) {
    const sampleTime = new Date(currencyTable[currency].date);
    if (currency === 'NOK') continue;
    if (now - sampleTime > 4 * 24 * 60 * 60 * 1000) {
      throw new Error(`No recent samples for currency ${currency}`);
    }
  }
  console.log('Passed.');
}

// Run all the testing
try {
  testCurrencyConverter();
} catch (err) {
  console.log(`Testing failed: ${err}`);
}
