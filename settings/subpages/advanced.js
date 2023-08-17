/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable no-nested-ternary */

'use strict';

function checkForCharger(deviceList) {
  let foundCharger = false;
  let chargerUsed = false;
  for (const key in deviceList) {
    const device = deviceList[key];
    if ((device.driverId in DEVICE_CMD) && (DEVICE_CMD[device.driverId].type === DEVICE_TYPE.CHARGER)) {
      foundCharger = true;
      chargerUsed |= device.use;
    }
  }
  return { foundCharger, chargerUsed };
}

function updateChargerHints(deviceList) {
  const { foundCharger, chargerUsed } = checkForCharger(deviceList);
  const carChargerMissingHint = document.getElementById('carChargerMissingHint');
  const carChargerNotAddedHint = document.getElementById('carChargerNotAddedHint');
  const chargeTarget = document.getElementById('chargeTarget');
  if (foundCharger && chargerUsed) {
    carChargerMissingHint.style.display = 'none';
    carChargerNotAddedHint.style.display = 'none';
    chargeTarget.value = CHARGE_TARGET_AUTO;
  } else if (foundCharger && !chargerUsed) {
    carChargerMissingHint.style.display = 'none';
    carChargerNotAddedHint.style.display = 'table-row';
    chargeTarget.value = CHARGE_TARGET_FLOW;
  } else {
    carChargerMissingHint.style.display = 'table-row';
    carChargerNotAddedHint.style.display = 'none';
    chargeTarget.value = CHARGE_TARGET_FLOW;
  }
}

function updateAdvancedSettings() {
  const chargeMinRow = document.getElementById('chargeMinRow');
  const chargeTarget = document.getElementById('chargeTarget');
  const chargeMin = document.getElementById('chargeMin');
  const chargeThreshold = document.getElementById('chargeThreshold');
  const overrides = document.getElementById('overrides');
  if (+chargeTarget.value === CHARGE_TARGET_FLOW) {
    chargeMin.max = +chargeThreshold.value - 100;
    chargeThreshold.min = +chargeMin.value + 100;
    chargeMinRow.style.display = 'table-row';
    overrides.style.display = 'none';
  } else {
    chargeThreshold.min = 1700;
    if (+chargeThreshold.value < chargeThreshold.min) {
      chargeThreshold.value = chargeThreshold.min;
    }
    chargeMin.value = 1500;
    chargeMinRow.style.display = 'none';
    overrides.style.display = 'block';
  }
}

module.exports = {
  checkForCharger,
  updateChargerHints,
  updateAdvancedSettings,
};

// When including this file in a web-page, inform the main page that loading is complete
if (typeof onScriptLoaded === 'function') {
  onScriptLoaded('advanced.js');
} // else the script is not used in a web-page
