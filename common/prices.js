/* eslint-disable max-len */

'use strict';

const { XMLParser } = require('fast-xml-parser');
const { request } = require('urllib'); // This adds 512kB (1.4MB debug) to the app

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
  NOK: { rate: 100.000, date: '2022-09-23', name: 'Norske Kroner' },
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
async function fetchCurrencyTable(from = 'NOK') {
  const now = new Date();
  const someDaysAgo = new Date();
  someDaysAgo.setDate(someDaysAgo.getDate() - 4);
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
        const exchangeRate = +data.data.dataSets[0].series[`0:${i}:0:0`].observations[latestDateIndex][0];
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

async function getCurrencyModifier(fromCurrency, toCurrency) {
  const currencyTable = await fetchCurrencyTable(toCurrency);
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
async function entsoeGetData(startTime, currency = 'NOK') {
  const biddingZone = '10YNO-3--------J';

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
        if (unitName !== 'MWH') throw new Error(`Invalid unit in price data: ${unitName}`);
        const currencyModifier = await getCurrencyModifier(fromCurrency, currency);

        const serieTimeUTC = new Date(timeSeries[serie].Period.timeInterval.start);
        const serieData = timeSeries[serie].Period.Point;
        for (let item = 0; item < serieData.length; item++) {
          const timeUTC = new Date(serieTimeUTC.getTime());
          timeUTC.setHours(timeUTC.getHours() + serieData[item].position - 1);
          const price = serieData[item]['price.amount'] / (1000 * currencyModifier);
          if (timeUTC >= startTime) {
            priceData.push({ time: timeUTC, price });
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

let biddingZones = {
  'Albania (AL)': { id: 'CTY|10YAL-KESH-----5|SINGLE', zones: [{ id: 'CTY|10YAL-KESH-----5!BZN|10YAL-KESH-----5', name: 'BZN|AL' }] },
  'Austria (AT)': { id: 'CTY|10YAT-APG------L|SINGLE', zones: [{ id: 'CTY|10YAT-APG------L!BZN|10YAT-APG------L', name: 'BZN|AT' }, { id: 'CTY|10YAT-APG------L!BZN|10Y1001A1001A63L', name: 'BZN|DE-AT-LU' }] },
  'Belgium (BE)': { id: 'CTY|10YBE----------2|SINGLE', zones: [{ id: 'CTY|10YBE----------2!BZN|10YBE----------2', name: 'BZN|BE' }] },
  'Bosnia and Herz. (BA)': { id: 'CTY|10YBA-JPCC-----D|SINGLE', zones: [{ id: 'CTY|10YBA-JPCC-----D!BZN|10YBA-JPCC-----D', name: 'BZN|BA' }] },
  'Bulgaria (BG)': { id: 'CTY|10YCA-BULGARIA-R|SINGLE', zones: [{ id: 'CTY|10YCA-BULGARIA-R!BZN|10YCA-BULGARIA-R', name: 'BZN|BG' }] },
  'Croatia (HR)': { id: 'CTY|10YHR-HEP------M|SINGLE', zones: [{ id: 'CTY|10YHR-HEP------M!BZN|10YHR-HEP------M', name: 'BZN|HR' }] },
  'Cyprus (CY)': { id: 'CTY|10YCY-1001A0003J|SINGLE', zones: [{ id: 'CTY|10YCY-1001A0003J!BZN|10YCY-1001A0003J', name: 'BZN|CY' }] },
  'Czech Republic (CZ)': { id: 'CTY|10YCZ-CEPS-----N|SINGLE', zones: [{ id: 'CTY|10YCZ-CEPS-----N!BZN|10YCZ-CEPS-----N', name: 'BZN|CZ' }, { id: 'CTY|10YCZ-CEPS-----N!BZN|10YDOM-CZ-DE-SKK', name: 'BZN|CZ+DE+SK' }] },
  'Denmark (DK)': { id: 'CTY|10Y1001A1001A65H|SINGLE', zones: [{ id: 'CTY|10Y1001A1001A65H!BZN|10YDK-1--------W', name: 'BZN|DK1' }, { id: 'CTY|10Y1001A1001A65H!BZN|10YDK-2--------M', name: 'BZN|DK2' }] },
  'Estonia (EE)': { id: 'CTY|10Y1001A1001A39I|SINGLE', zones: [{ id: 'CTY|10Y1001A1001A39I!BZN|10Y1001A1001A39I', name: 'BZN|EE' }] },
  'Finland (FI)': { id: 'CTY|10YFI-1--------U|SINGLE', zones: [{ id: 'CTY|10YFI-1--------U!BZN|10YFI-1--------U', name: 'BZN|FI' }] },
  'France (FR)': { id: 'CTY|10YFR-RTE------C|SINGLE', zones: [{ id: 'CTY|10YFR-RTE------C!BZN|10YFR-RTE------C', name: 'BZN|FR' }] },
  'Georgia (GE)': { id: 'CTY|10Y1001A1001B012|SINGLE', zones: [{ id: 'CTY|10Y1001A1001B012!BZN|10Y1001A1001B012', name: 'BZN|GE' }] },
  'Germany (DE)': { id: 'CTY|10Y1001A1001A83F|SINGLE', zones: [{ id: 'CTY|10Y1001A1001A83F!BZN|10YDOM-CZ-DE-SKK', name: 'BZN|CZ+DE+SK' }, { id: 'CTY|10Y1001A1001A83F!BZN|10Y1001A1001A63L', name: 'BZN|DE-AT-LU' }, { id: 'CTY|10Y1001A1001A83F!BZN|10Y1001A1001A82H', name: 'BZN|DE-LU' }] },
  'Greece (GR)': { id: 'CTY|10YGR-HTSO-----Y|SINGLE', zones: [{ id: 'CTY|10YGR-HTSO-----Y!BZN|10YGR-HTSO-----Y', name: 'BZN|GR' }] },
  'Hungary (HU)': { id: 'CTY|10YHU-MAVIR----U|SINGLE', zones: [{ id: 'CTY|10YHU-MAVIR----U!BZN|10YHU-MAVIR----U', name: 'BZN|HU' }] },
  'Ireland (IE)': { id: 'CTY|10YIE-1001A00010|SINGLE', zones: [{ id: 'CTY|10YIE-1001A00010!BZN|10Y1001A1001A59C', name: 'BZN|IE(SEM)' }] },
  'Italy (IT)': { id: 'CTY|10YIT-GRTN-----B|SINGLE', zones: [{ id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A699', name: 'BZN|IT-Brindisi' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001C--00096J', name: 'BZN|IT-Calabria' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A70O', name: 'BZN|IT-Centre-North' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A71M', name: 'BZN|IT-Centre-South' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A72K', name: 'BZN|IT-Foggia' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A66F', name: 'BZN|IT-GR' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A877', name: 'BZN|IT-Malta' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A73I', name: 'BZN|IT-North' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A80L', name: 'BZN|IT-North-AT' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A68B', name: 'BZN|IT-North-CH' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A81J', name: 'BZN|IT-North-FR' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A67D', name: 'BZN|IT-North-SI' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A76C', name: 'BZN|IT-Priolo' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A77A', name: 'BZN|IT-Rossano' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A885', name: 'BZN|IT-SACOAC' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A893', name: 'BZN|IT-SACODC' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A74G', name: 'BZN|IT-Sardinia' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A75E', name: 'BZN|IT-Sicily' }, { id: 'CTY|10YIT-GRTN-----B!BZN|10Y1001A1001A788', name: 'BZN|IT-South' }] },
  'Kosovo (XK)': { id: 'CTY|10Y1001C--00100H|SINGLE', zones: [{ id: 'CTY|10Y1001C--00100H!BZN|10Y1001C--00100H', name: 'BZN|XK' }] },
  'Latvia (LV)': { id: 'CTY|10YLV-1001A00074|SINGLE', zones: [{ id: 'CTY|10YLV-1001A00074!BZN|10YLV-1001A00074', name: 'BZN|LV' }] },
  'Lithuania (LT)': { id: 'CTY|10YLT-1001A0008Q|SINGLE', zones: [{ id: 'CTY|10YLT-1001A0008Q!BZN|10YLT-1001A0008Q', name: 'BZN|LT' }] },
  'Luxembourg (LU)': { id: 'CTY|10YLU-CEGEDEL-NQ|SINGLE', zones: [{ id: 'CTY|10YLU-CEGEDEL-NQ!BZN|10Y1001A1001A63L', name: 'BZN|DE-AT-LU' }, { id: 'CTY|10YLU-CEGEDEL-NQ!BZN|10Y1001A1001A82H', name: 'BZN|DE-LU' }] },
  'Malta (MT)': { id: 'CTY|10Y1001A1001A93C|SINGLE', zones: [{ id: 'CTY|10Y1001A1001A93C!BZN|10Y1001A1001A93C', name: 'BZN|MT' }] },
  'Moldova (MD)': { id: 'CTY|10Y1001A1001A990|SINGLE', zones: [{ id: 'CTY|10Y1001A1001A990!BZN|10Y1001A1001A990', name: 'BZN|MD' }] },
  'Montenegro (ME)': { id: 'CTY|10YCS-CG-TSO---S|SINGLE', zones: [{ id: 'CTY|10YCS-CG-TSO---S!BZN|10YCS-CG-TSO---S', name: 'BZN|ME' }] },
  'Netherlands (NL)': { id: 'CTY|10YNL----------L|SINGLE', zones: [{ id: 'CTY|10YNL----------L!BZN|10YNL----------L', name: 'BZN|NL' }] },
  'North Macedonia (MK)': { id: 'CTY|10YMK-MEPSO----8|SINGLE', zones: [{ id: 'CTY|10YMK-MEPSO----8!BZN|10YMK-MEPSO----8', name: 'BZN|MK' }] },
  'Norway (NO)': { id: 'CTY|10YNO-0--------C|SINGLE', zones: [{ id: 'CTY|10YNO-0--------C!BZN|10YNO-1--------2', name: 'BZN|NO1' }, { id: 'CTY|10YNO-0--------C!BZN|10YNO-2--------T', name: 'BZN|NO2' }, { id: 'CTY|10YNO-0--------C!BZN|50Y0JVU59B4JWQCU', name: 'BZN|NO2NSL' }, { id: 'CTY|10YNO-0--------C!BZN|10YNO-3--------J', name: 'BZN|NO3' }, { id: 'CTY|10YNO-0--------C!BZN|10YNO-4--------9', name: 'BZN|NO4' }, { id: 'CTY|10YNO-0--------C!BZN|10Y1001A1001A48H', name: 'BZN|NO5' }] },
  'Poland (PL)': { id: 'CTY|10YPL-AREA-----S|SINGLE', zones: [{ id: 'CTY|10YPL-AREA-----S!BZN|10YPL-AREA-----S', name: 'BZN|PL' }] },
  'Portugal (PT)': { id: 'CTY|10YPT-REN------W|SINGLE', zones: [{ id: 'CTY|10YPT-REN------W!BZN|10YPT-REN------W', name: 'BZN|PT' }] },
  'Romania (RO)': { id: 'CTY|10YRO-TEL------P|SINGLE', zones: [{ id: 'CTY|10YRO-TEL------P!BZN|10YRO-TEL------P', name: 'BZN|RO' }] },
  'Serbia (RS)': { id: 'CTY|10YCS-SERBIATSOV|SINGLE', zones: [{ id: 'CTY|10YCS-SERBIATSOV!BZN|10YCS-SERBIATSOV', name: 'BZN|RS' }] },
  'Slovakia (SK)': { id: 'CTY|10YSK-SEPS-----K|SINGLE', zones: [{ id: 'CTY|10YSK-SEPS-----K!BZN|10YDOM-CZ-DE-SKK', name: 'BZN|CZ+DE+SK' }, { id: 'CTY|10YSK-SEPS-----K!BZN|10YSK-SEPS-----K', name: 'BZN|SK' }] },
  'Slovenia (SI)': { id: 'CTY|10YSI-ELES-----O|SINGLE', zones: [{ id: 'CTY|10YSI-ELES-----O!BZN|10YSI-ELES-----O', name: 'BZN|SI' }] },
  'Spain (ES)': { id: 'CTY|10YES-REE------0|SINGLE', zones: [{ id: 'CTY|10YES-REE------0!BZN|10YES-REE------0', name: 'BZN|ES' }] },
  'Sweden (SE)': { id: 'CTY|10YSE-1--------K|SINGLE', zones: [{ id: 'CTY|10YSE-1--------K!BZN|10Y1001A1001A44P', name: 'BZN|SE1' }, { id: 'CTY|10YSE-1--------K!BZN|10Y1001A1001A45N', name: 'BZN|SE2' }, { id: 'CTY|10YSE-1--------K!BZN|10Y1001A1001A46L', name: 'BZN|SE3' }, { id: 'CTY|10YSE-1--------K!BZN|10Y1001A1001A47J', name: 'BZN|SE4' }] },
  'Switzerland (CH)': { id: 'CTY|10YCH-SWISSGRIDZ|SINGLE', zones: [{ id: 'CTY|10YCH-SWISSGRIDZ!BZN|10YCH-SWISSGRIDZ', name: 'BZN|CH' }] },
  'Turkey (TR)': { id: 'CTY|10YTR-TEIAS----W|SINGLE', zones: [{ id: 'CTY|10YTR-TEIAS----W!BZN|10YTR-TEIAS----W', name: 'BZN|TR' }] },
  'Ukraine (UA)': { id: 'CTY|10Y1001C--00003F|SINGLE', zones: [{ id: 'CTY|10Y1001C--00003F!BZN|10Y1001C--00003F', name: 'BZN|UA' }, { id: 'CTY|10Y1001C--00003F!BZN|10YUA-WEPS-----0', name: 'BZN|UA-BEI' }, { id: 'CTY|10Y1001C--00003F!BZN|10Y1001A1001A869', name: 'BZN|UA-DobTPP' }, { id: 'CTY|10Y1001C--00003F!BZN|10Y1001C--000182', name: 'BZN|UA-IPS' }] },
  'United Kingdom (UK)': { id: 'CTY|10Y1001A1001A92E|SINGLE', zones: [{ id: 'CTY|10Y1001A1001A92E!BZN|10YGB----------A', name: 'BZN|GB' }, { id: 'CTY|10Y1001A1001A92E!BZN|11Y0-0000-0265-K', name: 'BZN|GB(ElecLink)' }, { id: 'CTY|10Y1001A1001A92E!BZN|10Y1001C--00098F', name: 'BZN|GB(IFA)' }, { id: 'CTY|10Y1001A1001A92E!BZN|17Y0000009369493', name: 'BZN|GB(IFA2)' }, { id: 'CTY|10Y1001A1001A92E!BZN|10Y1001A1001A59C', name: 'BZN|IE(SEM)' }] },
};

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

fetchFromEntsoe();

module.exports = {
  fetchCurrencyTable,
  entsoeApiInit,
  entsoeGetData,

  fetchFromEntsoe,
};
