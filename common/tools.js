/* eslint-disable max-len */

'use strict';

// =============================================================================
// = HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a parameter is a number
 */
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Convert text to numbers.
 * null, undefined and NaN will return undefined
 */
function toNumber(value) {
  if ((value === null)
    || (value === undefined)
    || (Number.isNaN(+value))) return undefined;
  return +value;
}

module.exports = {
  isNumber,
  toNumber,
};
