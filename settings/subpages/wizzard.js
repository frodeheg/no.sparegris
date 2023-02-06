'use strict';

// Constants
const UI_FOCUS = 1;
const UI_DELAY = 2;
const UI_CHECK = 3;
const UI_FLASH = 4;
const UI_HOVER = 5;
const UI_PAGE = 6;
const UI_DONEHOVER = 7;
const UI_UNCHECK = 8;

const delay = t => new Promise(resolve => setTimeout(resolve, t));

const wizGotoLimiters = [
  { action: UI_HOVER, id: 'advancedMenu' },
  { action: UI_DELAY, delay: 250 },
  { action: UI_HOVER, id: 'advancedMenuDrop' },
  { action: UI_DELAY, delay: 250 },
  { action: UI_HOVER, id: 'priceLink' },
  { action: UI_DELAY, delay: 500 },
  { action: UI_PAGE, id: 'costPage' },
  { action: UI_UNCHECK, id: 'collapsible2' },
  { action: UI_UNCHECK, id: 'collapsible3' },
  { action: UI_UNCHECK, id: 'collapsible4' },
  { action: UI_DELAY, delay: 500 },
  { action: UI_DONEHOVER, id: 'advancedMenu' },
  { action: UI_DONEHOVER, id: 'advancedMenuDrop' },
  { action: UI_DONEHOVER, id: 'priceLink' },
  { action: UI_DELAY, delay: 250 },
  { action: UI_CHECK, id: 'collapsible4' },
  { action: UI_DELAY, delay: 250 },
  { action: UI_FOCUS, id: 'maxPowerTable' },
  { action: UI_FLASH, id: 'maxPowerTable' },
];

/**
 * Runs a serious of UI actions in sequence
 */
async function runActionQueue(actionQueue) {
  for (let i = 0; i < actionQueue.length; i++) {
    switch (+actionQueue[i].action) {
      case UI_FOCUS:
        document.getElementById(actionQueue[i].id).focus();
        break;
      case UI_DELAY:
        await delay(actionQueue[i].delay);
        break;
      case UI_CHECK:
        document.getElementById(actionQueue[i].id).checked = true;
        break;
      case UI_UNCHECK:
        document.getElementById(actionQueue[i].id).checked = false;
        break;
      case UI_FLASH:
        flashElement(actionQueue[i].id);
        break;
      case UI_HOVER:
        document.getElementById(actionQueue[i].id).classList.add(`${actionQueue[i].id}Wizhover`);
        break;
      case UI_DONEHOVER:
        document.getElementById(actionQueue[i].id).classList.remove(`${actionQueue[i].id}Wizhover`);
        break;
      case UI_PAGE:
        changeTab(false, actionQueue[i].id);
        break;
      default:
        break;
    }
  }
}

module.exports = {
  wizGotoLimiters,
  runActionQueue,
};
