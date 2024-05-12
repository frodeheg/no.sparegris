/* eslint-disable comma-dangle */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const { COLOURTYPE, FILTER, signature, crc32, paethPredictor } = require('./pngBasics');

class PngDecode {

  constructor(debug) {
    this.debug = debug;
    this.data = null;
  }

  reverseFilter(filtered) {
    const pixelPos = Math.floor(this.imageOffset / this.channels);
    const y = Math.floor(pixelPos / this.width);
    const x = pixelPos % this.width;
    const a = (x > 0) ? this.data[this.imageOffset - this.channels] : 0;
    const b = (y > 0) ? this.data[this.imageOffset - (this.width * this.channels)] : 0;
    const c = ((x > 0) && (y > 0)) ? this.data[this.imageOffset - (this.width * this.channels) - this.channels] : 0;
    switch (this.currentFilter) {
      default:
      case FILTER.NONE: return filtered;
      case FILTER.SUB: return filtered + a;
      case FILTER.UP: return filtered + b;
      case FILTER.AVERAGE: return filtered + Math.floor((a + b) / 2);
      case FILTER.PAETH: return filtered + paethPredictor(a, b, c);
    }
  }

  async load(filename) {
    let completionResolve;
    const completionPromise = new Promise((resolve, reject) => {
      completionResolve = resolve;
    });
    const fsp = fs.promises;
    this.inflator = zlib.createInflate();
    this.inflator.on('data', (data) => {
      for (let i = 0; i < data.length; i++) {
        const isFilter = (this.dataOffset % ((this.width * this.channels) + 1)) === 0;
        if (isFilter) {
          this.currentFilter = data[i];
        } else {
          // const channel = this.imageOffset % this.channels;
          this.data[this.imageOffset] = this.reverseFilter(data[i]);
          this.imageOffset++;
        }
        this.dataOffset += 1;
      }
    });
    this.inflator.on('end', () => {
      completionResolve();
    });
    return fsp.readFile(filename)
      .then((fileBuffer) => this.readSignature({ buffer: fileBuffer, offset: 0 }))
      .then((readHandle) => this.readHeader(readHandle))
      .then((readHandle) => {
        this.arrayData = new ArrayBuffer(this.height * this.width * this.channels);
        this.data = new Uint8Array(this.arrayData);
        this.imageOffset = 0;
        this.dataOffset = 0;
        return Promise.resolve(readHandle);
      })
      .then((readHandle) => this.readBlocks(readHandle))
      .then(() => completionPromise);
  }

  async readSignature({ buffer, offset }) {
    for (let i = 0; i < signature.length; i++) {
      if (buffer[i] !== signature[i]) return Promise.reject(new Error(`Invalid PNG signature (${i}): ${buffer[i]} != ${signature[i]}`));
    }
    offset += signature.length;
    return Promise.resolve({ buffer, offset });
  }

  read32bit(buffer, offset) {
    return buffer[offset + 3]
      + (buffer[offset + 2] << 8)
      + (buffer[offset + 1] << 16)
      + (buffer[offset + 0] << 24);
  }

  checkCrc(buffer, offset, type, length) {
    if (this.debug) {
      const data = buffer.subarray(offset + 8, offset + 8 + length);
      const readCRC = this.read32bit(buffer, offset + 8 + length);
      const genCRC = crc32(type, data);
      if (readCRC !== genCRC) return Promise.reject(new Error(`Invalid CRC code in ${type} block at offset ${offset} ${readCRC} != ${genCRC}`));
    }
    return Promise.resolve();
  }

  async readChunk({ buffer, offset }) {
    const length = this.read32bit(buffer, offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString();
    // console.log(`${offset} : ${type} : ${length} + 12`);
    return this.checkCrc(buffer, offset, type, length)
      .then(() => Promise.resolve({ type, length, offset: (offset + 8) }));
  }

  async readHeader({ buffer, offset }) {
    return this.readChunk({ buffer, offset })
      .then((chunk) => {
        if (chunk.type !== 'IHDR') return Promise.reject(new Error(`Expected IHDR chunk, found ${chunk.type}`));
        this.width = this.read32bit(buffer, chunk.offset);
        this.height = this.read32bit(buffer, chunk.offset + 4);
        this.bitdepth = buffer[chunk.offset + 8];
        this.colourType = buffer[chunk.offset + 9];
        this.compressType = buffer[chunk.offset + 10];
        this.filterType = buffer[chunk.offset + 11];
        this.interlaceType = buffer[chunk.offset + 12];
        switch (this.colourType) {
          case COLOURTYPE.LUMINANCE: this.channels = 1; break;
          case COLOURTYPE.LUMINANCE_A: this.channels = 2; break;
          case COLOURTYPE.RGB: this.channels = 3; break;
          case COLOURTYPE.RGBA: this.channels = 4; break;
          default: this.channels = 1; break; // COLOURTYPE.INDEXED
        }
        /* console.log(`Size:        ${this.width} x ${this.height}`);
        console.log(`Bits:        ${this.bitdepth}`);
        console.log(`Colour type: ${this.colourType}`);
        console.log(`Compression: ${this.compressType}`);
        console.log(`Filter:      ${this.filterType}`);
        console.log(`Interlace:   ${this.interlaceType}`); */
        if (this.bitdepth !== 8) return Promise.reject(new Error(`Bit Depth ${this.bitdepth} not supported yet`));
        // if (this.colourType !== COLOURTYPE.RGBA) return Promise.reject(new Error(`Color type ${this.colourType} not supported yet`));
        if (this.compressType !== 0) return Promise.reject(new Error(`Compression type ${this.compressType} not supported`));
        if (this.filterType !== 0) return Promise.reject(new Error(`Filter type ${this.filterType} not supported`));
        if (this.interlaceType !== 0) return Promise.reject(new Error(`Interlace type ${this.interlaceType} not supported`));
        offset = chunk.offset + chunk.length + 4;
        return Promise.resolve({ buffer, offset });
      });
  }

  async readBlocks({ buffer, offset }) {
    if (buffer.length <= offset) return Promise.resolve({ buffer, offset });
    return this.readChunk({ buffer, offset })
      .then((chunk) => {
        switch (chunk.type) {
          case 'IDAT':
            this.inflator.write(buffer.subarray(chunk.offset, chunk.offset + chunk.length));
            break;
          case 'IEND': // End of stream
            this.inflator.end();
            return Promise.resolve({ buffer, offset: buffer.length });
          case 'zTXt': // Text block, ignore
          case 'iTXt': // International text, ignore
          case 'iCCP': // Colour space profile, ignore
          case 'bKGD': // Background colour, ignore
          case 'pHYs': // Physical pixel dimensions, ignore
          case 'tIME': // Image last-modification time, ignore
            break;
          default:
            console.log(`  --> Unknown chunk type ${chunk.type} at offset ${offset}`);
            break;
        }
        offset = chunk.offset + chunk.length + 4;
        return this.readBlocks({ buffer, offset });
      });
  }

}

module.exports = PngDecode;
