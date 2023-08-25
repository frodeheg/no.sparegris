'use strict';

const fs = require('fs');
const { PNG } = require('pngjs/browser');

const CHAR_IMG = '../assets/images/Codepage-437.png';

// Load the character set
const textImg = new PNG();
let textImgReady = false;
let textImgError = false;
const textImgBorder = 8;
const textImgCharsPerLine = 32;
const charHeight = 16;
const charWidth = 9;
fs.createReadStream(CHAR_IMG)
  .on('error', () => { textImgError = true; })
  .pipe(textImg)
  .on('parsed', () => { textImgReady = true; });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isTextLoaded() {
  while (!textImgReady && !textImgError) {
    await sleep(1000);
  }
  if (textImgError) {
    return Promise.reject(new Error('Failed to load the font data'));
  }
  return Promise.resolve(true);
}

/**
 * This class adds functionality to PNG images so they can be modified
 */
class Textify extends PNG {

  constructor(params) {
    console.log('Created image');
    super(params);
    this.textCol = params.textCol ? params.textCol : { r: 128, g: 128, b: 128, a: 255 };
    this.textBg = params.textBg ? params.textBg : { r: 0, g: 0, b: 0, a: 0 };
  }

  /**
   * Internal function to blit a single character
   */
  async _blitChar(letter, destX, destY) {
    const charCode = letter.charCodeAt(0);
    const posY = Math.floor(charCode / textImgCharsPerLine);
    const posX = charCode % textImgCharsPerLine;
    const srcX = textImgBorder + charWidth * posX;
    const srcY = textImgBorder + charHeight * posY;
    for (let y = 0; y < charHeight; y++) {
      for (let x = 0; x < charWidth; x++) {
        const dstIdx = (this.width * (destY + y) + (destX + x)) << 2;
        const srcIdx = (textImg.width * (srcY + y) + (srcX + x)) << 2;

        const isBg = textImg.data[srcIdx] === 0;

        // invert color
        this.data[dstIdx] = isBg ? this.textBg.r : this.textCol.r;
        this.data[dstIdx + 1] = isBg ? this.textBg.g : this.textCol.g;
        this.data[dstIdx + 2] = isBg ? this.textBg.b : this.textCol.b;
        this.data[dstIdx + 3] = isBg ? this.textBg.a : this.textCol.a;
      }
    }
    // console.log(`Code ${charCode} | pos: ${posX}, ${posY}`);
    // textImg.bitblt(this, srcX, srcY, charWidth, charHeight, destX, destY);
  }

  /**
   * Changes the text colour
   */
  setTextColor(r, g, b, a) {
    this.textCol = { r, g, b, a };
  }

  /**
   * Changes the text background color
   */
  setTextBgColor(r, g, b, a) {
    this.textBg = { r, g, b, a };
  }

  /**
   * Adds text to the image
   */
  async addText(text, destX, destY) {
    // console.log(`adding ${text} to image ${this.width} x ${this.height}`);
    await isTextLoaded();
    let cursorX = destX;
    let cursorY = destY;
    for (let i = 0; i < text.length; i++) {
      await this._blitChar(text[i], cursorX, cursorY);
      cursorX += charWidth;
      if (cursorX + charWidth >= this.width) {
        cursorY += charHeight;
        cursorX = 0;
      }
    }
  }

}

module.exports = Textify;
