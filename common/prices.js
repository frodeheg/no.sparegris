/* eslint-disable max-len */

'use strict';

const { XMLParser } = require('fast-xml-parser');
const { request } = require('urllib'); // This adds 512kB (1.4MB debug) to the app
const { PP_LOW } = require('./constants');
const { toLocalTime } = require('./homeytime');

// =============================================================================
// = CURRENCY
// =============================================================================

const WWW_NORGES_BANK_CURRENCY = 'https://data.norges-bank.no/api/data/EXR/B.GBP+EUR+SEK+DKK+RUB+PLN.NOK.SP?format=sdmx-json&startPeriod={startDate}&endPeriod={endDate}&locale=no';
const currencyTable = {
  GBP: { rate: 11.6025, date: '2022-09-23', name: 'Pound sterling' },
  EUR: { rate: 10.2335, date: '2022-09-23', name: 'Euro' },
  SEK: { rate: 93.6000, date: '2022-09-23', name: 'Svenska krona' },
  DKK: { rate: 137.610, date: '2022-09-23', name: 'Danish krone' },
  RUB: { rate: 545.750, date: '2022-09-23', name: 'российские рубли' },
  PLN: { rate: 2.15250, date: '2022-09-23', name: 'Polski złoty' },
  NOK: { rate: 1.00000, date: '2022-09-23', name: 'Norske Kroner' },
};

const homeyCodeToCurrency = {
  en: 'GBP',
  nl: 'EUR',
  de: 'EUR',
  fr: 'EUR',
  it: 'EUR',
  sv: 'SEK',
  no: 'NOK',
  es: 'EUR',
  da: 'DKK',
  ru: 'RUB',
  pl: 'PLN',
};

