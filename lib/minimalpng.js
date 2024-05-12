/* eslint-disable comma-dangle */

'use strict';

const zlib = require('zlib');
const { Readable } = require('stream');
const { COLOURTYPE, FILTER, signature, crc32, paethPredictor } = require('./pngBasics');

/**
 * Encodes a frame to PNG
 * PNG spec is located at https://www.w3.org/TR/png/
 * APNG is easiest explained here: https://en.wikipedia.org/wiki/APNG
 */
class MinimalPng extends Readable {

  constructor(opts) {
    super(opts);
    this.width = opts.width;
    this.height = opts.height;
    this.channels = opts.channels || COLOURTYPE.RGBA;
    this.data = opts.imageData;
    this.ypos = null;
    this.fast = opts.fast === undefined ? true : opts.fast;

    switch (this.channels) {
      case 1: this.colourType = COLOURTYPE.LUMINANCE; break;
      case 2: this.colourType = COLOURTYPE.LUMINANCE_A; break;
      case 3: this.colourType = COLOURTYPE.RGB; break;
      case 4: this.colourType = COLOURTYPE.RGBA; break;
      default: this.colourType = COLOURTYPE.INDEXED; break;
    }
    this.bitdepth = 8; // 1, 2, 4, 8 or 16
    this.compressType = 0;
    this.filterType = 0;
    this.interlaceType = 0; // Disabled

    // Memory requirement: (1 << (windowBits + 2)) + (1 << (memLevel + 9))
    // Defaults are windowBits: 15, numLevel: 8 = 256K
    this.deflator = zlib.createDeflate({ windowBits: 8, numLevel: 5 });
    this.deflator.on('data', (data) => {
      this.writeChunk('IDAT', data);
    });
    this.deflator.on('end', () => {
      this.writeChunk('IDAT', Buffer.from([0, 0, 0, 0])); // Image checksum (ignored)
      this.writeChunk('IEND', Buffer.from([]));
      this.push(null);
    });
  }

  filterLineSub(inputData) {
    const filtered = [];
    for (let rgb = 0; rgb < this.channels; rgb++) {
      filtered[rgb] = inputData[rgb];
    }
    for (let x = 1; x < this.width; x++) {
      for (let rgb = 0; rgb < this.channels; rgb++) {
        const index = (x * this.channels) + rgb;
        filtered[index] = inputData[index] - inputData[index - this.channels];
      }
    }
    return new Uint8Array(filtered);
  }

  filterLineUp(inputData, prevLine, lineLength) {
    const filtered = [];
    if (this.ypos === 0) {
      for (let i = 0; i < lineLength; i++) {
        filtered[i] = inputData[i];
      }
    } else {
      for (let i = 0; i < lineLength; i++) {
        filtered[i] = inputData[i] - prevLine[i];
      }
    }
    return new Uint8Array(filtered);
  }

  filterLineAverage(inputData, prevLine, lineLength) {
    const filtered = [];
    for (let i = 0; i < lineLength; i++) {
      const a = i < this.channels ? 0 : inputData[i - this.channels];
      const b = this.ypos === 0 ? 0 : prevLine[i];
      filtered[i] = inputData[i] - Math.floor((a + b) / 2);
    }
    return new Uint8Array(filtered);
  }

  filterLinePaeth(inputData, prevLine, lineLength) {
    const filtered = [];
    for (let i = 0; i < lineLength; i++) {
      const a = i < this.channels ? 0 : inputData[i - this.channels];
      const b = this.ypos === 0 ? 0 : prevLine[i];
      const c = (this.ypos === 0 || i < this.channels) ? 0 : prevLine[i - this.channels];
      filtered[i] = inputData[i] - paethPredictor(a, b, c);
    }
    return new Uint8Array(filtered);
  }

  filterPredictor(inputData) {
    const i8array = new Int8Array(inputData);
    let sum = 0;
    for (let i = 0; i < inputData.length; i++) {
      sum += Math.abs(i8array[i]);
    }
    return sum;
  }

  _read() {
    if (this.ypos === null) {
      this.writeHeader();
      this.ypos = 0;
    } else if (this.ypos < this.height) {
      const start = this.width * this.ypos * this.channels;
      const end = start + this.width * this.channels;
      const linePointer = this.data.subarray(start, end); // Points to original data
      let filter = FILTER.NONE;
      let filteredPointer = linePointer;
      if (!this.fast) {
        const lineLength = this.width * this.channels;
        const prevLine = this.data.subarray(start - lineLength, end - lineLength);
        const filtered = [];
        const costs = [];
        filtered[FILTER.NONE] = linePointer;
        filtered[FILTER.SUB] = this.filterLineSub(linePointer, lineLength);
        filtered[FILTER.UP] = this.filterLineUp(linePointer, prevLine, lineLength);
        filtered[FILTER.AVERAGE] = this.filterLineAverage(linePointer, prevLine, lineLength);
        filtered[FILTER.PAETH] = this.filterLinePaeth(linePointer, prevLine, lineLength);
        filter = FILTER.NONE;
        for (let i = 0; i <= FILTER.PAETH; i++) {
          costs[i] = this.filterPredictor(filtered[i]);
          if (costs[i] < costs[filter]) {
            filter = i;
          }
        }
        filteredPointer = filtered[filter];
      }
      this.deflator.write(Buffer.from([filter]));
      this.deflator.write(filteredPointer);
      this.deflator.flush(() => {});
      this.ypos += 1;
    } else {
      this.deflator.end();
    }
  }

  writeHeader() {
    const PNGHeader = Buffer.from(signature);
    const IHDRData = Buffer.from([
      (this.width >> 24) & 0xff,
      (this.width >> 16) & 0xff,
      (this.width >> 8) & 0xff,
      (this.width >> 0) & 0xff,
      (this.height >> 24) & 0xff,
      (this.height >> 16) & 0xff,
      (this.height >> 8) & 0xff,
      (this.height >> 0) & 0xff,
      this.bitdepth,
      this.colourType,
      this.compressType,
      this.filterType,
      this.interlaceType
    ]);
    this.push(PNGHeader);
    this.writeChunk('IHDR', IHDRData);
  }

  writeChunk(chunkType, data) {
    // console.log(`${chunkType} : ${data.length} bytes`);
    const chunkLength = Buffer.from([
      (data.length >> 24) & 0xff,
      (data.length >> 16) & 0xff,
      (data.length >> 8) & 0xff,
      (data.length >> 0) & 0xff
    ]);
    const CRC = crc32(chunkType, data);
    const CRCPacked = Buffer.from([
      (CRC >> 24) & 0xff,
      (CRC >> 16) & 0xff,
      (CRC >> 8) & 0xff,
      (CRC >> 0) & 0xff
    ]);
    this.push(chunkLength);
    this.push(chunkType);
    this.push(data);
    this.push(CRCPacked);
  }

}

module.exports = MinimalPng;
