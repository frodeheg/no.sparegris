/* eslint-disable comma-dangle */

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
const UI_FORCE_CLICK = 9; // Highlights an element and wait for it to be clicked.
const UI_FORCE_NEXT = 10;
const UI_FORCE_EXIT = 11;
const UI_SHOW_OVERLAY = 12;
const UI_HIDE_OVERLAY = 13;
const UI_FORCE_VALUE = 14;

let wizActive = false;
let wizWaiting = false;
let wizFocusAction;
let wizChangeAction;
let wizShadow;
const wizOverrides = [];
let wizContainer;

const delay = (t) => new Promise((resolve) => setTimeout(resolve, t));

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
 * Flashes an element
 */
function flashElement(element) {
  const { classList } = document.getElementById(element);
  classList.add('flash');
  setTimeout(() => classList.remove('flash'), 2000);
}

/**
 * Onclick/etc. action to attach to wizzard focus elements
 */
async function wizAction(event) {
  if (wizFocusAction) {
    wizFocusAction(event);
  }
  wizWaiting = false;
}

/**
 * Force selection of an element
 */
async function uiForceAction(action) {
  const wizNext = document.getElementById('wizNext');
  const wizDisableBox = document.getElementById('wizDisableBox');
  const focusElem = action.id ? document.getElementById(action.id) : undefined;
  const rect = focusElem ? focusElem.getBoundingClientRect() : undefined;
  const outerH = 10;
  const oldFocus = {};
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;

  if (focusElem) {
    // Capture action state
    wizFocusAction = focusElem.onclick;
    wizChangeAction = focusElem.onchange;

    // Transfer pointer events to the background to improve dragging
    wizDisableBox.onpointermove = focusElem.onpointermove;
    wizDisableBox.touchAction = 'none';

    // Highlight specific item
    wizShadow = focusElem.style.boxShadow;
    focusElem.style.boxShadow = '0 0 10px 7px #DA0';

    // Bring element to select forward:
    oldFocus.zIndex = focusElem.style.zIndex;
    focusElem.style.zIndex = 30;
  }

  // Show hint and position relative to the highlighted item
  const wizHint = document.getElementById('wizHint');
  const wizText = document.getElementById('wizText');
  wizText.innerHTML = action.hint;
  if (focusElem) {
    if (rect.top > (window.innerHeight / 2)) {
      wizHint.style.top = '';
      wizHint.style.bottom = `${Math.floor(Math.max((focusElem ? (window.innerHeight - rect.bottom + Math.min(rect.height, 100)) : 0) + outerH + 10 - scrollTop, 0))}px`;
      console.log(`${wizHint.style.bottom}`)
    } else {
      wizHint.style.top = `${Math.floor((focusElem ? (rect.top + Math.min(rect.height, 100)) : 0) + outerH + 10 + scrollTop)}px`;
      wizHint.style.bottom = '';
    }
  } else {
    wizHint.style.top = `${outerH + 10 + scrollTop}px`;
    wizHint.style.bottom = '';
  }
  wizHint.style.width = `${300}px`;
  wizHint.style.left = '10px';
  wizHint.style.display = 'block';
  const hintRect = wizHint.getBoundingClientRect();
  if (hintRect.top < 0) {
    wizHint.style.top = '0px';
  }
  dragElement(document.getElementById("wizHint"));

  // Make sure that required values disables the next button:
  if (action.require !== undefined) {
    const convert = (a) => {
      if (typeof a === 'object') return JSON.stringify(a);
      if (typeof a === 'number') return `${a}`;
      return a;
    };
    const compare = (a, b) => convert(a) === convert(b);
    const filter = (a, b) => {
      if (!Array.isArray(a)) return a;
      return a.filter((v, i) => b[i] !== undefined);
    };
    const filteredCompare = (a, b) => compare(filter(a, b), filter(b, b));
    const updateNextButton = () => {
      const isOk = filteredCompare(focusElem.value, action.require);
      if (isOk) wizNext.classList.remove('wizDisabled');
      else wizNext.classList.add('wizDisabled');
    };
    updateNextButton();
    wizNext.onclick = () => {if (filteredCompare(focusElem.value, action.require)) wizNextClick()};
    focusElem.onchange = (event) => {
      if (wizChangeAction) {
        wizChangeAction.call(focusElem, event);
      }
      updateNextButton();
    };
  } else {
    wizNext.classList.remove('wizDisabled');
  }

  // Assign action to move forward:
  switch (action.action) {
    case UI_FORCE_NEXT:
    case UI_FORCE_EXIT:
    default:
      break;
    case UI_FORCE_CLICK:
      focusElem.onclick = (event) => wizAction(event, action);
      break;
  }

  wizWaiting = true;
  while (wizActive && wizWaiting) {
    await delay(200);
    if (action.var && (window[action.var] === action.value)) {
      wizWaiting = false;
    }
  }

  // Clean up
  wizHint.style.display = 'none';
  if (focusElem) {
    wizDisableBox.onpointermove = undefined;
    wizDisableBox.touchAction = undefined;
    focusElem.onclick = wizFocusAction;
    focusElem.onchange = wizChangeAction;
    focusElem.style.zIndex = oldFocus.zIndex;
    focusElem.style.boxShadow = wizShadow;
  }
  document.getElementById('wizNext').onclick = () => wizNextClick();
  wizFocusAction = undefined;
}

