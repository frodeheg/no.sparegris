
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
    vat: 25,
    peakStart: '06:00',
    peakEnd: '22:00',
    WeekendOffPeak: false,
    gridSteps: true,
    peakMin: 0,
    peakTax: 0,
    limits: {
      quarter: false,
      hour: true,
      day: false,
      month: true
    },
    hide: {
      costSchemaBox: 'table-row'
    }
  },
  be: {
    name: 'Belgian 15 min. max',
    country: 'be',
    currency: 'EUR',
    granularity: 15,
    vat: 6, // 25 after March 31, 2023
    peakStart: '07:00', // Varies across Belgium
    peakEnd: '22:00', // Varies across Belgium
    WeekendOffPeak: true,
    gridSteps: false,
    peakMin: 2500,
    peakTax: 57.0831,
    limits: {
      quarter: true,
      hour: false,
      day: false,
      month: false
    },
    hide: {
      costSchemaBox: 'table-row'
    }
  },
  custom: {
    name: 'Custom',
    country: 'de',
    currency: 'EUR',
    granularity: 60,
    vat: 25,
    peakStart: '06:00',
    peakEnd: '22:00',
    WeekendOffPeak: false,
    gridSteps: true,
    peakMin: 0,
    peakTax: 0,
    limits: {
      quarter: false,
      hour: true,
      day: false,
      month: false
    },
    hide: {
    }
  }
}

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
  uk: 'United Kingdom'
}

// =============================================================================
// = APP FUNCTIONS
// =============================================================================

async function initCostSchema(homey) {
  const schema = homey.settings.get('costSchema');
  if (schema === null) {
    const locale = homey.i18n.getLanguage();
    const newSchema = (locale === 'be') ? 'be' : 'no';
    homey.settings.set('costSchema', newSchema);
    homey.settings.set('limits', SCHEMA[newSchema].limits);
    // TBD: futurePrices. VAT?
  }
}

// =============================================================================
// = SETUP PAGE
// =============================================================================

var currentSchema = 'no';

async function changeSchema(newSchema) {
  if (!(newSchema in SCHEMA)) newSchema = 'custom';
  if (newSchema !== currentSchema) {
    // Display old hidden elements
    const keys = Object.keys(SCHEMA[currentSchema].hide);
    for (let i = 0; i < keys.length; i++) {
      document.getElementById(keys[i]).style.display = SCHEMA[currentSchema].hide[keys[i]];
    }
    currentSchema = newSchema;
    document.getElementById('costSchema').value = newSchema;
    document.getElementById('currency').value = SCHEMA[newSchema].currency;
    document.getElementById('VAT').value = SCHEMA[newSchema].vat;
    document.getElementById('peakStart').value = SCHEMA[newSchema].peakStart;
    document.getElementById('peakEnd').value = SCHEMA[newSchema].peakEnd;
    document.getElementById('WeekendOffPeak').checked = SCHEMA[newSchema].WeekendOffPeak;
    document.getElementById('gridSteps').checked = SCHEMA[newSchema].gridSteps;
    document.getElementById('peakMin').value = SCHEMA[newSchema].peakMin;
    document.getElementById('peakTax').value = SCHEMA[newSchema].peakTax;
    document.getElementById('enLimit15').checked = SCHEMA[newSchema].limits.quarter;
    document.getElementById('enLimit60').checked = SCHEMA[newSchema].limits.hour;
    document.getElementById('enLimitDay').checked = SCHEMA[newSchema].limits.day;
    document.getElementById('enLimitMonth').checked = SCHEMA[newSchema].limits.month;
    await refreshSchema();
  }
}

async function refreshSchema() {
  if (document.getElementById('gridSteps').checked) {
    document.getElementById('gridStepBlock').style.display = 'block';
    document.getElementById('gridLinearBlock').style.display = 'none';
  } else {
    document.getElementById('gridStepBlock').style.display = 'none';
    document.getElementById('gridLinearBlock').style.display = 'block';
  }
  const keys = Object.keys(SCHEMA[currentSchema].hide);
  for (let i = 0; i < keys.length; i++) {
    document.getElementById(keys[i]).style.display = 'none';
  }
  document.getElementById('maxPower15min').disabled = !document.getElementById('enLimit15').checked;
  document.getElementById('maxPower').disabled = !document.getElementById('enLimit60').checked;
  document.getElementById('maxPowerDay').disabled = !document.getElementById('enLimitDay').checked;
  document.getElementById('maxPowerMonth').disabled = !document.getElementById('enLimitMonth').checked;
}

module.exports = {
  SCHEMA,
  COUNTRY,
  initCostSchema,
  changeSchema,
};
