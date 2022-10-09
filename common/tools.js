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
 * null and undefined will return undefined
 */
function toNumber(value) {
  if ((value === null) || (value === undefined)) return undefined;
  return +value;
}

module.exports = {
  isNumber,
  toNumber,
};
