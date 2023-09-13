/* eslint-disable object-curly-newline */
/* eslint-disable comma-dangle */

'use strict';

const fs = require('fs');
const { PNG } = require('pngjs/browser');

const CHAR_IMG = '../assets/images/Codepage-437.png';

// Text weights
const TEXT_WEIGHT = {
  NORMAL: 0,
  BOLD: 1,
  FAINT: 2,
  HIDDEN: 3
};

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
  .on('parsed', () => { console.log('init done'); textImgReady = true; });

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilReady() {
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
    this._baseCol = [128, 128, 128, 255];
    this._baseBg = [0, 0, 0, 0];
    this.textCol = params.textCol ? params.textCol : { r: 128, g: 128, b: 128, a: 255 };
    this.textBg = params.textBg ? params.textBg : { r: 0, g: 0, b: 0, a: 0 };
    this.cursorX = 0;
    this.cursorY = 0;
    this.cursorMinX = 0;
    this.cursorMinY = 0;
    this.cursorMaxX = this.width;
    this.cursorMaxY = this.height;
    this.textWeight = TEXT_WEIGHT.NORMAL;
    this.textUnder = false;
    this.textItalic = false;
  }

  /**
   * Loads a file
   */
  async loadFile(filename) {
    return new Promise((resolve, reject) => {
      fs.createReadStream(filename)
        .on('error', () => reject(new Error(`Could not load image ${filename}`)))
        .pipe(this)
        .on('parsed', () => resolve());
    });
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

        const isBg = textImg.data[srcIdx] === 0
          && (!this.textUnder || y !== (charHeight - 1));

        // invert color
        const a = isBg ? this.textBg.a : this.textCol.a;
        const ai = 255 - a;
        this.data[dstIdx] = (this.data[dstIdx] * ai + (isBg ? this.textBg.r : this.textCol.r) * a) / 255;
        this.data[dstIdx + 1] = (this.data[dstIdx + 1] * ai + (isBg ? this.textBg.g : this.textCol.g) * a) / 255;
        this.data[dstIdx + 2] = (this.data[dstIdx + 2] * ai + (isBg ? this.textBg.b : this.textCol.b) * a) / 255;
        this.data[dstIdx + 3] = 255;
      }
    }
    // console.log(`Code ${charCode} | pos: ${posX}, ${posY}`);
    // textImg.bitblt(this, srcX, srcY, charWidth, charHeight, destX, destY);
  }

  /**
   * Changes the text colour
   */
  async setTextColor(col) {
    this.textCol = {
      r: Math.min(col[0], 255),
      g: Math.min(col[1], 255),
      b: Math.min(col[2], 255),
      a: Math.min(col[3], 255)
    };
  }

  /**
   * Changes the text background color
   */
  async setTextBgColor(col) {
    this.textBg = {
      r: Math.min(col[0], 255),
      g: Math.min(col[1], 255),
      b: Math.min(col[2], 255),
      a: Math.min(col[3], 255)
    };
  }

  /**
   * Moves the cursor
   */
  async moveCursor(newX, newY) {
    this.cursorX = newX;
    this.cursorY = newY;
  }

  /**
   * Sets the size of the cursor window
   */
  async setCursorWindow(startX, startY, endX, endY) {
    this.cursorMinX = startX;
    this.cursorMinY = startY;
    this.cursorMaxX = endX;
    this.cursorMaxY = endY;
    this.cursorX = startX;
    this.cursorY = startY;
  }

  /**
   * Adds text to the image
   */
  async addText(text, destX = this.cursorX, destY = this.cursorY) {
    let match;
    let parsing;
    // console.log(`adding ${text} to image ${this.width} x ${this.height}`);
    await waitUntilReady();
    this.cursorX = destX;
    this.cursorY = destY;
    for (let i = 0; i < text.length; i++) {
      switch (text[i]) {
        case '\n':
          this.cursorY += charHeight;
          this.cursorX = this.cursorMinX;
          break;
        case '\u001b':
          // ANSI escape code ( https://en.wikipedia.org/wiki/ANSI_escape_code )
          if (text[i + 1] === '[') {
            i++;
            parsing = true;
            while (i + 1 < text.length && parsing) {
              match = text.substring(i + 1).match(/^(\d)(\d*)/);
              if (match) {
                i += match[0].length;
                if (match[0].length === 1) {
                  switch (match[1]) {
                    case '0': // Reset
                      this.textWeight = TEXT_WEIGHT.NORMAL;
                      this.textUnder = false;
                      this.textItalic = false;
                      this._baseBg[0] = 0;
                      this._baseBg[1] = 0;
                      this._baseBg[2] = 0;
                      this._baseBg[3] = 0;
                      this._baseCol[0] = 128;
                      this._baseCol[1] = 128;
                      this._baseCol[2] = 128;
                      this._baseCol[3] = 255;
                      break;
                    case '1': // Bold
                      this.textWeight = TEXT_WEIGHT.BOLD;
                      break;
                    case '2': // Faint
                      this.textWeight = TEXT_WEIGHT.FAINT;
                      break;
                    case '3': // Italic
                      this.textItalic = true;
                      break;
                    case '4': // Underline
                      this.textUnder = true;
                      break;
                    default: // Ignore
                      break;
                  }
                } else {
                  switch (match[1]) {
                    case '1': // Change font 10-19, Bright Background 100-107
                      if (match[2].length === 2) {
                        this._baseBg[0] = (+match[2] & 1) ? 255 : 0;
                        this._baseBg[1] = (+match[2] & 2) ? 255 : 0;
                        this._baseBg[2] = (+match[2] & 4) ? 255 : 0;
                        this._baseBg[3] = 255;
                      }
                      break;
                    case '2': // Turn off
                      if (match[2] === '2') this.textWeight = TEXT_WEIGHT.NORMAL;
                      else if (match[2] === '3') this.textItalic = false;
                      else if (match[2] === '4') this.textUnder = false;
                      break;
                    case '3': // Text color
                      this._baseCol[0] = (+match[2] & 1) ? 128 : 0;
                      this._baseCol[1] = (+match[2] & 2) ? 128 : 0;
                      this._baseCol[2] = (+match[2] & 4) ? 128 : 0;
                      this._baseCol[3] = 255;
                      break;
                    case '4': // Background color
                      this._baseBg[0] = (+match[2] & 1) ? 128 : 0;
                      this._baseBg[1] = (+match[2] & 2) ? 128 : 0;
                      this._baseBg[2] = (+match[2] & 4) ? 128 : 0;
                      this._baseBg[3] = 255;
                      break;
                    case '9': // Bright text color
                      this._baseCol[0] = (+match[2] & 1) ? 192 : 0;
                      this._baseCol[1] = (+match[2] & 2) ? 192 : 0;
                      this._baseCol[2] = (+match[2] & 4) ? 192 : 0;
                      this._baseCol[3] = 255;
                      break;
                    default: // Ignore
                      break;
                  }
                }
              } else if (text[i + 1] === ';') {
                i++;
              } else if (text[i + 1] === 'm') {
                i++;
                parsing = false;
              }
            }
          }
          this.setTextColor([
            this._baseCol[0] << ((this.textWeight === TEXT_WEIGHT.BOLD) ? 1 : 0),
            this._baseCol[1] << ((this.textWeight === TEXT_WEIGHT.BOLD) ? 1 : 0),
            this._baseCol[2] << ((this.textWeight === TEXT_WEIGHT.BOLD) ? 1 : 0),
            this._baseCol[3] >> ((this.textWeight === TEXT_WEIGHT.FAINT) ? 1 : 0)
          ]);
          this.setTextBgColor(this._baseBg);
          break;
        default:
          this._blitChar(text[i], this.cursorX, this.cursorY);
          this.cursorX += charWidth;
          if (this.cursorX + charWidth >= this.cursorMaxX) {
            this.cursorX = this.cursorMinX;
            this.cursorY += charHeight;
          }
          break;
      }
      if (this.cursorY + charHeight >= this.cursorMaxY) {
        this.cursorY = this.cursorMinY;
      }
    }
  }

  /**
   * Draw a pixel
   */
  async putPixel(x, y) {
    const dstIdx = (this.width * y + x) << 2;

    const { a } = this.textCol;
    const ai = 255 - a;
    this.data[dstIdx] = (this.data[dstIdx] * ai + this.textCol.r * a) / 255;
    this.data[dstIdx + 1] = (this.data[dstIdx + 1] * ai + this.textCol.g * a) / 255;
    this.data[dstIdx + 2] = (this.data[dstIdx + 2] * ai + this.textCol.b * a) / 255;
    this.data[dstIdx + 3] = 255;
  }

  /**
   * Draw a line
   */
  async drawLine(sx, sy, ex, ey) {
    const dx = ex - sx;
    const dy = ey - sy;
    const isMajorx = (Math.abs(dy) < Math.abs(dx));
    const px = isMajorx ? Math.sign(dx) : (dx / dy);
    const py = isMajorx ? (dy / dx) : Math.sign(dy);
    let remaining = Math.abs(isMajorx ? dx : dy);
    let x = sx;
    let y = sy;
    while (remaining > 0) {
      this.putPixel(Math.round(x), Math.round(y));
      x += px;
      y += py;
      remaining--;
    }
  }

  /**
   * Draw a box
   */
  async drawBox(x, y, w, h) {
    this.drawLine(x, y, x, y + h);
    this.drawLine(x, y + h, x + w, y + h);
    this.drawLine(x + w, y + h, x + w, y);
    this.drawLine(x + w, y, x, y);
  }

  /**
   * Draws a line chart
   */
  async drawLineChart(x, y, w, h, data) {
    this.drawBox(x, y, w, h);
    const padX = charWidth * 10;
    const padY = charHeight * 2;
    this.drawLine(x + padX, y, x + padX, y + h - padY);
    this.drawLine(x + padX, y + h - padY, x + w, y + h - padY);
    // Draw x-axis text
    for (let i = 0; i < data.xaxis.length; i++) {
      const toCenter = (data.xaxis[i].length * charWidth) / 2;
      const texX = Math.round(x + padX - toCenter + ((w - padX) / data.xaxis.length) * (i + 0.5));
      const texY = Math.round(y - padY + h + 5);
      this.addText(data.xaxis[i], texX, texY);
    }
    // Draw y-axis text
    const minVal = Math.min(...data.values);
    const maxVal = Math.max(...data.values);
    const yDelta = maxVal - minVal;
    const ystep = 10 ** (Math.floor(Math.log10(yDelta)) - 1);
    console.log(minVal);
    console.log(maxVal);
  }

}

module.exports = Textify;
