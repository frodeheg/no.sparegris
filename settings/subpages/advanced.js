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

function updateArchiveParam(Homey, changedId) {
  const archiveParam = document.getElementById('archiveParam');
  const archiveTimespan = document.getElementById('archiveTimespan');
  const archiveSlot = document.getElementById('archiveSlot');
  const archiveItem = document.getElementById('archiveItem');
  const archiveItemRow = document.getElementById('archiveItemRow');
  const archiveValue = document.getElementById('archiveValue');
  const archiveButton = document.getElementById('archiveButton');
  // Early exit
  if (!archiveParam.value || !archiveTimespan.value) return;
  // Disable items:
  if (changedId < 2) {
    archiveSlot.disabled = true;
    archiveSlot.value = '';
  }
  if (changedId < 3) {
    archiveItemRow.style.display = 'none';
    archiveItem.value = '';
    archiveValue.disabled = true;
    archiveButton.disabled = true;
  }
  // Fetch new state:
  switch (changedId) {
    case 0: // Param changed
    case 1: // Timespan changed
      Homey.api('GET', `/apiCommand?cmd=getArchiveSlots&param=${archiveParam.value}&timespan=${archiveTimespan.value}`, null, (err, res) => {
        let options = '<option value="" selected>-</option>';
        for (const idx in res) {
          options += `<option value="${res[idx]}">${res[idx]}</option>`;
        }
        archiveSlot.innerHTML = options;
        archiveSlot.disabled = false;
        archiveItem.value = '';
        archiveValue.value = '';
      });
      break;
    case 2: // Slot changed
    case 3: // item changed
    default:
      Homey.api('GET', `/apiCommand?cmd=getArchiveItem&param=${archiveParam.value}&timespan=${archiveTimespan.value}&slot=${archiveSlot.value}&item=${archiveItem.value}`, null, (err, res) => {
        if (Array.isArray(res)) {
          let options = '<option value="" selected>-</option>';
          for (const idx in res) {
            options += `<option value="${idx}">${idx}: ${res[idx]}</option>`;
          }
          archiveItem.innerHTML = options;
        } else {
          archiveValue.disabled = false;
          archiveValue.value = res;
          archiveButton.disabled = false;
        }
        if (archiveItem.length > 1) {
          archiveItemRow.style.display = 'table-row';
        }
      });
      break;
  }
}

function submitArchiveParam(Homey) {
  const param = document.getElementById('archiveParam');
  const timespan = document.getElementById('archiveTimespan');
  const slot = document.getElementById('archiveSlot');
  const item = document.getElementById('archiveItem');
  const value = document.getElementById('archiveValue');
  const feedback = document.getElementById('archiveFeedback');

  Homey.api('GET', `/apiCommand?cmd=setArchiveItem&param=${param.value}&timespan=${timespan.value}&slot=${slot.value}&item=${item.value}&value=${value.value}`, null, (err, res) => {
    if (err) feedback.innerHTML = `ERROR: ${err}`;
    else feedback.innerHTML = res;
  });
}

module.exports = {
  checkForCharger,
  updateChargerHints,
  updateArchiveParam,
  submitArchiveParam,
};

// When including this file in a web-page, inform the main page that loading is complete
if (typeof onScriptLoaded === 'function') {
  onScriptLoaded('advanced.js');
} // else the script is not used in a web-page
