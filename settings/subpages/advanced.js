/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable no-nested-ternary */

'use strict';

require('../constants');

function updateAdvancedSettings() {
  const chargeMinRow = document.getElementById('chargeMinRow');
  const chargeTarget = document.getElementById('chargeTarget');
  const chargeMin = document.getElementById('chargeMin');
  const chargeThreshold = document.getElementById('chargeThreshold');
  if (+chargeTarget.value === CHARGE_TARGET_FLOW) {
    chargeMin.max = +chargeThreshold.value - 100;
    chargeThreshold.min = +chargeMin.value + 100;
    chargeMinRow.style.display = 'table-row';
  } else {
    chargeThreshold.min = 1700;
    if (+chargeThreshold.value < chargeThreshold.min) {
      chargeThreshold.value = chargeThreshold.min;
    }
    chargeMin.value = 1500;
    chargeMinRow.style.display = 'none';
  }
}

module.exports = {
  updateAdvancedSettings,
};
