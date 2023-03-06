/* eslint-disable comma-dangle */
/* eslint-disable max-len */

'use strict';

/**
 * Required parameters in the cost schema
 * Fixed variables:
 *   - Name
 *   - Granularity (minutes per archive sample)
 * Default variables (can be changed by the user):
 *   - Country
 *   - Currency
 *   - Vat
 *   - Peak start/end times
 *   - Peak weekend
 *   - Limits
 */
const SCHEMA = {
  no: {
    name: 'Norwegian hourly max',
    country: 'no',
    currency: 'NOK',
    granularity: 60,
    expireHourly: 7,
    vat: 25,
    peakStart: '06:00',
    peakEnd: '22:00',
    weekendOffPeak: false,
    gridSteps: true,
    peakMin: 0,
    peakTax: 0,
    limits: {
      quarter: Infinity,
      hour: 5000,
      day: Infinity,
      month: 5000
    },
    hide: {
      costSchemaBox: 'table-row',
      gridStepEn: 'table-row',
      peakStartEn: 'table-row',
      peakEndEn: 'table-row',
      peakWeekendEn: 'table-row',
      enLimit15Box: 'table-row',
      granularityEn: 'table-row',
    }
  },
  be: {
    name: 'Belgian 15 min. max',
    country: 'be',
    currency: 'EUR',
    granularity: 15,
    expireHourly: 2,
    vat: 6, // 25 after March 31, 2023
    peakStart: '07:00', // Varies across Belgium
    peakEnd: '22:00', // Varies across Belgium
    weekendOffPeak: true,
    gridSteps: false,
    peakMin: 2500,
    peakTax: 57.0831,
    limits: {
      quarter: 1500,
      hour: Infinity,
      day: Infinity,
      month: Infinity
    },
    hide: {
      costSchemaBox: 'table-row',
      gridStepEn: 'table-row',
      enLimit60Box: 'table-row',
      granularityEn: 'table-row',
      priceKindOptionUtil: null
    }
  },
  custom: {
    name: 'Custom',
    country: 'de',
    currency: 'EUR',
    granularity: 60,
    expireHourly: 2,
    vat: 25,
    peakStart: '06:00',
    peakEnd: '22:00',
    weekendOffPeak: false,
    gridSteps: true,
    peakMin: 0,
    peakTax: 0,
    limits: {
      quarter: Infinity,
      hour: 5000,
      day: Infinity,
      month: Infinity
    },
    hide: {
      priceKindOptionUtil: null
    }
  }
};

// Countries
const COUNTRY = {
  al: 'Albania',
  at: 'Austria',
  be: 'Belgium',
  ba: 'Bosnia and Herz.',
  bg: 'Bulgaria',
  hr: 'Croatia',
  cy: 'Cyprus',
  cz: 'Czech Republic',
  dk: 'Denmark',
  ee: 'Estonia',
  fi: 'Finland',
  fr: 'France',
  ge: 'Georgia',
  de: 'Germany',
  gr: 'Greece',
  hu: 'Hungary',
  ie: 'Ireland',
  it: 'Italy',
  xk: 'Kosovo',
  lv: 'Latvia',
  lt: 'Lithuania',
  lu: 'Luxembourg',
  mt: 'Malta',
  md: 'Moldova',
  me: 'Montenegro',
  nl: 'Netherlands',
  mk: 'North Macedonia',
  no: 'Norway',
  pl: 'Poland',
  pt: 'Portugal',
  ro: 'Romania',
  rs: 'Serbia',
  sk: 'Slovakia',
  si: 'Slovenia',
  es: 'Spain',
  se: 'Sweden',
  ch: 'Switzerland',
  tr: 'Turkey',
  ua: 'Ukraine',
  uk: 'United Kingdom',
};

let currentSchema = 'no';

// =============================================================================
// = APP FUNCTIONS
// =============================================================================

async function getDefaultSchema(homey) {
  let schema = homey.settings.get('costSchema');
  if (schema === null) {
    const locale = homey.i18n.getLanguage();
    schema = (locale === 'be') ? 'be' : 'no';
  }
  return schema;
}

// =============================================================================
// = SETUP PAGE
// =============================================================================