/**
 * Runs a serious of UI actions in sequence
 */
async function runActionQueue(actionQueue) {
  wizActive = true;
  for (let i = 0; i < actionQueue.length; i++) {
    if (wizOverrides[+actionQueue[i].action]) {
      wizOverrides[+actionQueue[i].action]();
    }
    switch (+actionQueue[i].action) {
      case UI_SHOW_OVERLAY:
        document.getElementById('wizDisableBox').style.display = 'block';
        break;
      case UI_HIDE_OVERLAY:
        document.getElementById('wizDisableBox').style.display = 'none';
        break;
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
      case UI_FORCE_NEXT:
        document.getElementById('wizNext').style.display = 'block';
        await uiForceAction(actionQueue[i]);
        break;
      case UI_FORCE_CLICK:
      default:
        await uiForceAction(actionQueue[i]);
        break;
    }
    if (!wizActive) {
      if (wizOverrides[UI_HIDE_OVERLAY]) wizOverrides[UI_HIDE_OVERLAY]();
      document.getElementById('wizDisableBox').style.display = 'none';
      return;
    }
  }
}

function sendWizMessage(message) {
  if (parent && parent.iFrameCallback) {
    // iFrame shares contect with parent, messages doesn't always work, call parent directly
    console.log(`iframe shares context - Informing message: ${message}`);
    parent.iFrameCallback({ message, origin: window.location.origin });
  } else if (wizContainer) {
    // Iframe does not share context, must use messages to share data
    console.log(`iFrame connected - Posting Message ${message}`);
    wizContainer.postMessage(message, '*');
  } else {
    console.log('ERROR: iFrame has not been connected properly.');
  }
}

function sendWizOverlayShow() {
  if (!wizContainer) return;
  const data = {
    id: 'wizAction',
    actionQueue: [{ action: UI_SHOW_OVERLAY }]
  };
  sendWizMessage(JSON.stringify(data));
}

function sendWizOverlayHide() {
  if (!wizContainer) return;
  const data = {
    id: 'wizAction',
    actionQueue: [{ action: UI_HIDE_OVERLAY }]
  };
  sendWizMessage(JSON.stringify(data));
}

function setWizOverrides() {
  wizOverrides[UI_SHOW_OVERLAY] = sendWizOverlayShow;
  wizOverrides[UI_HIDE_OVERLAY] = sendWizOverlayHide;
}

