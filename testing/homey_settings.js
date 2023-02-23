/* eslint-disable comma-dangle */

'use strict';

/**
 * THIS FILE IS A REPLACEMENT FOR HOMEY.JS WHEN TESTING SETTINGS INTERFACE
 */

class FakeHomey {

  constructor(homey) {
    this.callbacks = [];
    // Set up some fake settings
    this.settings = {
      expireDaily: 31,
      expireHourly: 7,
      futurePriceOptions: {
        minCheapTime: 4,
        minExpensiveTime: 4,
        averageTime: 0,
        dirtCheapPriceModifier: -50,
        lowPriceModifier: -10,
        highPriceModifier: 10,
        extremePriceModifier: 100,
        priceKind: 1, // Spot
        priceCountry: 'no',
        priceRegion: 0,
        surcharge: 0.0198, // Ramua kraft energi web
        priceFixed: 0.6,
        gridTaxDay: 0.3626, // Tensio default
        gridTaxNight: 0.2839, // Tensio default
        VAT: 25,
        currency: 'NOK',
        gridCosts: [{ limit: 2000, price: 73 }, { limit: 5000, price: 128 }, { limit: 10000, price: 219 }]
      },
      maxPower: [null, 5000, null, 50000],
      chargerOptions: {
        chargeTarget: 1, // CHARGE_TARGET_AUTO
        chargeMin: 1500,
        chargeThreshold: 2000,
        minToggleTime: 120,
        chargeCycleType: 2, // OFFER_HOURS
        chargeRemaining: 0,
        chargeEnd: '2022-10-15T06:00:08.708Z'
      },
      modeList: [
        // Normal
        [{ id: 'id_a', operation: 2 /* CONTROLLED */, targetTemp: 24 },
          { id: 'id_b', operation: 0 /* ALWAYS_OFF */, targetTemp: 15 },
          { id: 'id_c', operation: 2 /* CONTROLLED */, targetTemp: 20 },
          { id: 'id_d', operation: 2 /* CONTROLLED */, targetTemp: 20 }
        ],
        [], // Night
        [] // Away
      ],
      modeNames: ['Blah', 'Nomode', 'alsoNoMode'],
      frostList: null,
      zones: null,
      override: null,
      priceActionList: null,
      operatingMode: null,
      priceMode: null,
      pricePoint: null,
      errorMargin: null,
      controlTemp: null,
      freeThreshold: null,
      safetyPower: null,
      mainFuse: null,
    };
  }

  ready() {
    // ok, you're ready
  }

  __(string) {
    return string;
  }

