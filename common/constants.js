'use strict';

// Granularity for archive
const GRANULARITY = {
  YEAR: 0,
  MONTH: 1,
  DAY: 2,
  HOUR: 3,
};

// Overrides
const OVERRIDE = {
  NONE: 0,
  ON: 1,
  OFF: 2,
  OFF_UNTIL_MANUAL_ON: 3,
  MANUAL_TEMP: 4,
  FROST_GUARD: 5,
  CONTROLLED: 6,
};

// Modes
const MODE_DISABLED = 0;
const MODE_NORMAL = 1;
const MODE_NIGHT = 2;
const MODE_AWAY = 3;
const MODE_CUSTOM = 4;

// Operations for controlled devices
const MAIN_OP = {
  ALWAYS_OFF: 0,
  ALWAYS_ON: 1,
  CONTROLLED: 2,
};

const TARGET_OP = {
  TURN_ON: 0,
  TURN_OFF: 1,
  DELTA_TEMP: 2,
  EMERGENCY_OFF: 3,
  IGNORE: 4,
};

// New device operations
// eslint-disable-next-line no-var
var DEVICE_OP = {
  UNCONDITIONAL_OFF: 0,
  UNCONDITIONAL_ON: 1,
  CONTROLLED_OFF: 2,
  CONTROLLED_ON: 3,
  IGNORE: 4,
};

// Temperature operations
// eslint-disable-next-line no-var
var TEMP_OP = {
  NONE: 0,
  STATIC: 1,
  PRICE: 2,
};

// App enable
const APP_NOT_READY = 0;
const APP_READY = 1;
const APP_MISSING_PRICE_API = 2;
const APP_MISSING_PRICE_DEVICE = 3;
const APP_MISSING_PRICE_DATA = 4;

// Price API state
const PRICE_API_NO_APP = 0;
const PRICE_API_NO_DEVICE = 1;
const PRICE_API_OK = 2;
const PRICE_API_NO_DATA = 3;

// Price modes
const PRICE_MODE_FLOW = 0;
const PRICE_MODE_INTERNAL = 1;
const PRICE_MODE_DISABLED = 2;

// Price Kinds
const PRICE_KIND_EXTERNAL = 0;
const PRICE_KIND_SPOT = 1;
const PRICE_KIND_FIXED = 2;

// Price points
const PP = {
  LOW: 0,
  NORM: 1,
  HIGH: 2,
  EXTREME: 3,
  DIRTCHEAP: 4,
};

// Max power indices
const MAXPOWER = {
  QUARTER: 0,
  HOUR: 1,
  DAY: 2,
  MONTH: 3,
};

// Logging classes
const LOG_ERROR = 0;
const LOG_INFO = 1;
const LOG_DEBUG = 2;
const LOG_ALL = LOG_ERROR;

// Charging targets
const CHARGE_TARGET_AUTO = 1;
const CHARGE_TARGET_FLOW = 2;

// Charging offers
const OFFER_ENERGY = 1;
const OFFER_HOURS = 2;

