/* eslint-disable comma-dangle */

'use strict';

const fs = require('fs');
const MinimalPng = require('../lib/minimalpng');
const PngDecode = require('../lib/pngDecode');

async function testEncode() {
  console.log('[......] Test PNG Encode');
  const myFile = fs.createWriteStream('testImg.png');

  const height = 10;
  const width = 1000;
  const channels = 4;
  const fb = new ArrayBuffer(height * width * channels);
  const data = new Uint8Array(fb);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      for (let c = 0; c < channels; c++) {
        const color = (c === 3) ? 255 : x;
        data[(y * width + x) * channels + c] = color;
      }
    }
  }

  const encoder = new MinimalPng({ width, height, channels, imageData: data });
  encoder.pipe(myFile);
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function testDecode() {
  console.log('[......] Test PNG Decode');
  const decoder = new PngDecode(true);
  const fb = await decoder.load('../assets/images/large.png');//'testImg.png');//

  const myFile = fs.createWriteStream('testDecode.png');
  const data = new Uint8Array(decoder.imageData);
  const encoder = new MinimalPng({ width: decoder.width, height: decoder.height, channels: decoder.channels, imageData: data, fast: false });
  encoder.pipe(myFile);
  console.log('\x1b[1A[\x1b[32mPASSED\x1b[0m]');
}

async function startAllTests() {
  try {
    //await testEncode();
    await testDecode();
  } catch (err) {
    console.log('\x1b[1A[\x1b[31mFAILED\x1b[0m]');
    console.log(err);
  }
}

startAllTests();
