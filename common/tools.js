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

/**
 * Combines a single item. Array and objects are not supported
 */
function combineItem(base, additional) {
  switch (typeof base) {
    case 'number':
    case 'string':
    case 'boolean':
      return base;
    default:
      return additional;
  }
}

/**
 * Combines two associative arrays
 */
function combine(base, additional) {
  const result = { ...base };
  // eslint-disable-next-line no-restricted-syntax
  for (const item in additional) {
    if (item in result) {
      if ((typeof result[item] === 'number')
        || (typeof result[item] === 'string')
        || (typeof result[item] === 'boolean')) {
        // Keep the base value, it's good
      } else {
        // If base is an object then it need to be iterated
        for (let i = 0; i < additional[item].length; i++) {
          result[item][i] = combineItem(result[item][i], additional[item][i]);
        }
      }
    // Else: Number is not in base, so set it from additional
    } else if ((typeof additional[item] === 'number')
      || (typeof additional[item] === 'string')
      || (typeof additional[item] === 'undefined')
      || (typeof additional[item] === 'boolean')) {
      result[item] = additional[item];
    } else if (additional[item] === null) {
      result[item] = null;
    } else if (typeof additional[item] === 'object') {
      result[item] = [...additional[item]]; // Only array-type is supported
    }
    // else type is function - not supported
  }
  return result;
}

/**
 * Sums an array
 */
function sumArray(arr) {
  return arr.reduce((partialSum, a) => partialSum + a, 0);
}

module.exports = {
  isNumber,
  toNumber,
  combine,
  sumArray,
};
