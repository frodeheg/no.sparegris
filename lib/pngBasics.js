/* eslint-disable comma-dangle */

'use strict';

const COLOURTYPE = {
  LUMINANCE: 0,
  RGB: 2,
  INDEXED: 3,
  LUMINANCE_A: 4,
  RGBA: 6
};

/**
 * Input bytes to filters:
 * c b
 * a x
 * Filters:
 * TYPE NAME    FILTER/RECONSTRUCT FUNCTION
 * 0    None    Filt (x) = Orig(x)
 *              Recon(x) = Filt(x)
 * 1    Sub     Filt (x) = Orig(x) - Orig(a)
 *              Recon(x) = Filt(x) + Recon(a)
 * 2    Up      Filt (x) = Orig(x) - Orig(b)
 *              Recon(x) = Filt(x) + Recon(b)
 * 3    Average Filt (x) = Orig(x) - floor((Orig(a) + Orig(b)) / 2)
 *              Recon(x) = Filt(x) + floor((Recon(a) + Recon(b)) / 2)
 * 4    Paeth   Filt (x) = Orig(x) - PaethPredictor(Orig(a), Orig(b), Orig(c))
 *              Recon(x) = Filt(x) + PaethPredictor(Recon(a), Recon(b), Recon(c))
 */
const FILTER = {
  NONE: 0,
  SUB: 1,
  UP: 2,
  AVERAGE: 3,
  PAETH: 4
};

const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const crcTable = []; // filled by the makeCRCTable() function

/**
 * The PaethPredictor is used by the paeth filter
 */
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  let Pr;
  if (pa <= pb && pa <= pc) Pr = a;
  else if (pb <= pc) Pr = b;
  else Pr = c;
  return Pr;
}

/**
 * Returns the crc32 - assumes that data is an array of uint8
 */
function crc32(chunktype, data) {
  let crc = 0 ^ (-1); // Initialize CRC with all bits set to 1
  for (let i = 0; i < 4; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ chunktype.charCodeAt(i)) & 0xFF];
  }
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF];
  }

  // Convert to an unsigned 32-bit integer
  return crc ^ (-1);
}

/**
 * Generates the CRC table (called internally only)
 */
function makeCRCTable() {
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }
  return crcTable;
}

// Initialization
makeCRCTable();

module.exports = {
  COLOURTYPE,
  FILTER,
  signature,
  paethPredictor,
  crc32
};
