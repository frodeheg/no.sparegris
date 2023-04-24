'use strict';

/**
 * Take an array of values as input and find the index of the 3 largest elements
 * @param {*} ar The array to search
 * @returns an array of indices to the 3 largest elements
 */
function getMax3(ar) {
  if (ar === undefined) {
    return undefined;
  }
  const max = [];
  for (let i = 0; i < ar.length; i++) {
    if (Number.isNaN(+ar[i]) || ar[i] === null) {
      continue;
    } else if (max.length < 3) {
      max.push({ value: +ar[i], index: i });
    } else if (+ar[i] > max[0].value) {
      max[0] = { value: +ar[i], index: i };
    }
    max.sort((a, b) => a.value - b.value);
  }
  if (max.length === 0) return [];
  if (max.length === 1) return [max[0].index];
  return max.reduce((a, b) => (Array.isArray(a) ? [...a, b.index] : [a.index, b.index]));
}

/**
 * Calculates the average value of all the selected items in an array
 * @param {*} ar the array containing the values
 * @param {*} indices the array containing the indices
 */
function averageOfElements(ar, indices) {
  if (!Array.isArray(indices) || indices.length === 0 || !Array.isArray(ar)) return NaN;
  let sum = 0;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] < 0 || indices[i] >= ar.length) return NaN;
    sum += ar[indices[i]];
  }
  return (sum / indices.length);
}

/**
 * Toggles the visibility of an element
 */
function toggle(source, id, type = 'block') {
  const element = document.getElementById(id);

  const visible = (element.style.display !== '') && (element.style.display !== 'none');
  if (visible) {
    element.style.display = 'none';
    if (source) source.style.cursor = 'zoom-in';
  } else {
    element.style.display = type;
    if (source) source.style.cursor = 'zoom-out';
  }
  return false; // For onclick not to follow the link
}

/**
 * Local function only used by updateTranslations
 */
const translationTable = {}; // Cache
function __localTranslate(string, languageTable) {
  let parts;
  try {
    parts = string.split('.');
  } catch (err) {
    if (string in translationTable) {
      return this.__(translationTable[string]);
    }
    return `Missing: ${string}`;
  }
  let ptr = languageTable;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] in ptr) {
      ptr = ptr[parts[i]];
    } else if (string in translationTable) {
      // This is a hack to reverse engineer previously loaded strings that has been overwritten by a translation string
      // This is only applicable when debugging and changing language
      return this.__(translationTable[string]);
    } else {
      console.log(`requested ${string} not found`);
      return `Missing: ${string}`;
    }
  }
  // console.log(`requested ${string} ==> ${ptr}`);
  translationTable[ptr] = string;
  return ptr;
}

/**
 * Updates the translations of all html-elements
 * This is required because Homey does not update iFrame translations
 */
function updateTranslations(translations) {
  // Refresh all html code
  const objToTranslate = document.querySelectorAll('[data-i18n]');
  for (let i = 0; i < objToTranslate.length; i++) {
    objToTranslate[i].innerHTML = __localTranslate(objToTranslate[i].attributes.getNamedItem('data-i18n').value, translations);
  }
}

module.exports = {
  getMax3,
  averageOfElements,
  toggle,
  updateTranslations,
};