function initializeWizzard() {
  document.write(`
<style>
#wizDisableBox {
  display: none;
  top:0px;
  left:0px;
  position: fixed;
  width: 100%;
  height: 100%;
  padding: 0px;
  margin: 0px;
  z-index: 10;
  background-color: #0008;
  border: 0px solid #ddd;
  -webkit-user-select: none; /* Safari */
  -ms-user-select: none; /* IE 10 and IE 11 */
  user-select: none; /* Standard syntax */
}

.wizWand {
  height: 40px;
  width: 40px;
}

.wizWand:hover {
  height: 50px;
  width: 50px;
}

.wizWand:active {
  background-color: #AAA;
}

.wizButton {
  position: relative;
  right: 0px;
  bottom: 0px;

  color: black;
  border: 1px solid gray;
  border-radius: 5px;
  margin: 10px;
  padding: 5px;
  background-color: #EEE;
  -webkit-user-select: none; /* Safari */
  -ms-user-select: none; /* IE 10 and IE 11 */
  user-select: none; /* Standard syntax */
}

.wizButton:active {
  background-color: #AAA;
}

.wizDisabled {
  pointer-events: none;
  opacity: 0.4;
}

.wizPopup {
  display: none;
  position: absolute;
  z-index: 40;
  background-color: #fffC;
  text-align: center;
  border: 1px solid #d3d3d3;
  box-shadow: 10px 10px 10px #000A;
  border-radius: 7px;
  touch-action: none;
}

.wizPopupHeader {
  padding: 10px;
  cursor: move;
  z-index: 10;
  background-color: #2AFD;
  color: #fff;
  border-radius: 7px 7px 0 0;
  -webkit-user-select: none; /* Safari */
  -ms-user-select: none; /* IE 10 and IE 11 */
  user-select: none; /* Standard syntax */
}

.wizPopupText {
  color: #000;
}


</style>

<div id="wizDisableBox">
</div>

<div id="wizHint" class="wizPopup">
  <div id="wizHintHeader" class="wizPopupHeader">Wizzard</div>
  <p id="wizText" class="wizPopupText">
    Language asd asd a f
  </p>
  <div id="wizNext" class="wizButton" onClick="wizNextClick();" style="display: none;">Next</div>
  <div id="wizExit" class="wizButton" onClick="wizExitClick()">Exit Wizzard</div>
</div>

`);
}

/**
 * onClick action for wizzard next button
 */
function wizNextClick() {
  wizAction();
  document.getElementById('wizNext').style.display = 'none';
}

/**
 * onClick action for wizzard exit button
 */
function wizExitClick() {
  wizActive = false;
  console.log('Exit wizzard');
}

function dragElement(elmnt) {
  var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  if (document.getElementById(`${elmnt.id}Header`)) {
    // if present, the header is where you move the DIV from:
    document.getElementById(`${elmnt.id}Header`).onpointerdown = (e) => dragPointerDown(e);
  } else {
    // otherwise, move the DIV from anywhere inside the DIV:
    elmnt.onpointerdown = (e) => dragPointerDown(e);
  }

  function dragPointerDown(e) {
    e = e || window.event;
    e.preventDefault();
    // get the pointer position at startup:
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onpointerup = (e) => closeDragElement(e);
    //document.onpointerleave = () => closeDragElement(); // Doesn't function very well on the phone
    // call a function whenever the cursor moves:
    document.onpointermove = (e) => elementDrag(e);
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    // calculate the new cursor position:
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    // set the element's new position:
    elmnt.style.top = `${Math.min(Math.max(elmnt.offsetTop - pos2, -20), window.innerHeight - 20)}px`;
    elmnt.style.bottom = '';
    const wizWidth = parseInt(document.getElementById('wizHint').style.width);
    elmnt.style.left = `${Math.min(Math.max(elmnt.offsetLeft - pos1, 20 - wizWidth), window.innerWidth - 20)}px`;
  }

  function closeDragElement(e) {
    // stop moving when pointer is released:
    document.onpointerup = null;
    document.onpointermove = null;
    document.onpointerleave = null;
  }
}

initializeWizzard();
onWizLoaded(); // From including document

module.exports = {
  wizGotoLimiters,
  runActionQueue,
  sendWizMessage,
  setWizOverrides,
};
