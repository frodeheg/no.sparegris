'use strict';

/**
 * Global variables
 */
let reportGenerated = false;
const logPageText = `
<fieldset id="reporting">
  <legend data-i18n="settings.deviceinfo.header">deviceinfo.header</legend>
  <label for="deviceFilter"><span data-i18n="settings.deviceinfo.filter">deviceinfo.filter</span>:</label>
  <select id="deviceFilter">
    <option value=0 data-i18n="settings.deviceinfo.noDevice" selected>No device</option>
    <option value=1 data-i18n="settings.deviceinfo.listedExperimental">Experimental device is working</option>
    <option value=2 data-i18n="settings.deviceinfo.listedDevice">Device is not being turned on/off</option>
    <option value=3 data-i18n="settings.deviceinfo.listedTempDevice">Device does not set temperature</option>
    <option value=4 data-i18n="settings.deviceinfo.unlistedDevice">Device is not listed</option>
  </select><br>
  <label for="deviceInfoSelector"><span data-i18n="settings.deviceinfo.selector">deviceinfo.selector</span>:</label>
  <select id="deviceInfoSelector" disabled>
    <option value="" selected>Please wait while populating</option>
  </select><br>
  <label for="email"><span data-i18n="settings.log.email">log.email</span>:</label>
  <input id="email" type="text" value="optional.email@for.feedback" onfocus="if (this.value=='optional.email@for.feedback') this.value=''">
  <label for="comment"><span data-i18n="settings.log.comment">log.comment</span>:</label>
  <input id="comment" type="text" value="Optional" onfocus="if (this.value=='Optional') this.value=''">
  <label for="showCaps"><span data-i18n="settings.deviceinfo.getinfo">deviceinfo.getinfo</span>:</label>
  <button id="showCaps" data-i18n="settings.deviceinfo.analyze">deviceinfo.analyze</button>
</fieldset>
<fieldset id="logGeneric" style="display:none">
  <legend data-i18n="settings.log.generic">log.generic</legend>
  <button id="showPriceApi" data-i18n="settings.log.showPriceApi">log.showPriceApi</button>
  <button id="showState" data-i18n="settings.log.showState">log.showState</button>
</fieldset>
<fieldset>
  <legend data-i18n="settings.log.header">log.header</legend>
  <div id="logExtended" style="display:none">
    <label for="logUnit"><span data-i18n="settings.log.unit">log.unit</span>:</label>
    <select id="logUnit">
      <option value=0>Please Wait while the list is being populated</option>
    </select><br>
    <label for="logLevel"><span data-i18n="settings.log.level">log.level</span>:</label>
    <select id="logLevel">
      <option value=0 data-i18n="settings.log.error">log.error</option>
      <option value=1 data-i18n="settings.log.basic">log.basic</option>
      <option value=2 data-i18n="settings.log.full">log.full</option>
    </select>
  </div>
  <p>
    <button id="clearLog" data-i18n="settings.log.clearLog">log.clearLog</button>
    <button id="sendLog" data-i18n="settings.log.sendLog">log.sendLog</button>
  </p>
    <textarea id="diagLog"></textarea>
  <a href="#ExitLog" data-i18n="settings.log.exit" onclick="changeTab(event, 'helpNotFoundPage');return false;">log.exit</a>
</fieldset>
`;
let logLevelElement;
let logUnitElement;
let diagLogElement;
let showStateElement;
let showCapsElement;
let showPriceApiElement;
let clearLogElement;
let sendLogElement;
let deviceFilterElement;
let deviceInfoSelectorElement;

/**
 * Log initization
 */
