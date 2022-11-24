'use strict';

//function require(file) {
//    alert(file);
//}


//require('./homey');

/**
 * THIS FILE IS A REPLACEMENT FOR HOMEY.JS WHEN TESTING SETTINGS INTERFACE
 */

function activate() {
  //onHomeyReady(Homey);
  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);
  if (urlParams.get('debug')=="1") {
    // Not homey, but debug mode
    modeList = [
      // Normal
      [ { id: "id_a", operation: CONTROLLED, targetTemp: 24 },
        { id: "id_b", operation: ALWAYS_OFF, targetTemp: 15 },
        { id: "id_c", operation: CONTROLLED, targetTemp: 20 },
        { id: "id_d", operation: CONTROLLED, targetTemp: 20 }
      ],
      [], // Night
      [] // Away
    ];

    maxPowerLoaded = true;
    deviceListLoaded = true;
    modeListLoaded = true;
    modeNamesLoaded = true;
    frostListLoaded = true;
    zoneListLoaded = true;
    overrideListLoaded = true;
    operatingModeLoaded = true;
    priceModeLoaded = true;
    pricePointLoaded = true;
    priceActionListLoaded = true;
    errorMarginLoaded = true;
    controlTempLoaded = true;
    freeThresholdLoaded = true;
    safetyPowerLoaded = true;
    mainFuseLoaded = true;
    graphLoaded = true;
    futurePriceOptionsLoaded = true;
    chargerOptionsLoaded = true;
    appConfigProgressLoaded = true;
    currenciesLoaded = true;
    onHomeyReadyCompleted = true;
    chargerOptions = {
      chargeTarget: CHARGE_TARGET_AUTO,
      chargeMin: 1500,
      chargeThreshold: 2000,
      minToggleTime: 120,
      chargeCycleType: OFFER_HOURS,
      chargeRemaining: 0,
      chargeEnd: '2022-10-15T06:00:08.708Z'
    }
    futurePriceOptions = {
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
    }
    setTimeout(function () {
      setMaxPower("5000", "0", "100000");
      checkLoadingDone();
    }, 1 * 1000);
    setGridCost(futurePriceOptions.gridCosts);
    graphData = {
      daysInMonth: 31,
      month: 2,
      dailyMax: [4000, 4900, 4300, 4800, 4500, 4400, 4200, 3200, 1023, 4300],
      dailyMaxGood: [true, true, false, true, true],
      chargeShedule: [4000, 4000, 0, 0, 4000],
      elPrices: [0.5, 0.43, 0.33, 0.64, 0.93, 0.45, 0.22],
      currentHour: 2
    };
    updateGraph(graphData);
    updateCarSheduleGraph(graphData);
  }
}

// Using tiemout to activate because onHomeyReady is not defined yet at this point
setTimeout(activate, 1000);
