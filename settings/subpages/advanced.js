/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable no-nested-ternary */

'use strict';

require('../constants');

function updateAdvancedSettings() {
  const chargeMin = document.getElementById('chargeMin');
  const chargeMax = document.getElementById('chargeMax');
  const chargeTarget = document.getElementById('chargeTarget');
  const chargeDevice = document.getElementById('chargeDevice');
  const chargeDeviceRow = document.getElementById('chargeDeviceRow');
  const numPhases = document.getElementById('numPhases');
  if (+chargeTarget.value === CHARGE_TARGET_MANUAL) {
    let options = '';
    for (let key in deviceList) {
      let device = deviceList[key];
      // Only list selected devices
      if (!device.use) continue;
      // Do not list known devices that are not relays
      if (device.driverId in DEVICE_CMD && DEVICE_CMD[device.driverId].type !== DEVICE_TYPE.SWITCH) continue;
      // Only list unknown devices and relays that are selected
      options += `<option value="${key}">${device.name} - ${device.room}</option>`;
    }
    chargeDevice.innerHTML = options;
    chargeDevice.value = chargerOptions.chargeDevice;
    chargeDeviceRow.style.display = 'table-row';
    chargeMax.disabled = true;
    chargeMax.value = chargeMin.value;
    chargeMin.max = 20000;
    numPhases.value = 2;
    numPhases.disabled = true;
} else {
    chargeDeviceRow.style.display = 'none';
    chargeMax.disabled = false;
    chargeMin.max = chargeMax.value;
    numPhases.disabled = false;
}

  chargeMax.min = chargeMin.value;
}

module.exports = {
  updateAdvancedSettings,
};