  api(type, command, justNull, callback) {
    console.log(`API command: ${command}`);
    const err = undefined;
    let response;
    if (command.includes('/getStats')) {
      let pp;
      if (command.includes('granularity=3')) {
        pp = [1,null,2,3,4,5,1,2,3,4,5,1,2,3];
      } else {
        pp = [[1,2,3,4,5],null,[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5]];
      }
      response = {
        daysInMonth: 31,
        hoursInDay: 24,
        localTime: 1670989328353,
        localDay: 14,
        localMonth: 11,
        localYear: 2022,
        data: {
          // maxPower: [4000, 4900, 4300, 4800, 4500, 4400, 4200, 3200, 1023, 4300],
          maxPower: [4704, 4938, 4021, 4297],
          chargeShedule: [4000, 4000, 0, 0, 4000],
          elPrices: [0.5, 0.43, 0.33, 0.64, 0.93, 0.45, 0.22],
          currentHour: 2,
          price: [1,null,3,4,0.5,1.4,5.2,3.2,2.2,4.2,1.1],
          pricePoints: pp,
          powUsage: [4704, 4938, 4021, 4297],
        },
        // dataGood: [true, true, false, true, true],
        dataGood:[0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1],
        slotLength: {
          dataGood: 15,
          maxPower: 60,
          chargeShedule: 60,
          elPrices: 60,
          price: 60,
          pricePoints: 60,
          powUsage: 60,
        }
      };
      // response = {"daysInMonth":31,slotsInDay:1,"localTime":1670193702771,"localDay":4,"localMonth":11,"localYear":2022,"data":{"error":{}},"dataGood":false};
      // response = {"daysInMonth":31,slotsInDay:24,"localTime":1670213729136,"localDay":5,"localMonth":11,"localYear":2022,"data":{"chargeShedule":[],"elPrices":[0.7127719530932262,0.6934892301956708,0.66827484805007,0.6659562841746125,0.6575514901260789,0.7758755332369289,0.8918657689005378,0.9225674188847215,0.9238812717474807,0.9452507021329477,0.9696729082877671,0.9994471327217678,0.9896898430792174,0.9827534728184737,1.0126436254462472,0.9887044534321479,0.9994664540873965,1.0567349818111982,1.1417489905779745,0.9994471327217678,0.97662859991414,0.967721450359257,0.8608122565411902,0.834921626598581],"currentHour":5,"maxPower":[4379.558582499998,4691.687735833334,1258.170082222223,4726.245076388889,8744.871345833333]},"dataGood":[true,true,true,false,true]};
      // response = {"daysInMonth":31,slotsInDay:24,"localTime":1670303200188,"localDay":6,"localMonth":11,"localYear":2022,"data":{"price":[1,null,3,4,0.5,1.4,5.2,3.2,2.2,4.2,1.1],"pricePoints":[[1,2,3,4,5],null,[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5]]},"dataGood":[true,true,true,false,true]};
    } else if (command.includes('/apiCommand?cmd=createDeviceList')) {
      response = {
        id_a: { name:"DeviceNamenamenamenamename 1", room: "Stue",    image: "https://as2.ftcdn.net/v2/jpg/02/49/76/93/1000_F_249769389_7su5tYXOvcjcehNCcWTwcjnHvSMkLocJ.jpg", use: true, priority: 0, thermostat_cap: true, driverId: 'no.thermofloor:TF_Thermostat' },
        id_b: { name:"DeviceName 2", room: "Kjøkken", image: "https://as2.ftcdn.net/v2/jpg/02/49/76/93/1000_F_249769389_7su5tYXOvcjcehNCcWTwcjnHvSMkLocJ.jpg", use: true, priority: 1, thermostat_cap: true, reliability: 0.5, driverId: 'no.thermofloor:Z-TRM2fx' },
        id_c: { name:"DeviceName 3", room: "Bad",     image: "https://as2.ftcdn.net/v2/jpg/02/49/76/93/1000_F_249769389_7su5tYXOvcjcehNCcWTwcjnHvSMkLocJ.jpg", use: true, priority: 0, thermostat_cap: false, reliability: 0.6, driverId: 'no.thermofloor:Z-TRM3' },
        id_d: { name:"DeviceName 4", room: "Bad",     image: "https://as2.ftcdn.net/v2/jpg/02/49/76/93/1000_F_249769389_7su5tYXOvcjcehNCcWTwcjnHvSMkLocJ.jpg", use: false, priority: 1, thermostat_cap: true, reliability: 0.7, driverId: 'se.husdata:H60' },
        id_e: { name:"DeviceName 3", room: "Bad",     image: "https://as2.ftcdn.net/v2/jpg/02/49/76/93/1000_F_249769389_7su5tYXOvcjcehNCcWTwcjnHvSMkLocJ.jpg", use: true, priority: 0, thermostat_cap: false, reliability: 0.6, driverId: 'com.everspring:AN179' },
        id_e: { name:"Lader", room: "Ute",     image: "https://as2.ftcdn.net/v2/jpg/02/49/76/93/1000_F_249769389_7su5tYXOvcjcehNCcWTwcjnHvSMkLocJ.jpg", use: false, priority: 1, thermostat_cap: false, reliability: 1.0, driverId: 'no.easee:charger' }
      };
    } else if (command.includes('/apiCommand?cmd=getCurrencies')) {
      response = { NOK: 'Norsk krone', SEK: 'Svensk Krone', DKK: 'Dansk Krone' };
    } else if (command.includes('/apiCommand?cmd=getAppConfigProgress')) {
      response = {
        numSpookeyChanges: 0,
        energyMeterNotConnected: false,
        timeSinceEnergyMeter: 10,
        gotPPFromFlow: true,
        ApiStatus: PRICE_API_OK,
        activeLimit: 3
      };
    } else if (command.includes('/apiCommand?cmd=getFullState')) {
      response = { fakestate: true };
    } else if (command.includes('/getDevices?type')) {
      response = [{name: 'Nothing selected', value: ''}, {name: 'something', value: 'avv-bbb'}, {name: 'another thing', value: 'ffe-bbb'}];
    } else if (command.includes('/apiCommand?cmd=getMeterReaders')) {
      response = { CCDEB: 'Eva Meter Reader', CAR: 'Easee Equaliser' };
    } else {
      // No return value expected
      // '/apiCommand?cmd=log'
      // '/apiCommand?cmd=setLogLevel&logLevel'
      // '/apiCommand?cmd=setLogUnit&logUnit'
      // '/apiCommand?cmd=logShowCaps&deviceId'
      // '/apiCommand?cmd=clearLog'
      // '/apiCommand?cmd=sendLog'
    }
    callback(err, response);
  }

