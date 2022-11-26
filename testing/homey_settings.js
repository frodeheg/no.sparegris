/* eslint-disable comma-dangle */

'use strict';

/**
 * THIS FILE IS A REPLACEMENT FOR HOMEY.JS WHEN TESTING SETTINGS INTERFACE
 */

class FakeHomey {

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
      response = {
        daysInMonth: 31,
        month: 2,
        dailyMax: [4000, 4900, 4300, 4800, 4500, 4400, 4200, 3200, 1023, 4300],
        dailyMaxGood: [true, true, false, true, true],
        chargeShedule: [4000, 4000, 0, 0, 4000],
        elPrices: [0.5, 0.43, 0.33, 0.64, 0.93, 0.45, 0.22],
        currentHour: 2
      };
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
      response = { nok: 'NOK' };
    } else if (command.includes('/apiCommand?cmd=getAppConfigProgress')) {
      response = {
        numSpookeyChanges: 0,
        energyMeterNotConnected: false,
        timeSinceEnergyMeter: 10,
        gotPPFromFlow: true,
        ApiStatus: PRICE_API_OK
      };
    } else if (command.includes('/apiCommand?cmd=getFullState')) {
      response = { fakestate: true };
    } else if (command.includes('/getDevices?type')) {
      response = [{name: 'tullings', value: 'asd-fde'}, {name: 'fertt', value: 'avv-bbb'}];
    } else {
      // No return value expected
      // '/apiCommand?cmd=log'
      // '/apiCommand?cmd=setLogLevel&logLevel'
      // '/apiCommand?cmd=setLogUnit&logUnit'
      // '/apiCommand?cmd=logShowState'
      // '/apiCommand?cmd=logShowCaps&deviceId'
      // '/apiCommand?cmd=logShowPriceApi'
      // '/apiCommand?cmd=clearLog'
      // '/apiCommand?cmd=sendLog'
    }
    callback(err, response);
  }

  get(settingName, callback) {
    const err = undefined;
    let response;
    switch (settingName) {
      case 'futurePriceOptions':
        response = {
          minCheapTime: 4,
          minExpensiveTime: 4,
          averageTime: 0,
          dirtCheapPriceModifier: -50,
          lowPriceModifier: -10,
          highPriceModifier: 10,
          extremePriceModifier: 100,
          priceKind: 1, // Spot
          priceCountry: 'Norway (NO)',
          priceRegion: 0,
          surcharge: 0.0198, // Ramua kraft energi web
          priceFixed: 0.6,
          gridTaxDay: 0.3626, // Tensio default
          gridTaxNight: 0.2839, // Tensio default
          VAT: 25,
          currency: 'NOK',
          gridCosts: [{ limit: 2000, price: 73 }, { limit: 5000, price: 128 }, { limit: 10000, price: 219 }]
        };
        break;
      case 'maxPower':
        response = 5000;
        break;
      case 'chargerOptions':
        response = {
          chargeTarget: CHARGE_TARGET_AUTO,
          chargeMin: 1500,
          chargeThreshold: 2000,
          minToggleTime: 120,
          chargeCycleType: OFFER_HOURS,
          chargeRemaining: 0,
          chargeEnd: '2022-10-15T06:00:08.708Z'
        };
        break;
      case 'modeList':
        response = [
          // Normal
          [{ id: 'id_a', operation: CONTROLLED, targetTemp: 24 },
            { id: 'id_b', operation: ALWAYS_OFF, targetTemp: 15 },
            { id: 'id_c', operation: CONTROLLED, targetTemp: 20 },
            { id: 'id_d', operation: CONTROLLED, targetTemp: 20 }
          ],
          [], // Night
          [] // Away
        ];
        break;
      case 'modeNames':
        response = ['Blah', 'Nomode', 'alsoNoMode'];
        break;
      case 'frostList':
        response = null;
        break;
      case 'zones':
        response = null;
        break;
      case 'override':
        response = null;
        break;
      case 'priceActionList':
        response = null;
        break;
      case 'operatingMode':
        response = null;
        break;
      case 'priceMode':
        response = null;
        break;
      case 'pricePoint':
        response = null;
        break;
      case 'errorMargin':
        response = null;
        break;
      case 'controlTemp':
        response = null;
        break;
      case 'freeThreshold':
        response = null;
        break;
      case 'safetyPower':
        response = null;
        break;
      case 'mainFuse':
        response = null;
        break;
      default:
    }
    callback(err, response);
  }

  on() {
  }

  alert(err) {
    window.alert(err);
  }

}

const Homey = new FakeHomey();

function activate() {
  onHomeyReady(Homey);
}

// Using timeout to activate because onHomeyReady is not defined yet at this point
setTimeout(activate, 100);
