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

let wizActive = false;
let wizWaiting = false;
let wizFocusAction;
let wizChangeAction;

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
  const focusElem = action.id ? document.getElementById(action.id) : undefined;
  const wizCircle = document.getElementById('wizCircle');
  const rect = focusElem ? focusElem.getBoundingClientRect() : undefined;
  const circleBorder = 6;
  const outerW = 10;
  const outerH = 10;
  const oldFocus = {};
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;

  // Highlight specific item
  if (focusElem) {
    wizCircle.style.display = 'block';
    wizCircle.style.top = `${Math.floor(rect.top) - outerH - circleBorder + scrollTop}px`;
    wizCircle.style.left = `${Math.floor(rect.left) - outerW - circleBorder}px`;
    wizCircle.style.width = `${Math.floor(rect.width) + outerW * 2}px`;
    wizCircle.style.height = `${Math.floor(rect.height) + outerH * 2}px`;
  }

  // Disable all other elements:
  const wizDisableBox = document.getElementById('wizDisableBox');
  wizDisableBox.style.display = 'block';

  // Bring element to select forward:
  if (focusElem) {
    oldFocus.zIndex = focusElem.style.zIndex;
    focusElem.style.zIndex = 30;
  }

  // Show hint and position relative to the highlighted item
  const wizHint = document.getElementById('wizHint');
  const wizText = document.getElementById('wizText');
  wizText.innerHTML = action.hint;
  if (focusElem) {
    if (rect.top > 400) {
      wizHint.style.top = '';
      wizHint.style.bottom = '0px';
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
    const wizNext = document.getElementById('wizNext');
    const convert = (a) => {
      if (typeof a === 'object') return JSON.stringify(a);
      if (typeof a === 'number') return `${a}`;
      return a;
    };
    const compare = (a, b) => convert(a) === convert(b);
    const updateNextButton = () => {
      const isOk = compare(focusElem.value, action.require);
      if (isOk) wizNext.classList.remove('wizDisabled');
      else wizNext.classList.add('wizDisabled');
    };
    updateNextButton();
    wizNext.onclick = () => {if (compare(focusElem.value, action.require)) wizNextClick()};
    wizChangeAction = focusElem.onchange;
    focusElem.onchange = (event) => {
      if (wizChangeAction) {
        wizChangeAction.call(focusElem, event);
      }
      updateNextButton();
    };
  }

  // Assign action to move forward:
  switch (action.action) {
    case UI_FORCE_NEXT:
    case UI_FORCE_EXIT:
    default:
      break;
    case UI_FORCE_CLICK:
      wizFocusAction = focusElem.onclick;
      focusElem.onclick = (event) => wizAction(event);
      break;
  }

  wizWaiting = true;
  while (wizActive && wizWaiting) {
    await delay(200);
    // console.log('waiting');
  }

  // Clean up
  wizCircle.style.display = 'none';
  wizDisableBox.style.display = 'none';
  wizHint.style.display = 'none';
  if (focusElem) {
    focusElem.onclick = wizFocusAction;
    focusElem.onchange = wizChangeAction;
    focusElem.style.zIndex = oldFocus.zIndex;
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
    console.log(`Action ${i}`);
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
      return;
    }
  }
}

function initializeWizzard() {
  document.write(`
<style>
  .circle {
    display: none;
    border: 6px solid #000;
    border-radius: 40%;
    position: absolute;
    border-color: #F00;
    z-index: 20;
//    margin:0em auto;
//    padding:0em 0em 0em 0em;
//    background:radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 0, 0.6) 56%, rgba(0, 0, 0, 0.6) 100%);
//    text-align:center;
//    vertical-align:middle;
  }

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
  background-color: #000A;
  border: 0px solid #ddd;
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
  background-color: #fffA;
  text-align: center;
  border: 1px solid #d3d3d3;
  box-shadow: 10px 10px 10px #000A;
  border-radius: 7px;
}

.wizPopupHeader {
  padding: 10px;
  cursor: move;
  z-index: 10;
  background-color: #2AFD;
  color: #fff;
  border-radius: 7px 7px 0 0;
}

.wizPopupText {
  color: #000;
}


</style>

<div id="wizDisableBox">
</div>

<div id="wizCircle" class="circle"></div>

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
  if (document.getElementById(elmnt.id + "Header")) {
    /* if present, the header is where you move the DIV from:*/
    document.getElementById(elmnt.id + "Header").onmousedown = dragMouseDown;
  } else {
    /* otherwise, move the DIV from anywhere inside the DIV:*/
    elmnt.onmousedown = dragMouseDown;
  }

  function dragMouseDown(e) {
    e = e || window.event;
    e.preventDefault();
    // get the mouse cursor position at startup:
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    // call a function whenever the cursor moves:
    document.onmousemove = elementDrag;
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
    elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
    elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
  }

  function closeDragElement() {
    /* stop moving when mouse button is released:*/
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

initializeWizzard();

module.exports = {
  wizGotoLimiters,
  runActionQueue,
};
