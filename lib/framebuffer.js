/* eslint-disable brace-style */
/* eslint-disable no-nested-ternary */
/* eslint-disable object-curly-newline */
/* eslint-disable comma-dangle */

'use strict';

const fs = require('fs');
const MinimalPng = require('./minimalpng');
const PngDecode = require('./pngDecode');
const { findFile } = require('../common/homeyfile');

// const CHAR_IMG = 'assets/images/Codepage-437.png'; // 9x16
const CHAR_IMG = 'assets/images/UTF-8-9x18.png';

// Text weights
const TEXT_WEIGHT = {
  NORMAL: 0,
  BOLD: 1,
  FAINT: 2,
  HIDDEN: 3
};

// Load the character set
let textImgReady = false;
let textImgError = false;
const textImg = new PngDecode();
const textImgBorder = 0;
const textImgCharsPerLine = 32;
const charHeight = 18;
const charWidth = 9;
findFile(CHAR_IMG)
  .then((file) => textImg.load(file))
  .then(() => { textImgReady = true; })
  .catch((err) => { textImgError = true; });

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilReady() {
  while (!textImgReady && !textImgError) {
    await sleep(1000);
  }
  if (textImgError) {
    return Promise.reject(new Error(`Failed to load the font data: ${textImgError}`));
  }
  return Promise.resolve(true);
}

/**
 * This class adds functionality to PNG images so they can be modified
 */
class Framebuffer {

  constructor(params) {
    this._baseCol = [128, 128, 128, 255];
    this._baseBg = [0, 0, 0, 0];
    this.textCol = params.textCol ? params.textCol : { r: 128, g: 128, b: 128, a: 255 };
    this.textBg = params.textBg ? params.textBg : { r: 0, g: 0, b: 0, a: 0 };
    this.textAngle = 0;
    this.textSize = 1;
    this.cursorX = 0;
    this.cursorY = 0;
    this.cursorMinX = 0;
    this.cursorMinY = 0;
    this.cursorMaxX = this.width;
    this.cursorMaxY = this.height;
    this.textWeight = TEXT_WEIGHT.NORMAL;
    this.textUnder = false;
    this.textItalic = false;

    this.width = params.width || 100;
    this.height = params.height || 100;
    this.channels = 4;
    this.fb = new ArrayBuffer(this.height * this.width * this.channels);
    this.data = new Uint8Array(this.fb);

    // Input files
    this.cachedFiles = {};
  }

  /**
   * Returns a single frame buffer stream
   * Need to call this again for a new stream for the next frame
   */
  pipe(target) {
    const { width, height, channels, data } = this;
    if (this.encoder) delete this.encoder;
    this.encoder = new MinimalPng({ width, height, channels, data });
    this.encoder.pipe(target);
  }

  /**
   * Loads a file
   */
  async loadFile(filename) {
    return new Promise((resolve, reject) => {
      const cache = this.cachedFiles;
      if (filename in cache) {
        resolve(cache[filename]);
      } else {
        const decoder = new PngDecode();
        decoder.load(filename)
          .then(() => {
            this.cachedFiles[filename] = decoder;
            resolve(decoder);
          })
          .catch((err) => reject(err));
      }
    })
      .then((loadedImage) => {
        // Copies the image into the framebuffer
        const { width, height } = loadedImage;
        return this.bitblt(loadedImage, 0, 0, width, height, 0, 0);
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
    // this.blit(textImg, srcX, srcY, charWidth, charHeight, destX, destY);
    // this.blitStretch(textImg, srcX, srcY, charWidth, charHeight, destX, destY, charWidth * 2, charHeight * 2);
    this.blitRot(textImg, srcX, srcY, charWidth, charHeight, destX, destY, charWidth * this.textSize, charHeight * this.textSize, this.textAngle);
  }

  // Blits an image into another
  async bitblt(src, srcX, srcY, srcW, srcH, destX, destY) {
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const dstIdx = (this.width * (destY + y) + (destX + x)) << 2;
        const srcIdx = (src.width * (srcY + y) + (srcX + x)) * src.channels;

        this.data[dstIdx] = src.data[srcIdx];
        this.data[dstIdx + 1] = src.data[srcIdx + 1];
        this.data[dstIdx + 2] = src.data[srcIdx + 2];
        this.data[dstIdx + 3] = src.channes > 3 ? src.data[srcIdx + 3] : 255;
      }
    }
    return Promise.resolve();
  }

