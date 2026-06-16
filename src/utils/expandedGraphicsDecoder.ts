/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDefaultSTPalette } from './graphicsDecoder';

// -------------------------------------------------------------
// SPECTRUM 512 (.SPC) UNCOMPRESSED DECODER
// -------------------------------------------------------------
export function decodeSpectrumSPC(bytes: Uint8Array): Uint8ClampedArray {
  const width = 320;
  const height = 200;
  const rgba = new Uint8ClampedArray(width * height * 4);

  // An uncompressed SPC file contains:
  // - 32000 bytes of planar screen memory (Atari ST Low Res format)
  // - 19200 bytes of palette data (200 lines * 3 palettes * 16 colors * 2 bytes = 19200 bytes)
  const vram = bytes.subarray(0, 32000);
  const palettesOffset = 32000;

  let srcOffset = 0;

  for (let y = 0; y < height; y++) {
    const lineOffset = y * width;
    
    // Parse three 16-color palettes for this specific scanline (96 bytes per line)
    const linePalOffset = palettesOffset + (y * 96);
    
    const palette0 = parse16ColorPalette(bytes, linePalOffset);
    const palette1 = parse16ColorPalette(bytes, linePalOffset + 32);
    const palette2 = parse16ColorPalette(bytes, linePalOffset + 64);

    for (let xChunk = 0; xChunk < width; xChunk += 16) {
      if (srcOffset + 7 >= vram.length) break;
      const w0 = (vram[srcOffset]     << 8) | vram[srcOffset + 1];
      const w1 = (vram[srcOffset + 2] << 8) | vram[srcOffset + 3];
      const w2 = (vram[srcOffset + 4] << 8) | vram[srcOffset + 5];
      const w3 = (vram[srcOffset + 6] << 8) | vram[srcOffset + 7];
      srcOffset += 8;

      for (let bit = 0; bit < 16; bit++) {
        const pixelX = xChunk + bit;
        if (pixelX >= width) continue;

        const shift = 15 - bit;
        const b0 = (w0 >> shift) & 1;
        const b1 = (w1 >> shift) & 1;
        const b2 = (w2 >> shift) & 1;
        const b3 = (w3 >> shift) & 1;
        const colorIndex = b0 | (b1 << 1) | (b2 << 2) | (b3 << 3);

        // Spectrum 512 changes palettes across the scanline:
        // - palette0 for pixels 0-105
        // - palette1 for pixels 106-211
        // - palette2 for pixels 212-319
        let rgb = palette0[colorIndex];
        if (pixelX >= 106 && pixelX < 212) {
          rgb = palette1[colorIndex];
        } else if (pixelX >= 212) {
          rgb = palette2[colorIndex];
        }

        const destIdx = (lineOffset + pixelX) * 4;
        rgba[destIdx]     = rgb[0];
        rgba[destIdx + 1] = rgb[1];
        rgba[destIdx + 2] = rgb[2];
        rgba[destIdx + 3] = 255;
      }
    }
  }

  return rgba;
}

function parse16ColorPalette(bytes: Uint8Array, offset: number): number[][] {
  const list: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const idx = offset + (i * 2);
    if (idx + 1 >= bytes.length) {
      list.push([0, 0, 0]);
      continue;
    }
    const word = (bytes[idx] << 8) | bytes[idx + 1];
    // Decode Atari 16-bit color format (9 bits: 3R, 3G, 3B)
    const b = (word & 0x007);
    const g = ((word & 0x070) >> 4);
    const r = ((word & 0x700) >> 8);
    // Upscale to standard 8-bit color space
    list.push([r << 5, g << 5, b << 5]);
  }
  return list;
}


// -------------------------------------------------------------
// NEOCHROME ANIMATION (.ANM) STRIP DECODER
// -------------------------------------------------------------
export interface NeoAnimFrame {
  index: number;
  pixels: Uint8Array; // 32000 bytes planar VRAM
  palette: number[][]; // 16 colors (r,g,b)
}

export function parseNeoAnimStrips(bytes: Uint8Array): NeoAnimFrame[] {
  const frames: NeoAnimFrame[] = [];
  const defaultPalette = getDefaultSTPalette();

  // If the file is divided into standard 32000-byte raw ST VRAM frames:
  if (bytes.length >= 32000 && bytes.length % 32000 === 0) {
    const frameCount = bytes.length / 32000;
    for (let f = 0; f < frameCount; f++) {
      const start = f * 32000;
      frames.push({
        index: f,
        pixels: bytes.slice(start, start + 32000),
        palette: defaultPalette
      });
    }
    return frames;
  }

  // If each frame is 32128 bytes (32000 VRAM + 128-byte neochrome header at head of each)
  // Neochrome `.NEO` files have a 128-byte header where palette starts at offset 4
  if (bytes.length >= 32128 && bytes.length % 32128 === 0) {
    const frameCount = bytes.length / 32128;
    for (let f = 0; f < frameCount; f++) {
      const base = f * 32128;
      const palette = parse16ColorPalette(bytes, base + 4);
      const pixels = bytes.slice(base + 128, base + 128 + 32000);
      frames.push({
        index: f,
        pixels,
        palette
      });
    }
    return frames;
  }

  // Fallback: try slicing by 32000-byte segments dynamically
  const totalRawFrames = Math.floor(bytes.length / 32000);
  if (totalRawFrames > 0) {
    for (let f = 0; f < totalRawFrames; f++) {
      const start = f * 32000;
      frames.push({
        index: f,
        pixels: bytes.slice(start, start + 32000),
        palette: defaultPalette
      });
    }
  }

  return frames;
}


