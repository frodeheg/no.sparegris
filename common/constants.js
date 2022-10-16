'use strict';

// Modes
const MODE_DISABLED = 0;
const MODE_NORMAL = 1;
const MODE_NIGHT = 2;
const MODE_AWAY = 3;
const MODE_CUSTOM = 4;

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
const PP_LOW = 0;
const PP_NORM = 1;
const PP_HIGH = 2;
const PP_EXTREME = 3;
const PP_DIRTCHEAP = 4;

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
  'Albania (AL)': [{ id: '10YAL-KESH-----5', name: 'AL' }],
  'Austria (AT)': [{ id: '10YAT-APG------L', name: 'AT' }, { id: '10Y1001A1001A63L', name: 'DE-AT-LU' }],
  'Belgium (BE)': [{ id: '10YBE----------2', name: 'BE' }],
  'Bosnia and Herz. (BA)': [{ id: '10YBA-JPCC-----D', name: 'BA' }],
  'Bulgaria (BG)': [{ id: '10YCA-BULGARIA-R', name: 'BG' }],
  'Croatia (HR)': [{ id: '10YHR-HEP------M', name: 'HR' }],
  'Cyprus (CY)': [{ id: '10YCY-1001A0003J', name: 'CY' }],
  'Czech Republic (CZ)': [{ id: '10YCZ-CEPS-----N', name: 'CZ' }, { id: '10YDOM-CZ-DE-SKK', name: 'CZ+DE+SK' }],
  'Denmark (DK)': [{ id: '10YDK-1--------W', name: 'DK1' }, { id: '10YDK-2--------M', name: 'DK2' }],
  'Estonia (EE)': [{ id: '10Y1001A1001A39I', name: 'EE' }],
  'Finland (FI)': [{ id: '10YFI-1--------U', name: 'FI' }],
  'France (FR)': [{ id: '10YFR-RTE------C', name: 'FR' }],
  'Georgia (GE)': [{ id: '10Y1001A1001B012', name: 'GE' }],
  'Germany (DE)': [{ id: '10YDOM-CZ-DE-SKK', name: 'CZ+DE+SK' }, { id: '10Y1001A1001A63L', name: 'DE-AT-LU' }, { id: '10Y1001A1001A82H', name: 'DE-LU' }],
  'Greece (GR)': [{ id: '10YGR-HTSO-----Y', name: 'GR' }],
  'Hungary (HU)': [{ id: '10YHU-MAVIR----U', name: 'HU' }],
  'Ireland (IE)': [{ id: '10Y1001A1001A59C', name: 'IE(SEM)' }],
  'Italy (IT)': [{ id: '10Y1001A1001A699', name: 'IT-Brindisi' }, { id: '10Y1001C--00096J', name: 'IT-Calabria' }, { id: '10Y1001A1001A70O', name: 'IT-Centre-North' },
    { id: '10Y1001A1001A71M', name: 'IT-Centre-South' }, { id: '10Y1001A1001A72K', name: 'IT-Foggia' }, { id: '10Y1001A1001A66F', name: 'IT-GR' },
    { id: '10Y1001A1001A877', name: 'IT-Malta' }, { id: '10Y1001A1001A73I', name: 'IT-North' }, { id: '10Y1001A1001A80L', name: 'IT-North-AT' },
    { id: '10Y1001A1001A68B', name: 'IT-North-CH' }, { id: '10Y1001A1001A81J', name: 'IT-North-FR' }, { id: '10Y1001A1001A67D', name: 'IT-North-SI' },
    { id: '10Y1001A1001A76C', name: 'IT-Priolo' }, { id: '10Y1001A1001A77A', name: 'IT-Rossano' }, { id: '10Y1001A1001A885', name: 'IT-SACOAC' },
    { id: '10Y1001A1001A893', name: 'IT-SACODC' }, { id: '10Y1001A1001A74G', name: 'IT-Sardinia' }, { id: '10Y1001A1001A75E', name: 'IT-Sicily' },
    { id: '10Y1001A1001A788', name: 'IT-South' }],
  'Kosovo (XK)': [{ id: '10Y1001C--00100H', name: 'XK' }],
  'Latvia (LV)': [{ id: '10YLV-1001A00074', name: 'LV' }],
  'Lithuania (LT)': [{ id: '10YLT-1001A0008Q', name: 'LT' }],
  'Luxembourg (LU)': [{ id: '10Y1001A1001A63L', name: 'DE-AT-LU' }, { id: '10Y1001A1001A82H', name: 'DE-LU' }],
  'Malta (MT)': [{ id: '10Y1001A1001A93C', name: 'MT' }],
  'Moldova (MD)': [{ id: '10Y1001A1001A990', name: 'MD' }],
  'Montenegro (ME)': [{ id: '10YCS-CG-TSO---S', name: 'ME' }],
  'Netherlands (NL)': [{ id: '10YNL----------L', name: 'NL' }],
  'North Macedonia (MK)': [{ id: '10YMK-MEPSO----8', name: 'MK' }],
  'Norway (NO)': [{ id: '10YNO-1--------2', name: 'Øst (NO1)' }, { id: '10YNO-2--------T', name: 'Sør (NO2)' }, // { id: '50Y0JVU59B4JWQCU', name: 'NO2NSL' },
    { id: '10YNO-3--------J', name: 'Midt (NO3)' }, { id: '10YNO-4--------9', name: 'Nord (NO4)' }, { id: '10Y1001A1001A48H', name: 'Vest (NO5)' }],
  'Poland (PL)': [{ id: '10YPL-AREA-----S', name: 'PL' }],
  'Portugal (PT)': [{ id: '10YPT-REN------W', name: 'PT' }],
  'Romania (RO)': [{ id: '10YRO-TEL------P', name: 'RO' }],
  'Serbia (RS)': [{ id: '10YCS-SERBIATSOV', name: 'RS' }],
  'Slovakia (SK)': [{ id: '10YDOM-CZ-DE-SKK', name: 'CZ+DE+SK' }, { id: '10YSK-SEPS-----K', name: 'SK' }],
  'Slovenia (SI)': [{ id: '10YSI-ELES-----O', name: 'SI' }],
  'Spain (ES)': [{ id: '10YES-REE------0', name: 'ES' }],
  'Sweden (SE)': [{ id: '10Y1001A1001A44P', name: 'SE1' }, { id: '10Y1001A1001A45N', name: 'SE2' }, { id: '10Y1001A1001A46L', name: 'SE3' }, { id: '10Y1001A1001A47J', name: 'SE4' }],
  'Switzerland (CH)': [{ id: '10YCH-SWISSGRIDZ', name: 'CH' }],
  'Turkey (TR)': [{ id: '10YTR-TEIAS----W', name: 'TR' }],
  'Ukraine (UA)': [{ id: '10Y1001C--00003F', name: 'UA' }, { id: '10YUA-WEPS-----0', name: 'UA-BEI' }, { id: '10Y1001A1001A869', name: 'UA-DobTPP' }, { id: '10Y1001C--000182', name: 'UA-IPS' }],
  'United Kingdom (UK)': [{ id: '10YGB----------A', name: 'GB' }, { id: '11Y0-0000-0265-K', name: 'GB(ElecLink)' }, { id: '10Y1001C--00098F', name: 'GB(IFA)' },
    { id: '17Y0000009369493', name: 'GB(IFA2)' }, { id: '10Y1001A1001A59C', name: 'IE(SEM)' }],
};

module.exports = {
  MODE_DISABLED,
  MODE_NORMAL,
  MODE_NIGHT,
  MODE_AWAY,
  MODE_CUSTOM,
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
  PP_LOW,
  PP_NORM,
  PP_HIGH,
  PP_EXTREME,
  PP_DIRTCHEAP,
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
