'use strict';

/**
 * Take an array of values as input and find the index of the 3 largest elements
 * @param {*} ar The array to search
 * @returns an array of indices to the 3 largest elements
 */
function getMax3(ar) {
  if (ar.length <= 3) return Object.keys(ar);
  const max = [
    { value: ar[0], index: 0 },
    { value: ar[1], index: 1 },
    { value: ar[2], index: 2 }];
  max.sort((a, b) => a.value - b.value);
  for (let i = 3; i < ar.length; i++) {
    if (ar[i] > max[0].value) {
      max[0] = { value: ar[i], index: i };
      max.sort((a, b) => a.value - b.value);
    }
  }
  return max.reduce((a, b) => (Array.isArray(a) ? [...a, b.index] : [a.index, b.index]));
}

/**
 * Calculates the average value of all the selected items in an array
 * @param {*} ar the array containing the values
 * @param {*} indices the array containing the indices
 */
function averageOfElements(ar, indices) {
  if (!Array.isArray(indices) || !Array.isArray(ar)) return NaN;
  let sum = 0;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] < 0 || indices[i] >= ar.length) return NaN;
    sum += ar[indices[i]];
  }
  return (sum / indices.length);
}

module.exports = {
  getMax3,
  averageOfElements,
};
