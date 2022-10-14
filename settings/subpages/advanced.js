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
  chargeMin.max = +chargeThreshold.value - 500;
  chargeThreshold.min = +chargeMin.value + 500;
  if (+chargeTarget.value === CHARGE_TARGET_FLOW) {
    chargeMinRow.style.display = 'table-row';
  } else {
    chargeMinRow.style.display = 'none';
  }
}

module.exports = {
  updateAdvancedSettings,
};
