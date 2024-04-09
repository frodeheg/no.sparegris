/* eslint-disable comma-dangle */

'use strict';

var zlib = require('zlib');
const { Readable } = require('stream');

const COLOURTYPE = {
  LUMINANCE: 0,
  RGB: 2,
  INDEXED: 3,
  LUMINANCE_A: 4,
  RGBA: 6
};

const FILTER = {
  NONE: 0,
  SUB: 1,
  UP: 2,
  AVERAGE: 3,
  PAETH: 4
};

/**
 * Encodes a frame to PNG
 * PNG spec is located at https://www.w3.org/TR/png/
 * APNG is easiest explained here: https://en.wikipedia.org/wiki/APNG
 */
class MinimalPng extends Readable {

  constructor(opts) {
    super(opts);
    this.crcTable = this.makeCRCTable();
    this.width = opts.width;
    this.height = opts.height;
    this.channels = opts.channels || COLOURTYPE.RGBA;
    this.data = opts.imageData;
    this.ypos = null;

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

  _read() {
    if (this.ypos === null) {
      this.writeHeader();
      this.ypos = 0;
    } else if (this.ypos < this.height) {
      const start = this.width * this.ypos * this.channels;
      const end = start + this.width * this.channels;
      const linePointer = this.data.subarray(start, end); // Points to original data
      this.deflator.write(Buffer.from([FILTER.NONE]));
      this.deflator.write(linePointer);
      this.deflator.flush(() => {});
      this.ypos += 1;
    } else {
      this.deflator.end();
    }
  }

  writeHeader() {
    const PNGHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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
    const CRC = this.crc32(chunkType, data);
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

  makeCRCTable() {
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c;
    }
    return crcTable;
  }

  /**
   * Returns the crc32 - assumes that data is an array of uint8
   */
  crc32(chunktype, data) {
    let crc = 0 ^ (-1); // Initialize CRC with all bits set to 1
    for (let i = 0; i < 4; i++) {
      crc = (crc >>> 8) ^ this.crcTable[(crc ^ chunktype.charCodeAt(i)) & 0xFF];
    }
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ this.crcTable[(crc ^ data[i]) & 0xFF];
    }

    // Convert to an unsigned 32-bit integer
    return crc ^ (-1);
  }

}

module.exports = MinimalPng;