// -------------------------------------------------------------
// GEM Monochrome Image (.IMG) DECODER
// -------------------------------------------------------------
export interface GemImgData {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export function decodeGemImg(bytes: Uint8Array): GemImgData | null {
  if (bytes.length < 16) return null;

  // Read primary GEM header elements (big endian words)
  const version = (bytes[0] << 8) | bytes[1];
  const headerLengthWords = (bytes[2] << 8) | bytes[3];
  const numPlanes = (bytes[4] << 8) | bytes[5];
  const patternLength = (bytes[6] << 8) | bytes[7];
  
  const width = (bytes[12] << 8) | bytes[13];
  const height = (bytes[14] << 8) | bytes[15];

  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    return null;
  }

  const headerBSize = headerLengthWords * 2;
  if (bytes.length < headerBSize) return null;

  // Target monochrome canvas: 1 bit per pixel
  const rowBytes = Math.ceil(width / 8);
  const decompressed = new Uint8Array(height * rowBytes);

  let src = headerBSize;
  let dst = 0;

  // Read loop to decompress GEM Packbits RLE
  while (dst < decompressed.length && src < bytes.length) {
    const head = bytes[src++];
    
    if (head === 0x00) {
      // Pattern run: repeat some pattern byte(s)
      if (src >= bytes.length) break;
      const repeatCount = bytes[src++];
      
      const pattern = new Uint8Array(patternLength);
      for (let p = 0; p < patternLength; p++) {
        if (src < bytes.length) {
          pattern[p] = bytes[src++];
        } else {
          pattern[p] = 0;
        }
      }

      for (let r = 0; r < repeatCount; r++) {
        for (let p = 0; p < patternLength; p++) {
          if (dst < decompressed.length) {
            decompressed[dst++] = pattern[p];
          }
        }
      }
    } else if (head === 0x80) {
      // Uncompressed run: copy verbatim bytes
      if (src >= bytes.length) break;
      const copyCount = bytes[src++];
      for (let c = 0; c < copyCount; c++) {
        if (src < bytes.length && dst < decompressed.length) {
          decompressed[dst++] = bytes[src++];
        }
      }
    } else if ((head & 0x80) !== 0) {
      // Solid run of either 0x00 or 0xFF
      const runCount = head & 0x7F;
      // GEM specification: Bit 6 determines if it's black (1) or white (0)
      // Usually solid runs fill the remainder of the line in bytes
      const val = (head & 0x01) ? 0xFF : 0x00;
      
      for (let r = 0; r < runCount; r++) {
        if (dst < decompressed.length) {
          decompressed[dst++] = val;
        }
      }
    } else {
      // Vertical duplication of the preceding line
      const lineRepeat = head;
      if (lineRepeat > 0 && dst >= rowBytes) {
        const lastLineStart = dst - rowBytes;
        for (let r = 0; r < lineRepeat; r++) {
          for (let i = 0; i < rowBytes; i++) {
            if (dst < decompressed.length) {
              decompressed[dst++] = decompressed[lastLineStart + i];
            }
          }
        }
      }
    }
  }

  // Convert monochrome 1-bit buffer to standard 32-bit RGBA for the HTML canvas
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const lineOffset = y * width;
    const rawLineOffset = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const byteIdx = rawLineOffset + Math.floor(x / 8);
      const bitShift = 7 - (x % 8);
      const val = byteIdx < decompressed.length ? ((decompressed[byteIdx] >> bitShift) & 1) : 0;
      
      // High-contrast clean white and charcoal layout
      const color = val ? 0 : 255; // 1 = black, 0 = white
      const destIdx = (lineOffset + x) * 4;
      rgba[destIdx]     = color;
      rgba[destIdx + 1] = color;
      rgba[destIdx + 2] = color;
      rgba[destIdx + 3] = 255;
    }
  }

  return { width, height, rgba };
}


// -------------------------------------------------------------
// GEM FONT VIEWER (.FNT / .FNX) DETECTOR & PARSER
// -------------------------------------------------------------
export interface DecodedFont {
  name: string;
  points: number;
  cellW: number;
  cellH: number;
  firstChar: number;
  lastChar: number;
  glyphs: Uint8Array[]; // 256 decoded monochrome buffers of size (cellW * cellH)
}