// Fetch the newest currency conversions
// When failed, return the last known currencies
// @param from - Sets the reference currency
async function fetchCurrencyTable(from = 'NOK', date) {
  const now = (date === undefined) ? new Date() : new Date(date);
  const someDaysAgo = new Date();
  someDaysAgo.setDate(now.getDate() - 4);
  const startDate = `${String(someDaysAgo.getUTCFullYear())}-${String(someDaysAgo.getUTCMonth() + 1).padStart(2, '0')}-${String(someDaysAgo.getUTCDate()).padStart(2, '0')}`;
  const endDate = `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const webAddress = WWW_NORGES_BANK_CURRENCY
    .replace('{startDate}', startDate)
    .replace('{endDate}', endDate);
  let currencyCopy;
  try {
    const { data, res } = await request(webAddress, { dataType: 'json' });
    if (res.status === 200) {
      // Find latest date
      const latestDateIndex = data.data.structure.dimensions.observation[0].values.length - 1;
      const currencyNames = data.data.structure.dimensions.series[1].values;
      for (let i = 0; i < currencyNames.length; i++) {
        const attribIndices = data.data.dataSets[0].series[`0:${i}:0:0`].attributes;
        const attribs = data.data.structure.attributes.series;
        let multiplier;
        for (let attribIdx = 0; attribIdx < attribIndices.length; attribIdx++) {
          switch (attribs[attribIdx].id) {
            case 'UNIT_MULT':
              multiplier = 10 ** attribs[attribIdx].values[+attribIndices[attribIdx]].id;
              break;
            case 'DECIMALS':
            case 'CALCULATED':
            case 'COLLECTION':
            default:
              break; // Ignore
          }
        }
        const exchangeRate = +data.data.dataSets[0].series[`0:${i}:0:0`].observations[latestDateIndex][0] / multiplier;
        const exchangeDate = data.data.structure.dimensions.observation[0].values[latestDateIndex].start.substring(0, 10);
        currencyTable[currencyNames[i].id].rate = exchangeRate;
        currencyTable[currencyNames[i].id].date = exchangeDate;
      }
    }
    //
    currencyCopy = JSON.parse(JSON.stringify(currencyTable));
    const divider = currencyCopy[from].rate;
    // eslint-disable-next-line guard-for-in, no-restricted-syntax
    for (const currency in currencyCopy) {
      currencyCopy[currency].rate /= divider;
    }
  } catch (err) {} // Ignore errors. Instead the currencyTable contain a date which indicate last working date

  return currencyCopy;
}

async function getCurrencyModifier(fromCurrency, toCurrency, date) {
  const currencyTable = await fetchCurrencyTable(toCurrency, date);
  return currencyTable[fromCurrency].rate;
}

// =============================================================================
// = ENTSOE
// =============================================================================

const WWW_ENTSOE_DAYAHEAD = 'https://web-api.tp.entsoe.eu/api?securityToken={apiKey}&documentType=A44&processType=A01&In_Domain={biddingZone}&Out_Domain={biddingZone}&periodStart={startDate}&periodEnd={endDate}';

let entsoeApiKey; // Updated on request

async function entsoeApiInit(apiKey) {
  entsoeApiKey = apiKey;
}

/**
 * Should check for the following:
 * Parameters described at: https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html
 * documentType = A44 // Price Document
 * processType  = A01 // Day Ahead
 * Out_Domain   = 10YNO-3--------J // Midt-Norge
 * periodStart  = YYYYMMDD0000
 * periodEnd    = YYYYMMDD2300
 *
 * Contract_MarketAgreement = A13 (Hourly)
 * ProcessType = A01 (Day ahead)
 */
async function entsoeGetData(startTime, currency = 'NOK', biddingZone) {
  const tomorrow = new Date(startTime.getTime());
  tomorrow.setDate(tomorrow.getDate() + 2);
  // tomorrow.setHours(tomorrow.getHours() + 23);
  const startDate = `${String(startTime.getUTCFullYear())}${String(startTime.getUTCMonth() + 1).padStart(2, '0')}${String(startTime.getUTCDate()).padStart(2, '0')}0000`;
  const endDate = `${String(tomorrow.getUTCFullYear())}${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}${String(tomorrow.getUTCDate()).padStart(2, '0')}2300`;
  const webAddress = WWW_ENTSOE_DAYAHEAD
    .replace('{startDate}', startDate)
    .replace('{endDate}', endDate)
    .replace(/{biddingZone}/g, biddingZone)
    .replace('{apiKey}', entsoeApiKey);
  const priceData = [];
  try {
    const { data, res } = await request(webAddress, { dataType: 'xml' });
    if (res.status === 200) {
      const parser = new XMLParser();
      const jsonData = parser.parse(data);
      const timeSeries = jsonData.Publication_MarketDocument.TimeSeries;
      for (let serie = 0; serie < timeSeries.length; serie++) {
        const fromCurrency = timeSeries[serie]['currency_Unit.name'];
        const unitName = timeSeries[serie]['price_Measure_Unit.name'];
        const seriesStartTime = timeSeries[serie].Period.timeInterval.start;
        if (unitName !== 'MWH') throw new Error(`Invalid unit in price data: ${unitName}`);
        const currencyModifier = await getCurrencyModifier(fromCurrency, currency, seriesStartTime);

        const serieTimeUTC = new Date(timeSeries[serie].Period.timeInterval.start);
        const serieData = timeSeries[serie].Period.Point;
        for (let item = 0; item < serieData.length; item++) {
          const timeUTC = new Date(serieTimeUTC.getTime());
          timeUTC.setHours(timeUTC.getHours() + serieData[item].position - 1);
          const price = (serieData[item]['price.amount'] * currencyModifier) / 1000; // serieData is EUR/MW
          if (timeUTC >= startTime) {
            priceData.push({ time: timeUTC.getTime() / 1000, price });
          }
        }
      }
    }
  } catch (err) {
    // Ignore errors.
    console.log(`Error: ${err}`);
  }

  return priceData;
}

/**
 * Add taxes to the spot prices
 */
async function applyTaxesOnSpotprice(spotprices, surcharge, VAT, gridTaxDay, gridTaxNight, homey) {
  const taxedData = [];
  for (let item = 0; item < spotprices.length; item++) {
    const timeUTC = new Date(spotprices[item].time * 1000);
    const localTime = toLocalTime(timeUTC, homey);
    const gridTax = (localTime.getHours() >= 6 && localTime.getHours() < 22) ? +gridTaxDay : +gridTaxNight;
    taxedData.push({ time: spotprices[item].time, price: spotprices[item].price * (1 + +VAT) + gridTax + +surcharge });
  }
  return taxedData;
}

// =============================================================================
// = OTHER
// =============================================================================

// Web pages
const WWW_GRID_COST = 'https://github.com/digin-energi/API-nettleie-for-styring';
const WWW_NORDPOOL = 'https://www.nordpoolgroup.com/api/marketdata/page/23?currency=NOK';
const WWW_ENTSOE = 'https://transparency.entsoe.eu/transmission-domain/r2/dayAheadPrices/show?name=&defaultValue=false&viewType=GRAPH&areaType=BZN&atch=false&dateTime.dateTime={date}+00:00|UTC|DAY&biddingZone.values={zone}&resolution.values=PT60M&dateTime.timezone=UTC&dateTime.timezone_input=UTC';
//const entsoeApi = new ENTSOEapi('YOUR-WEB-API-KEY');

// Errors:
const ERROR_COULD_NOT_PARSE_WEB_PAGE = 'Invalid price data, (could not parse web page)';
const ERROR_COULD_NOT_FETCH_WEB_PAGE = 'Could not fetch price data, server down';

/*
// Find first tag of a given type
async function findData(data, pre, post, fromindex) {
  const startPos = data.indexOf(pre, fromindex);
  const stopPos = data.indexOf(post, startPos + pre.length);
  if (startPos < 0 || stopPos < 0) {
    return null;
  }
  const foundData = data.substring(startPos + pre.length, stopPos);
  return {
    pos: startPos + pre.length,
    data: foundData,
  };
}

// Fetch Entsoe web page
async function returnEntsoePage(date, zone) {
  const webAddress = WWW_ENTSOE
    .replace('{date}', date)
    .replace('{zone}', zone);
  try {
    const { data, res } = await request(webAddress, { dataType: 'text' });
    if (res.status === 200) {
      return data;
    }
  } catch (err) {}
  throw (new Error(ERROR_COULD_NOT_FETCH_WEB_PAGE));
}

// Build Entsoe bidding zones
async function getEntsoeBiddingZones() {
  const allZones = {};
  let country;
  let zoneName;
  let tag;
  const fullPage = await returnEntsoePage('26.09.2022', 'CTY|10YNO-0--------C!BZN|10YNO-1--------2');
  const zonesAsText = await findData(fullPage, '<div id="dv-market-areas-content" class="dv-filter-content dv-single-select-checkboxes dv-business-filter-primary">', '');
  let searchPos = zonesAsText.pos;
  // eslint-disable-next-line no-cond-assign
  while (tag = await findData(fullPage, 'type="checkbox" value="', '"', searchPos)) {
    // console.log(`tag: ${tag.data}`);
    searchPos = tag.pos + tag.data.length;
    const data = await findData(fullPage, '><label for="', '">', searchPos);
    if (+data.data > 0) {
      country = await findData(fullPage, '">', '</label>', data.pos);
      allZones[country.data] = { id: tag.data, zones: []};
      searchPos = country.pos;
    } else if (data.data.substring(0, 18) === 'biddingZone.values') {
      zoneName = await findData(fullPage, '">', '</label>', data.pos);
      allZones[country.data].zones.push({ id: tag.data, name: zoneName.data });
      searchPos = zoneName.pos;
    } else if (Object.keys(allZones).length > 0) {
      // End of zone tables should have been found
      return allZones;
    } else {
      throw (new Error(ERROR_COULD_NOT_PARSE_WEB_PAGE));
    }
  }
  return allZones; // This will never be hit because the return above will be used instead
}

// Fetch prices
async function fetchFromEntsoe() {
  const date = '26.09.2022';
  const webAddress = WWW_ENTSOE.replace('{date}', date);
  try {
    const { data, res } = await request(webAddress, { dataType: 'text' });
    if (res.status === 200) {
      const foundData = JSON.parse(await findData(data, 'var chart = ', ';').data);
      if (!('chartData' in foundData) || !Array.isArray(foundData.chartData)) {
        return undefined;
      }
      const priceArray = [];
      for (let i = 0; i < foundData.chartData.length; i++) {
        const line = foundData.chartData[i];
        const time = line.cat;
        const price = +line.val1;
        priceArray[i] = { time, price };
      }
      console.log(`aaa: ${JSON.stringify(priceArray)}`);
      return priceArray;
    }
    console.log(`error(${JSON.stringify(res)})`);
    return undefined;
  } catch (err) {
    return undefined;
  }
}

fetchFromEntsoe(); */

module.exports = {
  fetchCurrencyTable,
  entsoeApiInit,
  entsoeGetData,
  applyTaxesOnSpotprice,
};
