'use strict';

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

module.exports = {
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
};