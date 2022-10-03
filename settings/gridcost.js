/* eslint-disable no-nested-ternary */

'use strict';

// Table of current grid cost
let gridCost = [
  { limit: 2000, price: 73 },
  { limit: 5000, price: 128 },
  { limit: 10000, price: 219 },
  { limit: 15000, price: 323 },
  { limit: 20000, price: 426 },
  { limit: 25000, price: 530 },
];

function setGridCost(costTable) {
  gridCost = costTable;
}

function getGridAbove(usage) {
  const item = gridCost.reduce((a, b) => (+a.limit > +usage ? a : +b.limit > +usage ? b : { limit: NaN, price: NaN }));
  return item.limit;
}

function getGridBelow(usage) {
  const item = gridCost.reduce((a, b) => (+b.limit < +usage ? b : +a.limit < +usage ? a : { limit: NaN, price: NaN }));
  return item.limit;
}

module.exports = {
  setGridCost,
  getGridAbove,
  getGridBelow,
};
