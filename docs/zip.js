/**
 * ============================================================================
 * zip.js — Zero-Dependency In-Memory .love (ZIP STORE) Archive Builder
 * ============================================================================
 *
 * WHY THIS EXISTS:
 * LÖVE2D packages (.love files) are standard PKZIP archives with `main.lua`
 * placed at the root of the archive. Instead of pulling in external libraries
 * like JSZip, this module constructs a spec-compliant uncompressed (STORE)
 * ZIP binary directly inside a contiguous JavaScript ArrayBuffer.
 *
 * LÖVE's underlying PhysFS filesystem reads STORE-mode ZIP archives natively.
 */

(function (global) {
  'use strict';

  // Precompute the standard IEEE 802.3 CRC-32 lookup table (polynomial 0xEDB88320)
  const CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[i] = c;
  }

  /**
   * Computes an unsigned 32-bit CRC checksum required by ZIP file headers.
   * @param {Uint8Array} bytes
   * @returns {number}
   */
  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
  }

  /**
   * Packs a dictionary of filenames and contents into a .love ZIP ArrayBuffer.
   *
   * @param {Record<string, string | Uint8Array | ArrayBuffer>} files
   *        Example: { 'main.lua': 'function love.draw() ... end' }
   * @returns {ArrayBuffer} Transferable binary buffer ready for postMessage
   */
  function createLoveZip(files) {
    const encoder = new TextEncoder();
    const localChunks = [];
    const centralDirectory = [];
    let offset = 0;

    // 1. Build Local File Header + Raw Data + Central Directory Entry per file
    for (const [filename, content] of Object.entries(files)) {
      const nameBytes = encoder.encode(filename);
      const dataBytes = typeof content === 'string'
        ? encoder.encode(content)
        : new Uint8Array(content);
      const checksum = crc32(dataBytes);

      // Local File Header (30 bytes fixed + filename length)
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);        // Local file header signature ('PK\x03\x04')
      lv.setUint16(4, 20, true);                // Minimum PKZIP version needed (2.0)
      lv.setUint16(6, 0, true);                 // General purpose bit flag
      lv.setUint16(8, 0, true);                 // Compression method: 0 = STORE (uncompressed)
      lv.setUint32(14, checksum, true);         // CRC-32 checksum
      lv.setUint32(18, dataBytes.length, true); // Compressed size
      lv.setUint32(22, dataBytes.length, true); // Uncompressed size
      lv.setUint16(26, nameBytes.length, true); // Filename byte length
      localHeader.set(nameBytes, 30);

      // Central Directory File Header (46 bytes fixed + filename length)
      const cdHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cdHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);        // Central directory signature ('PK\x01\x02')
      cv.setUint16(4, 20, true);                // Version made by
      cv.setUint16(6, 20, true);                // Version needed to extract
      cv.setUint16(10, 0, true);                // Compression method: 0 = STORE
      cv.setUint32(16, checksum, true);         // CRC-32 checksum
      cv.setUint32(20, dataBytes.length, true); // Compressed size
      cv.setUint32(24, dataBytes.length, true); // Uncompressed size
      cv.setUint16(28, nameBytes.length, true); // Filename byte length
      cv.setUint32(42, offset, true);           // Byte offset where Local File Header starts
      cdHeader.set(nameBytes, 46);

      localChunks.push(localHeader, dataBytes);
      centralDirectory.push(cdHeader);
      offset += localHeader.length + dataBytes.length;
    }

    // 2. Build End of Central Directory Record (EOCD - 22 bytes)
    const cdSize = centralDirectory.reduce((sum, entry) => sum + entry.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);                  // EOCD signature ('PK\x05\x06')
    ev.setUint16(8, centralDirectory.length, true);     // Number of entries on this disk
    ev.setUint16(10, centralDirectory.length, true);    // Total number of entries
    ev.setUint32(12, cdSize, true);                     // Total byte size of central directory
    ev.setUint32(16, offset, true);                     // Byte offset where central directory starts

    // 3. Concatenate all parts into one contiguous ArrayBuffer
    const output = new Uint8Array(offset + cdSize + 22);
    let cursor = 0;
    for (const part of [...localChunks, ...centralDirectory, eocd]) {
      output.set(part, cursor);
      cursor += part.length;
    }

    return output.buffer;
  }

  // Expose globally for app.js
  global.createLoveZip = createLoveZip;
})(window);
