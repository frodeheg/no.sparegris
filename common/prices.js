/* eslint-disable max-len */

'use strict';

const { XMLParser } = require('fast-xml-parser');
const { request } = require('urllib'); // This adds 512kB (1.4MB debug) to the app
const { toLocalTime } = require('./homeytime');

// =============================================================================
// = CURRENCY
// =============================================================================

const WWW_NORGES_BANK_CURRENCY = 'https://data.norges-bank.no/api/data/EXR/B.{toCurrency}.{fromCurrency}.SP?format=sdmx-json&startPeriod={startDate}&endPeriod={endDate}&locale={locale}';
let currencyTable = {
  GBP: { rate: 13.4193, date: '2023-10-06', name: 'Britiske pund' },
  EUR: { rate: 11.6090, date: '2023-10-06', name: 'Euro' },
  SEK: { rate: 1.0004, date: '2023-10-06', name: 'Svenske kroner' },
  DKK: { rate: 1.5567, date: '2023-10-06', name: 'Danske kroner' },
  RUB: { rate: 0.11, date: '2023-10-08', name: 'российские рубли' },
  PLN: { rate: 2.5246, date: '2023-10-06', name: 'Polske zloty' },
  NOK: { rate: 1.00, date: '2023-10-08', name: 'Norske Kroner' },
  AUD: { rate: 6.9883, date: '2023-10-06', name: 'Australske dollar' },
  BGN: { rate: 5.9357, date: '2023-10-06', name: 'Bulgarske lev' },
  BRL: { rate: 2.1249, date: '2023-10-06', name: 'Brasilianske real' },
  CAD: { rate: 8.0106, date: '2023-10-06', name: 'Kanadiske dollar' },
  CHF: { rate: 12.0563, date: '2023-10-06', name: 'Sveitsiske franc' },
  CNY: { rate: 1.5045, date: '2023-10-06', name: 'Kinesiske yuan' },
  CZK: { rate: 0.4753, date: '2023-10-06', name: 'Tsjekkiske koruna' },
  HKD: { rate: 1.4033, date: '2023-10-06', name: 'Hong Kong dollar' },
  HUF: { rate: 0.03012, date: '2023-10-06', name: 'Ungarske forinter' },
  I44: { rate: 120.42, date: '2023-10-06', name: 'Importveid kursindeks' },
  IDR: { rate: 0.00070263, date: '2023-10-06', name: 'Indonesiske rupiah' },
  ILS: { rate: 2.8502, date: '2023-10-06', name: 'Ny israelsk shekel' },
  INR: { rate: 0.13217, date: '2023-10-06', name: 'Indiske rupi' },
  JPY: { rate: 0.073722, date: '2023-10-06', name: 'Japanske yen' },
  KRW: { rate: 0.008158, date: '2023-10-06', name: 'Sørkoreanske won' },
  MXN: { rate: 0.6014, date: '2023-10-06', name: 'Meksikanske peso' },
  MYR: { rate: 2.3316, date: '2023-10-06', name: 'Malaysiske ringgit' },
  NZD: { rate: 6.5547, date: '2023-10-06', name: 'New Zealand dollar' },
  PHP: { rate: 0.19409, date: '2023-10-06', name: 'Filippinske peso' },
  PKR: { rate: 0.03940, date: '2023-10-06', name: 'Pakistanske rupi' },
  RON: { rate: 2.3384, date: '2023-10-06', name: 'Ny rumenske leu' },
  SGD: { rate: 8.0417, date: '2023-10-06', name: 'Singapore dollar' },
  THB: { rate: 0.29711, date: '2023-10-06', name: 'Thailandske baht' },
  TRY: { rate: 0.39790, date: '2023-10-06', name: 'Tyrkiske lira' },
  TWD: { rate: 0.34216, date: '2023-10-06', name: 'Nye taiwanske dollar' },
  TWI: { rate: 132.560, date: '2023-10-06', name: 'Industriens effektive valutakurs' },
  USD: { rate: 10.9902, date: '2023-10-06', name: 'Amerikanske dollar' },
  XDR: { rate: 14.4239, date: '2023-10-06', name: 'IMF Spesielle trekkrettigheter' },
  ZAR: { rate: 0.56650, date: '2023-10-06', name: 'Sørafrikanske rand' },
  BYN: { rate: 3.3222067, date: '2023-10-08', name: 'Nye hviterussiske rubler' },
  BDT: { rate: 0.099106769, date: '2023-10-08', name: 'Bangladeshi taka' },
  MMK: { rate: 0.0052051883, date: '2023-10-08', name: 'Myanmar kyat' },
  ISK: { rate: 0.08010, date: '2023-10-06', name: 'Islandske kroner' },
  VND: { rate: 0.00044786497, date: '2023-10-08', name: 'Vietnamesiske dong' },
};

