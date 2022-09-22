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
  { limit: 50000, price: 911 },
  { limit: 75000, price: 1430 },
  { limit: 100000, price: 1950 },
  { limit: 150000, price: 2816 },
  { limit: 200000, price: 3855 },
  { limit: 300000, price: 5586 },
  { limit: 400000, price: 7665 },
  { limit: 500000, price: 9743 },
  { limit: Infinity, price: 11821 },
];

function setGridCost(costTable) {
  gridCost = costTable;
}

function getGridAbove(usage) {
  const item = gridCost.reduce((a, b) => (a.limit > usage ? a : b.limit > usage ? b : NaN));
  return item.limit;
}

function getGridBelow(usage) {
  const item = gridCost.reduce((a, b) => (b.limit < usage ? b : a.limit < usage ? a : NaN));
  return item.limit;
}

module.exports = {
  setGridCost,
  getGridAbove,
  getGridBelow,
};
