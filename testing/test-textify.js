'use strict';

const fs = require('fs');
// const { PNG } = require('pngjs/browser');
const Textify = require('../lib/textify');

const dst = new Textify({
  width: 500,
  height: 500,
  colorType: 2,
  filterType: 4,
  bgColor: { red: 80, green: 80, blue: 80 },
  textCol: { r: 255, g: 255, b: 255, a: 255 },
  textBg: { r: 0, g: 0, b: 0, a: 0 }
});

const okText = '[\u001b[32;1m OK \u001b[37m]';
const errText = '[\u001b[31;1mFAIL\u001b[37m]';
dst.setCursorWindow(50, 0, 500, 16 * 4)
  .then(() => dst.setTextColor([255, 128, 128, 255]))
  .then(() => dst.addText('The device can not be used before the check list below has been completed\n'))
  .then(() => dst.addText('--------------------------------'))
  .then(() => dst.setCursorWindow(0, 2 * 16, 500, 500))
  .then(() => dst.setTextColor([255, 255, 255, 255]))
  .then(() => dst.addText(`${errText} Connect xxxx\n`))
  .then(() => dst.addText(`${okText} device\n`))
  .then(() => dst.pack().pipe(fs.createWriteStream('out.png')));