const defaultCurrency = {
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

async function isValidCurrency(currency) {
  return (currency in currencyTable);
}

async function getDecimals(currency) {
  try {
    const decimals = 2 - Math.round(Math.log10(currencyTable['NOK'].rate / currencyTable[currency].rate));
    return decimals;
  } catch {
    return undefined;
  }
}

let currencyLocale = 'no'; // Updated on request

async function currencyApiInit(homey) {
  currencyLocale = homey.i18n.getLanguage();
  const newCurrencyTable = homey.settings.get('currencyTable');
  if (newCurrencyTable !== null) {
    currencyTable = newCurrencyTable;
  }
}

// Fetch the newest currency conversions
// When failed, return the last known currencies
// @param from - Sets the reference currency
async function fetchCurrencyTable(currencies = '', date, homey) {
  const now = (date === undefined) ? new Date() : new Date(date);
  const someDaysAgo = new Date();
  someDaysAgo.setDate(now.getDate() - 4);
  const startDate = `${String(someDaysAgo.getUTCFullYear())}-${String(someDaysAgo.getUTCMonth() + 1).padStart(2, '0')}-${String(someDaysAgo.getUTCDate()).padStart(2, '0')}`;
  const endDate = `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const toString = (typeof currencies === 'object') ? currencies.join('+') : currencies;
  const webAddress = WWW_NORGES_BANK_CURRENCY
    .replace('{startDate}', startDate)
    .replace('{endDate}', endDate)
    .replace('{toCurrency}', toString)
    .replace('{fromCurrency}', 'NOK')
    .replace('{locale}', currencyLocale);
  try {
    const { data, res } = await request(webAddress, { dataType: 'json' });
    let updated = false;
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
        let latestDateIndexLocal = latestDateIndex;
        while (latestDateIndexLocal >= 0 && !data.data.dataSets[0].series[`0:${i}:0:0`].observations[latestDateIndexLocal]) {
          latestDateIndexLocal--;
        }
        const exchangeRate = +data.data.dataSets[0].series[`0:${i}:0:0`].observations[latestDateIndexLocal][0] / multiplier;
        const exchangeDate = data.data.structure.dimensions.observation[0].values[latestDateIndexLocal].start.substring(0, 10);
        if ((Number.isFinite(exchangeRate)) && (currencyNames[i].id in currencyTable)) {
          // console.log(`Updated currency ${currencyNames[i].id}: ${exchangeRate}`);
          currencyTable[currencyNames[i].id].rate = exchangeRate;
          currencyTable[currencyNames[i].id].date = exchangeDate;
          currencyTable[currencyNames[i].id].name = currencyNames[i].name;
          updated = true;
        } else {
          console.log(`New currency (ignored) ${currencyNames[i].id}: ${exchangeRate}`);
        }
      }
    }
    // Save the new currencies
    if (updated) {
      homey.settings.set('currencyTable', currencyTable);
    }
  } catch (err) {
    // Ignore errors. Instead the currencyTable contain a date which indicate last working date
    console.log(`Fetching currency error: ${err}`);
  }

  const currencyCopy = JSON.parse(JSON.stringify(currencyTable));

  if (currencies === '') return currencyCopy;
  const asArray = Object.entries(currencyCopy);
  const filtered = asArray.filter(([key, value]) => ((typeof currencies === 'object') ? currencies.includes(key) : key === currencies));
  const asObject = Object.fromEntries(filtered);
  return asObject;
}

async function getCurrencyModifier(fromCurrency, toCurrency, date, homey) {
  try {
    const currencyTable2 = await fetchCurrencyTable([toCurrency, fromCurrency], date, homey);
    return currencyTable2[fromCurrency].rate / currencyTable2[toCurrency].rate;
  } catch {
    return undefined;
  }
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
          const price = (currencyModifier === undefined) ? undefined : (serieData[item]['price.amount'] * currencyModifier) / 1000; // serieData is EUR/MW
          if (timeUTC >= startTime) {
            priceData.push({ time: timeUTC.getTime() / 1000, price });
          }
        }
      }
    }
  } catch (err) {
    // Ignore errors.
    console.log(`Error (entsoe.eu): ${err}`);
  }

  return priceData;
}

/**
 * Add taxes to the spot prices
 */
async function applyTaxesOnSpotprice(spotprices, surcharge, VAT, gridTaxDay, gridTaxNight, peakStart, peakEnd, weekendOffPeak, homey) {
  const taxedData = [];
  for (let item = 0; item < spotprices.length; item++) {
    const timeUTC = new Date(spotprices[item].time * 1000);
    const localTime = toLocalTime(timeUTC, homey);
    const minSinceMidnight = localTime.getHours() * 60 + localTime.getMinutes();
    const weekDay = localTime.getDay();
    const isWeekend = weekDay === 6 || weekDay === 0;
    const isPeak = (minSinceMidnight >= peakStart && minSinceMidnight < peakEnd) && !(isWeekend && weekendOffPeak);
    const gridTax = isPeak ? +gridTaxDay : +gridTaxNight;
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
  currencyApiInit,
  defaultCurrency,
  isValidCurrency,
  getDecimals,
  fetchCurrencyTable,
  entsoeApiInit,
  entsoeGetData,
  applyTaxesOnSpotprice,
};