  /**
   * Blit an image with text color replacement
   * No resizing or rotation is done
   */
  async blit(src, srcX, srcY, srcW, srcH, destX, destY) {
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const dstIdx = (this.width * (destY + y) + (destX + x)) << 2;
        const col = this.sample(src, srcX, srcY, srcW, srcH, x, y);
        const ai = 255 - col.a;
        this.data[dstIdx] = (this.data[dstIdx] * ai + col.r * col.a) / 255;
        this.data[dstIdx + 1] = (this.data[dstIdx + 1] * ai + col.g * col.a) / 255;
        this.data[dstIdx + 2] = (this.data[dstIdx + 2] * ai + col.b * col.a) / 255;
        this.data[dstIdx + 3] = 255;
      }
    }
    // src.bitblt(this, srcX, srcY, charWidth, charHeight, destX, destY);
  }

  /**
   * Blit an image stratched as indicated
   */
  async blitStretch(src, srcX, srcY, srcW, srcH, destX, destY, destW, destH) {
    if (srcW === destW && srcH === destH) {
      this.blit(src, srcX, srcY, srcW, srcH, destX, destY);
      return;
    }
    for (let dy = 0; dy < destH; dy++) {
      for (let dx = 0; dx < destW; dx++) {
        const dstIdx = (this.width * (destY + dy) + (destX + dx)) << 2;
        const sx = Math.round(((dx + 0.5) / destW) * srcW - 0.5);
        const sy = Math.round(((dy + 0.5) / destH) * srcH - 0.5);
        const col = this.sample(src, srcX, srcY, srcW, srcH, sx, sy);
        // const scaling = destW / srcW;
        // const col = this.sampleBilinear(src, srcX, srcY, srcW, srcH, sx, sy, scaling);
        const ai = 255 - col.a;
        this.data[dstIdx] = (this.data[dstIdx] * ai + col.r * col.a) / 255;
        this.data[dstIdx + 1] = (this.data[dstIdx + 1] * ai + col.g * col.a) / 255;
        this.data[dstIdx + 2] = (this.data[dstIdx + 2] * ai + col.b * col.a) / 255;
        this.data[dstIdx + 3] = 255;
      }
    }
  }

  /**
   * Blit a rotated image
   */
  async blitRot(src, srcX, srcY, srcW, srcH, destX, destY, destW, destH, angle) {
    if (angle === 0) {
      this.blitStretch(src, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
      return;
    }
    const angleRad = (angle / 180) * Math.PI;
    const destR = Math.sqrt(destW * destW + destH * destH) / 2;
    const destA = Math.atan2(-destH, destW) + angleRad;
    const destCenterX = destX + (destR * Math.cos(destA));
    const destCenterY = destY + (charHeight * this.textSize * Math.cos(angleRad)) + (destR * Math.sin(destA));
    for (let ry = -destR; ry <= destR; ry++) {
      for (let rx = -destR; rx <= destR; rx++) {
        const rr = Math.sqrt(rx * rx + ry * ry);
        const ra = Math.atan2(-ry, rx) - angleRad;
        const dx = (destW / 2) + rr * Math.cos(ra);
        const dy = (destH / 2) - rr * Math.sin(ra);
        const dstIdx = (this.width * Math.round(destCenterY + ry) + Math.round(destCenterX + rx)) << 2;
        const sx = (dx / destW) * srcW;
        const sy = (dy / destH) * srcH;
        if ((sx < -1) || (sy < -1) || (sx >= srcW) || (sy >= srcH)) continue;

        const col = this.sample(src, srcX, srcY, srcW, srcH, Math.round(sx), Math.round(sy));
        // const scaling = destW / srcW;
        // const col = this.sampleBilinear(src, srcX, srcY, srcW, srcH, sx, sy, scaling);
        const ai = 255 - col.a;
        this.data[dstIdx] = (this.data[dstIdx] * ai + col.r * col.a) / 255;
        this.data[dstIdx + 1] = (this.data[dstIdx + 1] * ai + col.g * col.a) / 255;
        this.data[dstIdx + 2] = (this.data[dstIdx + 2] * ai + col.b * col.a) / 255;
        this.data[dstIdx + 3] = 255;
      }
    }
  }

  /**
   * Sample an image using nearest filter
   * -Assumes that x and y are integers
   */
  sample(src, startx, starty, w, h, x, y) {
    const srcIdx = (src.width * (starty + y) + (startx + x)) * src.channels;
    const rawTexel = src.data[srcIdx];
    const isUnder = this.textUnder && y === (charHeight - 1);
    const isBg = (x < 0) || (y < 0) || (x >= w) || (y >= h) || (rawTexel === 0 && !isUnder);
    if (isBg) return this.textBg;
    const alphaFg = isUnder ? this.textCol.a : (((rawTexel + 1) * this.textCol.a) >> 8);
    const alphaBg = this.textBg.a;
    const a = Math.max(alphaFg, alphaBg);
    const a1 = alphaFg + 1;
    const a2 = 256 - a1;
    const r = (this.textCol.r * a1 + this.textBg.r * a2) >> 8;
    const g = (this.textCol.g * a1 + this.textBg.g * a2) >> 8;
    const b = (this.textCol.b * a1 + this.textBg.b * a2) >> 8;
    return { r, g, b, a };
  }

  /**
   * Sample an image using bilinear filter
   */
  sampleBilinear(src, startx, starty, w, h, x, y, scaling) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const dx = x - x0;
    const dy = y - y0;
    const mdx = 1 - dx;
    const mdy = 1 - dy;
    const col00 = this.sample(src, startx, starty, w, h, x0, y0);
    const col01 = this.sample(src, startx, starty, w, h, x1, y0);
    const col10 = this.sample(src, startx, starty, w, h, x0, y1);
    const col11 = this.sample(src, startx, starty, w, h, x1, y1);
    const col = {};
    const o = dx < (1 / scaling) ? 0.5 : 0; // red/blue offset for text
    col.r = Math.round((col00.r * mdy + col10.r * dy) * (mdx + o) + (col01.r * mdy + col11.r * dy) * (dx - o));
    col.g = Math.round((col00.g * mdy + col10.g * dy) * mdx + (col01.g * mdy + col11.g * dy) * dx);
    col.b = Math.round((col00.b * mdy + col10.b * dy) * (mdx - o) + (col01.b * mdy + col11.b * dy) * (dx + o));
    col.a = Math.round((col00.a * mdy + col10.a * dy) * mdx + (col01.a * mdy + col11.a * dy) * dx);
    return col;
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
   * Changes the angle to draw text in degrees
   */
  async setTextAngle(deg) {
    this.textAngle = deg;
  }

  /**
   * Changes the text size
   */
  async setTextSize(scale) {
    this.textSize = scale;
  }

  /**
   * Moves the cursor
   */
  async moveCursor(newX, newY) {
    this.cursorX = Math.round(newX);
    this.cursorY = Math.round(newY);
  }

  /**
   * Sets the size of the cursor window
   */
  async setCursorWindow(startX, startY, endX, endY) {
    this.cursorMinX = Math.round(startX);
    this.cursorMinY = Math.round(startY);
    this.cursorMaxX = Math.round(endX);
    this.cursorMaxY = Math.round(endY);
    this.cursorX = Math.round(startX);
    this.cursorY = Math.round(startY);
  }

  /**
   * Adds text to the image
   */
  async addText(text, destX = this.cursorX, destY = this.cursorY) {
    let match;
    let parsing;
    // console.log(`adding ${text} to image ${this.width} x ${this.height}`);
    await waitUntilReady();
    this.cursorX = Math.round(destX);
    this.cursorY = Math.round(destY);
    for (let i = 0; i < text.length; i++) {
      let nextLine = false;
      switch (text[i]) {
        case '\n':
          nextLine = true;
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
          this.cursorX += charWidth * this.textSize * Math.cos((this.textAngle / 180) * Math.PI);
          this.cursorY -= charWidth * this.textSize * Math.sin((this.textAngle / 180) * Math.PI);
          if (this.cursorX + this.getWidth(text.substring(i + 1).split(/[\s,\n]+/, 1)[0] || ' ') >= this.cursorMaxX) {
            nextLine = true;
            // Skip next character if it's a space
            if (i + 1 < text.length && text[i + 1] === ' ') i++;
          }
          break;
      }
      if (nextLine) {
        this.cursorX = this.cursorMinX;
        this.cursorY += charHeight * this.textSize;
      }
      if (this.cursorY + charHeight >= this.cursorMaxY) {
        this.cursorY = this.cursorMinY;
      }
    }
    return Promise.resolve();
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
    const px = isMajorx ? Math.sign(dx) : (dx / Math.abs(dy));
    const py = isMajorx ? (dy / Math.abs(dx)) : Math.sign(dy);
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
    const oldState = {
      col: [this.textCol.r, this.textCol.g, this.textCol.b, this.textCol.a],
      size: this.textSize,
      startX: this.cursorMinX,
      startY: this.cursorMinY,
      endX: this.cursorMaxX,
      endY: this.cursorMaxY
    };
    const gridCol = ('gridCol' in data) ? data.gridCol : oldState.Col;
    const onIndicatorHeight = 20;
    this.textSize = 1;
    // await this.drawBox(x, y, w, h);
    const padX = charWidth * 6;
    const padY = charWidth * 6;
    await this.drawLine(x + padX, y, x + padX, y + h - padY);
    await this.drawLine(x + padX, y + h - padY, x + w, y + h - padY);
    // Draw x-axis text
    await this.setTextAngle(90);
    await this.setTextColor(data.xCol);
    await this.setCursorWindow(0, 0, this.width, this.height);
    for (let i = 0; i < data.xAxisText.length; i++) {
      const toCenter = charHeight / 2;
      const texX = Math.round(x + padX - toCenter + ((w - padX) / data.xAxisText.length) * (i + 0.5));
      const texY = Math.round(y + h - charWidth * this.textSize * 1.5);
      await this.addText(data.xAxisText[i], texX, texY);
    }
    // Draw y-axis text
    const filteredValues = data.values.filter((val) => Number.isFinite(val));
    const minVal = Math.min(...filteredValues) || 0;
    const maxVal = Math.max(...filteredValues) || 1;
    const yDelta = maxVal - minVal;
    const dPow = Math.floor(Math.log10(yDelta));
    const scaler = 10 ** -dPow;
    const ystep = Math.ceil(yDelta * scaler) / (10 * scaler);
    const yspan = h - padY - 2 * charHeight - ('group' in data ? onIndicatorHeight : 0);
    const ystart = y + 1.5 * charHeight;
    await this.setTextAngle(0);
    await this.setTextColor(data.lineCol);
    await this.addText(data.yAxisText, x + padX - (data.yAxisText.length + 1) * charWidth, y);
    for (let yval = minVal; yval <= maxVal; yval += ystep) {
      const charCenter = charHeight / 2;
      const yLinePos = ystart + (yspan * (maxVal - yval)) / yDelta;
      const numText = ((dPow < 1) && (dPow > -2)) ? Number.parseFloat(yval).toFixed(1 - dPow)
        : Number.parseFloat(Math.round(yval * scaler * 10) / (scaler * 10)).toString();
      await this.setTextColor(gridCol);
      await this.drawLine(x + padX, yLinePos, x + padX - 5, yLinePos);
      await this.setTextColor(data.yCol);
      await this.addText(numText, x + padX - (numText.length + 1) * charWidth, yLinePos - charCenter);
    }
    // Draw actual line
    await this.setTextColor(data.lineCol);
    for (let i = 1; i < data.values.length; i++) {
      const val0 = data.values[i - 1];
      const val1 = data.values[i];
      const x0 = Math.round(x + padX + ((w - padX) / data.xAxisText.length) * (i - 0.5));
      const x1 = Math.round(x + padX + ((w - padX) / data.xAxisText.length) * (i + 0.5));
      const y0 = ystart + (yspan * (maxVal - val0)) / yDelta;
      const y1 = ystart + (yspan * (maxVal - val1)) / yDelta;

      // await this.drawLine(x0, y0, x1, y1);
      if (Number.isFinite(val0)) await this.drawLine(x0, y0, x0 + (x1 - x0) / 2, y0);
      if (Number.isFinite(val0)
        && Number.isFinite(val1)) await this.drawLine(x0 + (x1 - x0) / 2, y0, x0 + (x1 - x0) / 2, y1);
      if (Number.isFinite(val1)) await this.drawLine(x0 + (x1 - x0) / 2, y1, x1, y1);
    }
    // Draw enabled bar
    if ('group' in data) {
      await this.addText(data.groupText, x + padX - (data.groupText.length + 1) * charWidth, y + h - padY - (onIndicatorHeight / 2) - charHeight / 2);
      for (let i = padX + 1; i < w; i++) {
        const hour = Math.floor(((i - padX) / (w - padX)) * data.values.length);
        if (data.group[hour] !== undefined) {
          await this.setTextColor(data.groupCol[data.group[hour]]);
          await this.drawLine(x + i, y + h - padY - 1, x + i, y + h - padY - onIndicatorHeight);
        }
      }
    }
    await this.setTextColor(oldState.col);
    await this.setCursorWindow(oldState.startX, oldState.startY, oldState.endX, oldState.endY);
    this.textSize = oldState.size;
  }

  /**
   * Calculate the width of a text string
   */
  getWidth(text) {
    return text.length * charWidth * this.textSize;
  }

}

module.exports = Framebuffer;
