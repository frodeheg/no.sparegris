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
  updateAdvancedSettings,
  updateArchiveParam,
  submitArchiveParam,
};
