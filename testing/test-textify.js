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
dst.loadFile('../drivers/piggy-charger/assets/images/notValid.png')
  .then(() => dst.setCursorWindow(190, 80, 460, 170))
  .then(() => dst.setTextColor([255, 128, 128, 255]))
  .then(() => dst.addText('The device can not be used\nbefore the check-list below\nhas been completed\n'))
  .then(() => dst.addText('-----------------------------'))
  .then(() => dst.setCursorWindow(40, 185, 460, 460))
  .then(() => dst.setTextColor([255, 255, 255, 255]))
  .then(() => dst.addText(`${errText} Connect xxxx\n`))
  .then(() => dst.addText(`${okText} device\n`))
  .then(() => dst.pack().pipe(fs.createWriteStream('out.png')));