// Bidding zones for electricity prices
const ENTSOE_BIDDING_ZONES = {
  al: [{ id: '10YAL-KESH-----5', name: 'AL' }],
  at: [{ id: '10YAT-APG------L', name: 'AT' }, { id: '10Y1001A1001A63L', name: 'DE-AT-LU' }],
  be: [{ id: '10YBE----------2', name: 'BE' }],
  ba: [{ id: '10YBA-JPCC-----D', name: 'BA' }],
  bg: [{ id: '10YCA-BULGARIA-R', name: 'BG' }],
  hr: [{ id: '10YHR-HEP------M', name: 'HR' }],
  cy: [{ id: '10YCY-1001A0003J', name: 'CY' }],
  cz: [{ id: '10YCZ-CEPS-----N', name: 'CZ' }, { id: '10YDOM-CZ-DE-SKK', name: 'CZ+DE+SK' }],
  dk: [{ id: '10YDK-1--------W', name: 'DK1' }, { id: '10YDK-2--------M', name: 'DK2' }],
  ee: [{ id: '10Y1001A1001A39I', name: 'EE' }],
  fi: [{ id: '10YFI-1--------U', name: 'FI' }],
  fr: [{ id: '10YFR-RTE------C', name: 'FR' }],
  ge: [{ id: '10Y1001A1001B012', name: 'GE' }],
  de: [{ id: '10YDOM-CZ-DE-SKK', name: 'CZ+DE+SK' }, { id: '10Y1001A1001A63L', name: 'DE-AT-LU' }, { id: '10Y1001A1001A82H', name: 'DE-LU' }],
  gr: [{ id: '10YGR-HTSO-----Y', name: 'GR' }],
  hu: [{ id: '10YHU-MAVIR----U', name: 'HU' }],
  ie: [{ id: '10Y1001A1001A59C', name: 'IE(SEM)' }],
  it: [{ id: '10Y1001A1001A699', name: 'IT-Brindisi' }, { id: '10Y1001C--00096J', name: 'IT-Calabria' }, { id: '10Y1001A1001A70O', name: 'IT-Centre-North' },
    { id: '10Y1001A1001A71M', name: 'IT-Centre-South' }, { id: '10Y1001A1001A72K', name: 'IT-Foggia' }, { id: '10Y1001A1001A66F', name: 'IT-GR' },
    { id: '10Y1001A1001A877', name: 'IT-Malta' }, { id: '10Y1001A1001A73I', name: 'IT-North' }, { id: '10Y1001A1001A80L', name: 'IT-North-AT' },
    { id: '10Y1001A1001A68B', name: 'IT-North-CH' }, { id: '10Y1001A1001A81J', name: 'IT-North-FR' }, { id: '10Y1001A1001A67D', name: 'IT-North-SI' },
    { id: '10Y1001A1001A76C', name: 'IT-Priolo' }, { id: '10Y1001A1001A77A', name: 'IT-Rossano' }, { id: '10Y1001A1001A885', name: 'IT-SACOAC' },
    { id: '10Y1001A1001A893', name: 'IT-SACODC' }, { id: '10Y1001A1001A74G', name: 'IT-Sardinia' }, { id: '10Y1001A1001A75E', name: 'IT-Sicily' },
    { id: '10Y1001A1001A788', name: 'IT-South' }],
  xk: [{ id: '10Y1001C--00100H', name: 'XK' }],
  lv: [{ id: '10YLV-1001A00074', name: 'LV' }],
  lt: [{ id: '10YLT-1001A0008Q', name: 'LT' }],
  lu: [{ id: '10Y1001A1001A63L', name: 'DE-AT-LU' }, { id: '10Y1001A1001A82H', name: 'DE-LU' }],
  mt: [{ id: '10Y1001A1001A93C', name: 'MT' }],
  md: [{ id: '10Y1001A1001A990', name: 'MD' }],
  me: [{ id: '10YCS-CG-TSO---S', name: 'ME' }],
  nl: [{ id: '10YNL----------L', name: 'NL' }],
  mk: [{ id: '10YMK-MEPSO----8', name: 'MK' }],
  no: [{ id: '10YNO-1--------2', name: 'Øst (NO1)' }, { id: '10YNO-2--------T', name: 'Sør (NO2)' }, // { id: '50Y0JVU59B4JWQCU', name: 'NO2NSL' },
    { id: '10YNO-3--------J', name: 'Midt (NO3)' }, { id: '10YNO-4--------9', name: 'Nord (NO4)' }, { id: '10Y1001A1001A48H', name: 'Vest (NO5)' }],
  pl: [{ id: '10YPL-AREA-----S', name: 'PL' }],
  pt: [{ id: '10YPT-REN------W', name: 'PT' }],
  ro: [{ id: '10YRO-TEL------P', name: 'RO' }],
  rs: [{ id: '10YCS-SERBIATSOV', name: 'RS' }],
  sk: [{ id: '10YDOM-CZ-DE-SKK', name: 'CZ+DE+SK' }, { id: '10YSK-SEPS-----K', name: 'SK' }],
  si: [{ id: '10YSI-ELES-----O', name: 'SI' }],
  es: [{ id: '10YES-REE------0', name: 'ES' }],
  se: [{ id: '10Y1001A1001A44P', name: 'SE1' }, { id: '10Y1001A1001A45N', name: 'SE2' }, { id: '10Y1001A1001A46L', name: 'SE3' }, { id: '10Y1001A1001A47J', name: 'SE4' }],
  ch: [{ id: '10YCH-SWISSGRIDZ', name: 'CH' }],
  tr: [{ id: '10YTR-TEIAS----W', name: 'TR' }],
  ua: [{ id: '10Y1001C--00003F', name: 'UA' }, { id: '10YUA-WEPS-----0', name: 'UA-BEI' }, { id: '10Y1001A1001A869', name: 'UA-DobTPP' }, { id: '10Y1001C--000182', name: 'UA-IPS' }],
  uk: [{ id: '10YGB----------A', name: 'GB' }, { id: '11Y0-0000-0265-K', name: 'GB(ElecLink)' }, { id: '10Y1001C--00098F', name: 'GB(IFA)' },
    { id: '17Y0000009369493', name: 'GB(IFA2)' }, { id: '10Y1001A1001A59C', name: 'IE(SEM)' }],
};

module.exports = {
  GRANULARITY,
  OVERRIDE,
  MODE_DISABLED,
  MODE_NORMAL,
  MODE_NIGHT,
  MODE_AWAY,
  MODE_CUSTOM,
  MAIN_OP,
  TARGET_OP,
  DEVICE_OP,
  TEMP_OP,
  PP,
  MAXPOWER,
  APP_NOT_READY,
  APP_READY,
  APP_MISSING_PRICE_API,
  APP_MISSING_PRICE_DEVICE,
  APP_MISSING_PRICE_DATA,
  PRICE_API_NO_APP,
  PRICE_API_NO_DEVICE,
  PRICE_API_OK,
  PRICE_API_NO_DATA,
  PRICE_MODE_DISABLED,
  PRICE_MODE_FLOW,
  PRICE_MODE_INTERNAL,
  PRICE_KIND_EXTERNAL,
  PRICE_KIND_SPOT,
  PRICE_KIND_FIXED,
  LOG_ERROR,
  LOG_INFO,
  LOG_DEBUG,
  LOG_ALL,
  CHARGE_TARGET_AUTO,
  CHARGE_TARGET_FLOW,
  OFFER_ENERGY,
  OFFER_HOURS,
  ENTSOE_BIDDING_ZONES,
};