async function displayHiddenSchema() {
  const keys = Object.keys(SCHEMA[currentSchema].hide);
  for (let i = 0; i < keys.length; i++) {
    const item = document.getElementById(keys[i]);
    const value = SCHEMA[currentSchema].hide[keys[i]];
    if (value === null) item.hidden = false;
    else item.style.display = value;
  }
}

async function hideScemaObjects() {
  const keys = Object.keys(SCHEMA[currentSchema].hide);
  for (let i = 0; i < keys.length; i++) {
    const item = document.getElementById(keys[i]);
    const value = SCHEMA[currentSchema].hide[keys[i]];
    if (value === null) item.hidden = true;
    else item.style.display = 'none';
  }
}
/**
 * Programatically set the new schema without changing anything else.
 */
async function setSchema(newSchema) {
  await displayHiddenSchema();
  currentSchema = newSchema;
  await hideScemaObjects();
}

/**
 * Changes the schema and updates all related values
 * @param {} newSchema
 */
async function changeSchema(newSchema) {
  if (!(newSchema in SCHEMA)) newSchema = 'custom';
  if (newSchema !== currentSchema) {
    // Display old hidden elements
    await displayHiddenSchema();
    currentSchema = newSchema;
    document.getElementById('costSchema').value = newSchema;
    document.getElementById('currency').value = SCHEMA[newSchema].currency;
    document.getElementById('VAT').value = SCHEMA[newSchema].vat;
    document.getElementById('peakStart').value = SCHEMA[newSchema].peakStart;
    document.getElementById('peakEnd').value = SCHEMA[newSchema].peakEnd;
    document.getElementById('weekendOffPeak').checked = SCHEMA[newSchema].weekendOffPeak;
    document.getElementById('gridSteps').checked = SCHEMA[newSchema].gridSteps;
    document.getElementById('peakMin').value = SCHEMA[newSchema].peakMin;
    document.getElementById('peakTax').value = SCHEMA[newSchema].peakTax;
    document.getElementById('granularity').value = SCHEMA[newSchema].granularity;
    document.getElementById('expireHourly').value = SCHEMA[newSchema].expireHourly;
    document.getElementById('enLimit15').checked = SCHEMA[newSchema].limits.quarter !== Infinity;
    document.getElementById('enLimit60').checked = SCHEMA[newSchema].limits.hour !== Infinity;
    document.getElementById('enLimitDay').checked = SCHEMA[newSchema].limits.day !== Infinity;
    document.getElementById('enLimitMonth').checked = SCHEMA[newSchema].limits.month !== Infinity;
    document.getElementById('maxPower15min').value = Math.min(SCHEMA[newSchema].limits.quarter, 25000);
    document.getElementById('maxPowerHour').value = Math.min(SCHEMA[newSchema].limits.hour, 100000);
    document.getElementById('maxPowerDay').value = Math.min(SCHEMA[newSchema].limits.day, 1000);
    document.getElementById('maxPowerMonth').value = Math.min(SCHEMA[newSchema].limits.month, 50000);
    await refreshSchema();
  }
}

async function refreshSchema() {
  if (document.getElementById('gridSteps').checked) {
    document.getElementById('gridStepBlock').style.display = 'block';
    document.getElementById('gridLinearBlock').style.display = 'none';
    document.getElementById('enLimit60InBox').style.display = 'none';
    document.getElementById('enLimit60SelBox').style.display = 'block';
  } else {
    document.getElementById('gridStepBlock').style.display = 'none';
    document.getElementById('gridLinearBlock').style.display = 'block';
    document.getElementById('enLimit60InBox').style.display = 'block';
    document.getElementById('enLimit60SelBox').style.display = 'none';
  }
  // Hide hidden elements
  await hideScemaObjects();
  document.getElementById('maxPower15min').disabled = !document.getElementById('enLimit15').checked;
  document.getElementById('maxPowerHour').disabled = !document.getElementById('enLimit60').checked;
  document.getElementById('maxPowerDay').disabled = !document.getElementById('enLimitDay').checked;
  document.getElementById('maxPowerMonth').disabled = !document.getElementById('enLimitMonth').checked;
  document.getElementById('maxAlarmRate').disabled = !document.getElementById('enLimitMissing').checked;
}

module.exports = {
  SCHEMA,
  COUNTRY,
  setSchema,
  getDefaultSchema,
  changeSchema,
  refreshSchema,
};