export function parseAtariFont(bytes: Uint8Array, fileName: string): DecodedFont | null {
  const ext = fileName.split('.').pop()?.toUpperCase() || '';
  if (ext !== 'FNT' && ext !== 'FNX' && bytes.length !== 2048 && bytes.length !== 4096) {
    return null;
  }

  // Case A: Raw BIOS 8x8 font (2048 bytes)
  if (bytes.length === 2048) {
    const glyphs: Uint8Array[] = [];
    for (let c = 0; c < 256; c++) {
      const buf = new Uint8Array(8 * 8);
      const base = c * 8;
      for (let row = 0; row < 8; row++) {
        const val = bytes[base + row];
        for (let bit = 0; bit < 8; bit++) {
          buf[row * 8 + bit] = (val >> (7 - bit)) & 1;
        }
      }
      glyphs.push(buf);
    }
    return {
      name: 'Atari ST BIOS 8x8 Font',
      points: 8,
      cellW: 8,
      cellH: 8,
      firstChar: 0,
      lastChar: 255,
      glyphs
    };
  }

  // Case B: Raw BIOS 8x16 font (4096 bytes)
  if (bytes.length === 4096) {
    const glyphs: Uint8Array[] = [];
    for (let c = 0; c < 256; c++) {
      const buf = new Uint8Array(8 * 16);
      const base = c * 16;
      for (let row = 0; row < 16; row++) {
        const val = bytes[base + row];
        for (let bit = 0; bit < 8; bit++) {
          buf[row * 8 + bit] = (val >> (7 - bit)) & 1;
        }
      }
      glyphs.push(buf);
    }
    return {
      name: 'Atari ST BIOS 8x16 Font',
      points: 16,
      cellW: 8,
      cellH: 16,
      firstChar: 0,
      lastChar: 255,
      glyphs
    };
  }

  // Case C: Standard GEM .FNT / .FNX Font File (typically starts with header structure)
  if (bytes.length >= 88) {
    const fontId = (bytes[0] << 8) | bytes[1];
    const points = (bytes[2] << 8) | bytes[3];
    
    // Parse face name (32 bytes)
    const nameBytes: string[] = [];
    for (let i = 4; i < 36; i++) {
      if (bytes[i] === 0) break;
      nameBytes.push(String.fromCharCode(bytes[i]));
    }
    const name = nameBytes.join('').trim() || `GEM Font (ID #${fontId})`;

    const firstChar = (bytes[36] << 8) | bytes[37];
    const lastChar = (bytes[38] << 8) | bytes[39];

    const formWBytes = (bytes[42] << 8) | bytes[43]; // Width of font form in bytes
    const cellH = (bytes[44] << 8) | bytes[45]; // Height of font in pixels (e.g. 16)
    
    // Offset in bytes to the actual big monochrome font form bitmap
    const formOffset = (bytes[46] << 8 | bytes[47]) === 0 ? 88 : (bytes[46] << 8 | bytes[47]);

    if (cellH > 0 && cellH <= 64 && formWBytes > 0 && formWBytes <= 512 && formOffset < bytes.length) {
      // Decode characters based on horiz offset maps or assume a uniform cell size (often 8 pixels wide)
      const numChars = (lastChar - firstChar) + 1;
      const cellW = Math.floor((formWBytes * 8) / (numChars || 1)) || 8;
      
      const glyphs: Uint8Array[] = [];
      const formBytes = bytes.subarray(formOffset);

      // Slicing character columns from the giant monoplanar font sheet
      for (let c = 0; c < 256; c++) {
        const buf = new Uint8Array(8 * cellH); // assume standard 8-column fallback for drawing maps
        
        const fileCharIndex = c - firstChar;
        if (fileCharIndex >= 0 && fileCharIndex < numChars) {
          // Slice cell form
          for (let row = 0; row < cellH; row++) {
            const fontSheetRowOffset = row * formWBytes;
            // Character columns are indexed horizontally
            const bitOffset = fileCharIndex * cellW;
            const byteCol = Math.floor(bitOffset / 8);
            const bitSub = bitOffset % 8;

            if (byteCol < formWBytes) {
              const byteVal = formBytes[fontSheetRowOffset + byteCol];
              for (let b = 0; b < 8; b++) {
                const combinedBitIdx = bitSub + b;
                const byteToRef = formBytes[fontSheetRowOffset + byteCol + Math.floor(combinedBitIdx / 8)];
                const subShift = 7 - (combinedBitIdx % 8);
                buf[row * 8 + b] = (byteToRef >> subShift) & 1;
              }
            }
          }
        } else {
          // Glyphs not in font range -> draw default empty space box or dots
          if (c === 32) {
            // space
          } else {
            // Draw cross border outline
            for (let row = 0; row < cellH; row++) {
              for (let b = 0; b < 8; b++) {
                if (row === 0 || row === cellH - 1 || b === 0 || b === 7) {
                  buf[row * 8 + b] = 1;
                }
              }
            }
          }
        }
        glyphs.push(buf);
      }

      return {
        name,
        points,
        cellW: 8,
        cellH,
        firstChar,
        lastChar,
        glyphs
      };
    }
  }

  // Final fallback: try converting into standard BIOS structure anyway
  return null;
}
