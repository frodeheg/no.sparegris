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
  let table = document.getElementById('gridCostsTable');
  for (let i = 0; i < gridCost.length; i++) {
    let { limit, price } = gridCost[i];
    if (table.rows.length <= (i + 1)) {
      addMaxPowerElement();
    }
  }
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

// When including this file in a web-page, inform the main page that loading is complete
if (typeof onScriptLoaded === 'function') {
  onScriptLoaded('gridcost.js');
} // else the script is not used in a web-page
