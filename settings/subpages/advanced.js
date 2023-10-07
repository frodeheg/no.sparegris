/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable no-nested-ternary */

'use strict';

function checkForCharger(deviceList) {
  let foundCharger = false;
  let foundController = false;
  let chargerOn = false;
  let controllerOn = false;
  for (const key in deviceList) {
    const device = deviceList[key];
    if ((device.driverId in DEVICE_CMD) && (DEVICE_CMD[device.driverId].type === DEVICE_TYPE.CHARGER)) {
      foundCharger = true;
      chargerOn |= device.use;
    }
    if ((device.driverId in DEVICE_CMD) && (DEVICE_CMD[device.driverId].type === DEVICE_TYPE.CHARGE_CONTROLLER)) {
      foundController = true;
      controllerOn |= device.use;
    }
  }
  return { foundCharger, foundController, chargerOn, controllerOn };
}

function updateChargerHints(deviceList) {
  const { foundCharger, foundController, chargerOn, controllerOn } = checkForCharger(deviceList);
  const carChargerMissingHint = document.getElementById('carChargerMissingHint');
  const controllerNotAddedHint = document.getElementById('controllerNotAddedHint');
  const controllerNotEnabledHint = document.getElementById('controllerNotEnabledHint');
  const carChargerDeprecatedHint = document.getElementById('carChargerDeprecatedHint');
  carChargerMissingHint.style.display = 'none';
  controllerNotAddedHint.style.display = 'none';
  controllerNotEnabledHint.style.display = 'none';
  carChargerDeprecatedHint.style.display = 'none';
  if (!foundCharger) {
    carChargerMissingHint.style.display = 'table-row';
  } else if (chargerOn) {
    carChargerDeprecatedHint.style.display = 'table-row';
  } else if (!foundController) {
    controllerNotAddedHint.style.display = 'table-row';
  } else if (!controllerOn) {
    controllerNotEnabledHint.style.display = 'table-row';
  } // Else found charger, controller and enabled
}

module.exports = {
  checkForCharger,
  updateChargerHints,
};

// When including this file in a web-page, inform the main page that loading is complete
if (typeof onScriptLoaded === 'function') {
  onScriptLoaded('advanced.js');
} // else the script is not used in a web-page