  set(settingName, value, callback) {
    this.settings[settingName] = value;
    for (let i = 0; i < this.callbacks.length; i++) {
      if (this.callbacks[i].when === 'set') {
        this.callbacks[i].callback(settingName);
      }
    }
    if (settingName === 'settingsSaved' && value === 'true') {
      callback(new Error('Prentending to have saved'));
    }
  }

  get(settingName, callback) {
    const err = undefined;
    const response = this.settings[settingName] || null;
    callback(err, response);
  }

  on() {
  }

  alert(err) {
    window.alert(err);
  }

  confirm(message, callback) {
    try {
      const result = window.confirm("message");
      callback(null, result);
    } catch (err) {
      callback(err, false);
    }
  }

}

const Homey = new FakeHomey();

function activate() {
  onHomeyReady(Homey);
}

// Using timeout to activate because onHomeyReady is not defined yet at this point
setTimeout(activate, 100);

/** **********************************************************************************
 *                           DEBUG FUNCTIONALITY                                     *
 *********************************************************************************** */

// Show a debug window:
document.write(`
<style>
#mydiv {
  position: absolute;
  z-index: 9;
  background-color: #f1f1f1;
  text-align: center;
  border: 1px solid #d3d3d3;
}

#mydivheader {
  padding: 10px;
  cursor: move;
  z-index: 10;
  background-color: #2196F3;
  color: #fff;
}
</style>

<div id="mydiv">
  <div id="mydivheader">Debug Window</div>
  <p><button onClick="reloadPage();">Reload page</button></p>
  <p><button onClick="showSettings();">Show settings</button></p>
</div>`);

dragElement(document.getElementById("mydiv"));

function dragElement(elmnt) {
  var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  if (document.getElementById(elmnt.id + "header")) {
    /* if present, the header is where you move the DIV from:*/
    document.getElementById(elmnt.id + "header").onmousedown = dragMouseDown;
  } else {
    /* otherwise, move the DIV from anywhere inside the DIV:*/
    elmnt.onmousedown = dragMouseDown;
  }

  function dragMouseDown(e) {
    e = e || window.event;
    e.preventDefault();
    // get the mouse cursor position at startup:
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    // call a function whenever the cursor moves:
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    // calculate the new cursor position:
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    // set the element's new position:
    elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
    elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
  }

  function closeDragElement() {
    /* stop moving when mouse button is released:*/
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

function reloadPage() {
  console.log('Reloading');
  // Clear old charts
  let chartStatus = Chart.getChart("chargeSheduleChart"); // <canvas> id
  if (chartStatus != undefined) {
    chartStatus.destroy();
  }
  // Show load page
  document.getElementById("loadingPage").style.display = 'block';
  // Get all elements with class="tabcontent" and hide them
  let tabcontent = document.getElementsByClassName("tabcontent");
  for (let i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }
  // Hide menu and save button
  document.getElementById("main_menu").style.display = 'none';
  document.getElementById("saveOuter").style.display = 'none';
  // Reset loading status:
  maxPowerLoaded = false;
  deviceListLoaded = false;
  modeListLoaded = false;
  modeNamesLoaded = false;
  operatingModeLoaded = false;
  errorMarginLoaded = false;
  controlTempLoaded = false;
  freeThresholdLoaded = false;
  expireDailyLoaded = false;
  expireHourlyLoaded = false;
  safetyPowerLoaded = false;
  crossSlotSmoothLoaded = false;
  priceModeLoaded = false;
  pricePointLoaded = false;
  priceActionListLoaded = false;
  frostListLoaded = false;
  zoneListLoaded = false;
  overrideListLoaded = false;
  mainFuseLoaded = false;
  meterReaderLoaded = false;
  meterFrequencyLoaded = false;
  toggleTimeLoaded = false;
  graphLoaded = false;
  futurePriceOptionsLoaded = false;
  chargerOptionsLoaded = false;
  appConfigProgressLoaded = false;
  currenciesLoaded = false;
  onHomeyReadyCompleted = false;
  // Refresh page
  onHomeyReady(Homey);
}

function showSettings() {
  console.log(Homey.settings);
}