async function initializeLogPage(document, Homey) {
  return new Promise((resolve, reject) => {
    document.getElementById('logPage').innerHTML = logPageText;
    const objToTranslate = document.getElementById('logPage').querySelectorAll('[data-i18n]');
    for (let i = 0; i < objToTranslate.length; i++) {
      objToTranslate[i].innerHTML = Homey.__(objToTranslate[i].attributes.getNamedItem('data-i18n').value);
    }
    logLevelElement = document.getElementById('logLevel');
    logUnitElement = document.getElementById('logUnit');
    diagLogElement = document.getElementById('diagLog');
    showStateElement = document.getElementById('showState');
    showCapsElement = document.getElementById('showCaps');
    showPriceApiElement = document.getElementById('showPriceApi');
    clearLogElement = document.getElementById('clearLog');
    sendLogElement = document.getElementById('sendLog');
    deviceFilterElement = document.getElementById('deviceFilter');
    deviceInfoSelectorElement = document.getElementById('deviceInfoSelector');

    // -- Log page -- //
    Homey.on('logUpdate', log => {
      diagLogElement.value = log;
    });

    deviceFilterElement.addEventListener('change', e => {
      deviceInfoSelectorElement.disabled = true; // Disable while waiting for it to update
      deviceInfoSelectorElement.innerHTML = '<option value="" selected>Please wait while populating</selected>';
      if (+deviceFilterElement.value !== 0) {
        Homey.api('GET', `/getDevices?type=${deviceFilterElement.value}`, null, (err, result) => {
          if (err) {
            alertUser(Homey, err);
            return;
          }

          refreshDeviceSelector(result);
          if (result.length > 0) {
            deviceInfoSelectorElement.disabled = false;
          }
        });
      }
    });

    logLevelElement.addEventListener('change', e => {
      Homey.api('GET', `/apiCommand?cmd=setLogLevel&logLevel=${logLevelElement.value}`, null, (err, result) => {
        if (err) alertUser(Homey, err);
      });
    });

    logUnitElement.addEventListener('change', e => {
      Homey.api('GET', `/apiCommand?cmd=setLogUnit&logUnit=${logUnitElement.value}`, null, (err, result) => {
        if (err) alertUser(Homey, err);
      });
    });

    showStateElement.addEventListener('click', e => {
      Homey.api('GET', '/apiCommand?cmd=logShowState', null, (err, result) => {
        if (err) alertUser(Homey, err);
      });
    });

    showCapsElement.addEventListener('click', e => {
      const deviceId = deviceInfoSelectorElement.value;
      const deviceFilter = deviceFilterElement.value;
      // eslint-disable-next-line eqeqeq
      if (deviceId == '') {
        Homey.alert(Homey.__('settings.deviceinfo.noDeviceSelected'));
      } else {
        let reliability;
        try {
          reliability = deviceList[deviceId].reliability;
        } catch (err) {
          reliability = 1; // The unit is not in the deviceList if it is reported as not listed
        }
        if ((deviceId in deviceList) && (reliability < 1)) {
          const alertMessage = Homey.__('settings.deviceinfo.unreliableDevice');
          Homey.alert(alertMessage.replace('${reliability}', Math.round(reliability * 100)));
        }
        Homey.api('GET', `/apiCommand?cmd=logShowCaps&deviceId=${deviceId}&filter=${deviceFilter}`, null, (err, result) => {
          if (err) alertUser(Homey, err);
        });
        reportGenerated = true;
      }
    });

    showPriceApiElement.addEventListener('click', e => {
      Homey.api('GET', '/apiCommand?cmd=logShowPriceApi', null, (err, result) => {
        if (err) alertUser(Homey, err);
      });
    });

    clearLogElement.addEventListener('click', e => {
      Homey.api('GET', '/apiCommand?cmd=clearLog', null, (err, result) => {
        if (err) alertUser(Homey, err);
      });
    });

    sendLogElement.addEventListener('click', e => {
      const email = document.getElementById('email').value;
      const comment = document.getElementById('comment').value;
      // Abort if no report or no email/comment
      if ((reportGenerated === false) && ((email === 'optional.email@for.feedback') || (comment === 'Optional'))) {
        Homey.alert(Homey.__('settings.log.required'));
        return;
      }
      // Ask for permission
      Homey.confirm(Homey.__('settings.log.sendConfirm'), null, (e, ok) => {
        if (ok) {
          // Add user comment before sending
          Homey.api('GET', `/apiCommand?cmd=log&text=Email:%20${email}%0AComment:${comment}&loglevel=${LOG_ALL}`, null, (err, result) => {
            if (err) alertUser(Homey, err);
          });
          // Send the log
          Homey.api('GET', '/apiCommand?cmd=sendLog', null, (err, result) => {
            if (err) alertUser(Homey, Homey.__('settings.log.sendError') + err);
            else Homey.alert(Homey.__('settings.log.thankYou'));
          });
        }
      });
    });

    // Refresh log units
    Homey.api('GET', `/getDevices?type=5`, null, (err, result) => {
      if (err) {
        alertUser(Homey, err);
        return;
      }

      refreshDeviceUnitSelector(result);
      if (result.length > 0) {
        logUnitElement.disabled = false;
      }
      Homey.api('GET', '/apiCommand?cmd=getLogUnit', null, (err, logUnit) => {
        if (err) logUnit = '';
        logUnitElement.value = logUnit;
      });
    });

    // Refresh log data
    Homey.api('GET', '/apiCommand?cmd=getLogLevel', null, (err, logLevel) => {
      if (err || !Number.isInteger(+logLevel)) logLevel = 0;
      logLevelElement.value = logLevel;
    });
    Homey.api('GET', '/apiCommand?cmd=requestLog', null, (err, result) => {
      if (err) reject(err);
      resolve();
    });
  });
}

/**
 * Refresh deviceLogSelector
 */
function refreshDeviceUnitSelector(devices) {
  let options = '';
  for (let i = 0; i < devices.length; i++) {
    const selVal = (devices[i].value === '') ? 'selected' : '';
    options += `<option value="${devices[i].value}" ${selVal}>${devices[i].name}</option>`;
  }
  logUnitElement.innerHTML = options;
}

/**
 * Checker to check if logging is enabled
 */
function isLoggingEnabled() {
  return (+document.getElementById('logLevel').value !== 0) || (document.getElementById('logUnit').value !== '');
}

/**
 * Switch to the log page
 */
function changeToLogPage(debugMode) {
  if (debugMode) {
    // Show debug options / Hide reporting
    document.getElementById('logGeneric').style.display = 'none';// 'block';
    document.getElementById('logExtended').style.display = 'block';
    document.getElementById('reporting').style.display = 'none';
    document.getElementById('sendLog').style.display = 'none';
  } else {
    // Hide debug options / Show reporting
    document.getElementById('logGeneric').style.display = 'none';
    document.getElementById('logExtended').style.display = 'none';
    document.getElementById('reporting').style.display = 'block';
    document.getElementById('sendLog').style.display = 'block';
  }
  // Make the log text area fill the page
  diagLogElement.setAttribute('cols', (diagLogElement.parentElement.clientWidth - 20) / 8);
  diagLogElement.style.height = `${(window.innerHeight - diagLogElement.offsetTop - 120)}px`;
}

module.exports = {
  initializeLogPage,
  isLoggingEnabled,
  changeToLogPage,
};
