'use strict';

const fs = require('fs');
// const { PNG } = require('pngjs/browser');
const Textify = require('../lib/textify');

const myPng = new Textify({
  width: 100,
  height: 100,
  colorType: 2,
  filterType: 4,
  bgColor: { red: 80, green: 80, blue: 80 },
  textCol: { r: 255, g: 255, b: 255, a: 255 },
  textBg: { r: 0, g: 0, b: 0, a: 0 }
});
/*myPng.addText('Dette er en test', 0, 0)
  .then(() => {
    console.log('done');
    myPng.pack().pipe(fs.createWriteStream('out.png'));});*/

//const dst = new Textify({ width: 100, height: 100, colorType: 2, bgColor: { red: 255, green: 0, blue: 0 }});
myPng.addText('Dette er en test', 0, 0)
  .then(() => myPng.pack().pipe(fs.createWriteStream('out.png')));
