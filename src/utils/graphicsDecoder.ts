/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { detectPackerSignature, findAsciiSignature, decompressPackIce, decompressRNC, decompressRLE, decompressLZ77Backward, decompressAtomik, decompressAutomation, decompressJam, decompressJek } from './diskUtils';
import { decodeSpectrumSPC, parseNeoAnimStrips, decodeGemImg } from './expandedGraphicsDecoder';

export const stPixelFont: Record<string, number[]> = {
  ' ': [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00],
  'A': [0x18,0x24,0x42,0x42,0x7E,0x42,0x42,0x42],
  'B': [0x7C,0x42,0x42,0x7C,0x42,0x42,0x42,0x7C],
  'C': [0x3C,0x42,0x40,0x40,0x40,0x40,0x42,0x3C],
  'D': [0x78,0x44,0x42,0x42,0x42,0x42,0x44,0x78],
  'E': [0x7E,0x40,0x40,0x78,0x40,0x40,0x40,0x7E],
  'F': [0x7E,0x40,0x40,0x78,0x40,0x40,0x40,0x40],
  'G': [0x3C,0x42,0x40,0x4E,0x42,0x42,0x42,0x3E],
  'H': [0x42,0x42,0x42,0x7E,0x42,0x42,0x42,0x42],
  'I': [0x3E,0x08,0x08,0x08,0x08,0x08,0x08,0x3E],
  'J': [0x1F,0x04,0x04,0x04,0x04,0x44,0x44,0x38],
  'K': [0x42,0x44,0x48,0x70,0x48,0x44,0x42,0x42],
  'L': [0x40,0x40,0x40,0x40,0x40,0x40,0x40,0x7E],
  'M': [0x42,0x66,0x5A,0x42,0x42,0x42,0x42,0x42],
  'N': [0x42,0x62,0x52,0x4A,0x46,0x42,0x42,0x42],
  'O': [0x3C,0x42,0x42,0x42,0x42,0x42,0x42,0x3C],
  'P': [0x7C,0x42,0x42,0x7C,0x40,0x40,0x40,0x40],
  'Q': [0x3C,0x42,0x42,0x42,0x42,0x4A,0x44,0x3A],
  'R': [0x7C,0x42,0x42,0x7C,0x48,0x44,0x42,0x42],
  'S': [0x3E,0x40,0x40,0x3C,0x02,0x02,0x42,0x3C],
  'T': [0x7E,0x08,0x08,0x08,0x08,0x08,0x08,0x08],
  'U': [0x42,0x42,0x42,0x42,0x42,0x42,0x42,0x3C],
  'V': [0x42,0x42,0x42,0x42,0x42,0x24,0x24,0x18],
  'W': [0x42,0x42,0x42,0x42,0x4A,0x5A,0x66,0x42],
  'X': [0x42,0x24,0x14,0x08,0x14,0x24,0x42,0x42],
  'Y': [0x42,0x42,0x24,0x18,0x08,0x08,0x08,0x08],
  'Z': [0x7E,0x02,0x04,0x08,0x10,0x20,0x40,0x7E],
  '0': [0x3C,0x46,0x4A,0x52,0x62,0x42,0x42,0x3C],
  '1': [0x18,0x28,0x08,0x08,0x08,0x08,0x08,0x3E],
  '2': [0x3C,0x42,0x02,0x0C,0x30,0x40,0x42,0x7E],
  '3': [0x3C,0x42,0x02,0x1C,0x02,0x02,0x42,0x3C],
  '4': [0x08,0x18,0x28,0x48,0x7E,0x08,0x08,0x08],
  '5': [0x7E,0x40,0x7C,0x02,0x02,0x02,0x42,0x3C],
  '6': [0x3C,0x40,0x40,0x7C,0x42,0x42,0x42,0x3C],
  '7': [0x7E,0x02,0x04,0x08,0x10,0x20,0x20,0x20],
  '8': [0x3C,0x42,0x42,0x3C,0x42,0x42,0x42,0x3C],
  '9': [0x3C,0x42,0x42,0x3E,0x02,0x02,0x42,0x3C],
  '-': [0x00,0x00,0x00,0x3F,0x00,0x00,0x00,0x00],
  '.': [0x00,0x00,0x00,0x00,0x00,0x0C,0x0C,0x00],
  '!': [0x08,0x08,0x08,0x08,0x08,0x00,0x08,0x00],
  '#': [0x24,0x24,0x7E,0x24,0x7E,0x24,0x24,0x00],
  '@': [0x3C,0x42,0x5E,0x52,0x52,0x4E,0x40,0x3E],
  '&': [0x1C,0x22,0x22,0x14,0x2A,0x24,0x24,0x1B]
};

export function getDefaultSTPalette(): number[][] {
  return [
    [0, 0, 0], [255, 0, 0], [0, 255, 0], [255, 255, 0],
    [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
    [112, 112, 112], [176, 80, 80], [80, 176, 80], [176, 176, 80],
    [80, 80, 176], [176, 80, 176], [80, 176, 176], [224, 224, 224]
  ];
}

export function parseSTPaletteAt(bytes: Uint8Array, screenOffset: number): number[][] | null {
  if (screenOffset < 32) return null;
  const palOffset = screenOffset - 32;
  const palette: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const idx = palOffset + (i * 2);
    if (idx + 1 >= bytes.length) return null;
    const word = (bytes[idx] << 8) | bytes[idx + 1];
    const b = (word & 0x007);
    const g = ((word & 0x070) >> 4);
    const r = ((word & 0x700) >> 8);
    palette.push([r << 5, g << 5, b << 5]);
  }
  return palette;
}

export function decodePlanarVRAM(vram: Uint8Array, palette: number[][], colors: number = 16, width: number = 320, height: number = 200): Uint8ClampedArray {
  const outputBuffer = new Uint8ClampedArray(width * height * 4);
  let srcOffset = 0;

  for (let y = 0; y < height; y++) {
    const lineOffset = y * width;
    for (let xChunk = 0; xChunk < width; xChunk += 16) {
      if (colors === 16) {
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
          const rgb = palette[colorIndex] || [0, 0, 0];

          const destIdx = (lineOffset + pixelX) * 4;
          outputBuffer[destIdx]     = rgb[0];
          outputBuffer[destIdx + 1] = rgb[1];
          outputBuffer[destIdx + 2] = rgb[2];
          outputBuffer[destIdx + 3] = 255;
        }
      } else if (colors === 4) {
        if (srcOffset + 3 >= vram.length) break;
        const w0 = (vram[srcOffset]     << 8) | vram[srcOffset + 1];
        const w1 = (vram[srcOffset + 2] << 8) | vram[srcOffset + 3];
        srcOffset += 4;

        for (let bit = 0; bit < 16; bit++) {
          const pixelX = xChunk + bit;
          if (pixelX >= width) continue;

          const shift = 15 - bit;
          const b0 = (w0 >> shift) & 1;
          const b1 = (w1 >> shift) & 1;
          const colorIndex = b0 | (b1 << 1);
          const rgb = palette[colorIndex] || [0, 0, 0];

          const destIdx = (lineOffset + pixelX) * 4;
          outputBuffer[destIdx]     = rgb[0];
          outputBuffer[destIdx + 1] = rgb[1];
          outputBuffer[destIdx + 2] = rgb[2];
          outputBuffer[destIdx + 3] = 255;
        }
      } else if (colors === 2) {
        if (srcOffset + 1 >= vram.length) break;
        const w0 = (vram[srcOffset]     << 8) | vram[srcOffset + 1];
        srcOffset += 2;

        for (let bit = 0; bit < 16; bit++) {
          const pixelX = xChunk + bit;
          if (pixelX >= width) continue;

          const shift = 15 - bit;
          const colorIndex = (w0 >> shift) & 1;
          const val = colorIndex ? 0 : 255; // High contrast visual mode

          const destIdx = (lineOffset + pixelX) * 4;
          outputBuffer[destIdx]     = val;
          outputBuffer[destIdx + 1] = val;
          outputBuffer[destIdx + 2] = val;
          outputBuffer[destIdx + 3] = 255;
        }
      }
    }
  }
  return outputBuffer;
}

export function decompressDegasPC(compressedData: Uint8Array, resolution: number): Uint8Array {
  let height = 200;
  let numPlanes = 4;
  let planeSize = 40;

  if (resolution === 0) {
    height = 200;
    numPlanes = 4;
    planeSize = 40;
  } else if (resolution === 1) {
    height = 200;
    numPlanes = 2;
    planeSize = 80;
  } else if (resolution === 2) {
    height = 400;
    numPlanes = 1;
    planeSize = 80;
  }

  const planarBuffer = new Uint8Array(height * numPlanes * planeSize);
  let src = 0;

  for (let y = 0; y < height; y++) {
    for (let p = 0; p < numPlanes; p++) {
      let planeCount = 0;
      let planeDst = y * (numPlanes * planeSize) + (p * planeSize);
      
      while (planeCount < planeSize && src < compressedData.length) {
        const head = compressedData[src++];
        if (head === undefined) break;
        const sHead = head > 127 ? head - 256 : head;
        
        if (sHead >= 0 && sHead <= 127) {
          const count = sHead + 1;
          for (let i = 0; i < count; i++) {
            if (planeCount >= planeSize || src >= compressedData.length) break;
            planarBuffer[planeDst + planeCount] = compressedData[src++];
            planeCount++;
          }
        } else if (sHead >= -127 && sHead <= -1) {
          const count = -sHead + 1;
          if (src >= compressedData.length) break;
          const val = compressedData[src++];
          for (let i = 0; i < count; i++) {
            if (planeCount >= planeSize) break;
            planarBuffer[planeDst + planeCount] = val;
            planeCount++;
          }
        }
      }
    }
  }

  // Interleave the sequential planar buffer into standard ST interleaved VRAM layout
  const interleaved = new Uint8Array(planarBuffer.length);
  const wordsPerPlane = planeSize / 2;

  for (let y = 0; y < height; y++) {
    const rowOffsetPlanar = y * numPlanes * planeSize;
    const rowOffsetInterleaved = y * numPlanes * planeSize;

    for (let i = 0; i < wordsPerPlane; i++) {
      for (let p = 0; p < numPlanes; p++) {
        const srcIdx = rowOffsetPlanar + (p * planeSize) + (i * 2);
        const dstIdx = rowOffsetInterleaved + (i * numPlanes * 2) + (p * 2);

        if (srcIdx + 1 < planarBuffer.length && dstIdx + 1 < interleaved.length) {
          interleaved[dstIdx] = planarBuffer[srcIdx];
          interleaved[dstIdx + 1] = planarBuffer[srcIdx + 1];
        }
      }
    }
  }

  return interleaved;
}

const depackCycleCache = new WeakMap<Uint8Array, { data: Uint8Array; method: string; vramOffset: number } | null>();

export function runActiveDepackCycle(bytes: Uint8Array, fileName?: string): { data: Uint8Array; method: string; vramOffset: number } | null {
  if (!bytes || bytes.length === 0) return null;
  const cached = depackCycleCache.get(bytes);
  if (cached !== undefined) return cached;
  const result = runActiveDepackCycleInternal(bytes, fileName);
  depackCycleCache.set(bytes, result);
  return result;
}

function runActiveDepackCycleInternal(bytes: Uint8Array, fileName?: string): { data: Uint8Array; method: string; vramOffset: number } | null {
  const packerSignature = detectPackerSignature(bytes);

  // If no packer signature was detected, we DO NOT run the automatic depacking trial process
  // to avoid false positives and heavy browser CPU/UI hangs on raw files.
  if (packerSignature === "None") {
    if (bytes.length === 32000) {
      return { data: bytes, method: "Raw Planar VRAM", vramOffset: 0 };
    }
    return null;
  }

  const asciiString = Array.from(bytes.subarray(0, Math.min(bytes.length, 4096)))
    .map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : " ")
    .join("");

  // The Medway Boys, Pompey Pirates, or compatible JPM Packers backward LZ77 restoration
  if (asciiString.includes("THE MEDWAY BOYS") || 
      asciiString.includes("POMPEY") ||
      packerSignature === "The Medway Boys Packer" || 
      packerSignature === "Pompey Pirates Packer" ||
      packerSignature === "JPM Thunder Packer / ATOMIC") {
    const method_label = packerSignature !== "None" ? packerSignature : "Medway/Pompey LZ77";
    for (const size of [32034, 32000, 32128]) {
      try {
        const lz = decompressLZ77Backward(bytes, size);
        if (lz && lz.length >= 32000) {
          return { data: lz, method: method_label, vramOffset: resolveVRAMOffset(lz) };
        }
      } catch (e) { /* ignore and continue */ }
    }
  }

  // Try Pack-Ice decompression (including signature-stripped variants)
  const ice = decompressPackIce(bytes);
  if (ice) {
    const method = packerSignature !== "None" && packerSignature.includes("Pack-Ice") ? packerSignature : "Pack-Ice";
    return { data: ice, method, vramOffset: resolveVRAMOffset(ice) };
  }

  // Try JAM decompression
  const jam = decompressJam(bytes);
  if (jam) {
    const method = packerSignature !== "None" && (packerSignature.includes("JAM") || packerSignature.includes("LSD") || packerSignature.includes("LZH") || packerSignature.includes("LZW")) ? packerSignature : "JAM Pack";
    return { data: jam, method, vramOffset: resolveVRAMOffset(jam) };
  }

  if (asciiString.includes("ATOM") || asciiString.includes("ATM5") || asciiString.includes("ATM3") || packerSignature.includes("Atomik")) {
    const atm = decompressAtomik(bytes);
    if (atm) return { data: atm, method: "Atomik Cruncher", vramOffset: resolveVRAMOffset(atm) };
  }

  // Try Automation 2.3 depacking
  const aut = decompressAutomation(bytes);
  if (aut) {
    const method = packerSignature.includes("Automation") || packerSignature.includes("COMPACTER") ? packerSignature : "Automation 2.3";
    return { data: aut, method, vramOffset: resolveVRAMOffset(aut) };
  }

  const rnc = decompressRNC(bytes);
  if (rnc) return { data: rnc, method: "RNC", vramOffset: resolveVRAMOffset(rnc) };

  // Try JEK / Byte Killer depacking
  const jek = decompressJek(bytes);
  if (jek) {
    const method = packerSignature !== "None" && (packerSignature.includes("JEK") || packerSignature.includes("Byte Killer")) ? packerSignature : "JEK / Byte Killer";
    return { data: jek, method, vramOffset: resolveVRAMOffset(jek) };
  }

  // Only attempt general RLE decompression if the file has an RLE extension.
  // Standard binaries (like .prg files) can technically map successfully to any 
  // RLE block count (leading to false positives), so we restrict it to .RLE files.
  const isRleFile = fileName ? fileName.toLowerCase().endsWith('.rle') : false;
  if (isRleFile) {
    try {
      const rle = decompressRLE(bytes);
      if (rle.length >= 32000) return { data: rle, method: "RLE", vramOffset: resolveVRAMOffset(rle) };
    } catch (e) { /* ignore and continue */ }
  }

  if (bytes.length === 32000) {
    return { data: bytes, method: "Raw Planar VRAM", vramOffset: 0 };
  }

  return null;
}

export function resolveVRAMOffset(workBytes: Uint8Array): number {
  if (workBytes.length === 32000) return 0;
  if (workBytes.length >= 32034) return 34;
  if (workBytes.length >= 32128) return 128;
  return 0;
}

export interface TinyDecodedImage {
  detail: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Decompress Atari ST "Tiny Stuff" (TN1, TN2, TN3, TNY) pictures.
 * Based on Ax of Delight's m68k assembly unpacker logic.
 */
export function decompressTiny(bytes: Uint8Array): { resolution: number; palette: number[][]; vram: Uint8Array } | null {
  if (bytes.length < 37) return null;

  let res = bytes[0];
  let offset = 1;
  if (res > 2) {
    offset += 4; // Skip extra 4 bytes header if resolution marker > 2
  }
  if (offset + 32 + 4 > bytes.length) return null;

  // Read 16 palette entries (32 bytes)
  const palette: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const idx = offset + (i * 2);
    const word = (bytes[idx] << 8) | bytes[idx + 1];
    const b = (word & 0x007);
    const g = ((word & 0x070) >> 4);
    const r = ((word & 0x700) >> 8);
    palette.push([r << 5, g << 5, b << 5]);
  }
  offset += 32;

  // Read 16-bit control stream size
  const ctrlStreamSize = (bytes[offset] << 8) | bytes[offset + 1];
  offset += 2;

  // Skip 2 padding bytes (addq.l #2, a0)
  offset += 2;

  if (offset + ctrlStreamSize > bytes.length) return null;

  // Control stream starts here
  let a5 = offset;
  const a5_end = offset + ctrlStreamSize;
  let a4 = a5_end; // Uncompressed word stream begins after control bytes

  const vram = new Uint8Array(32000);
  let a1 = 0; // Destination pointer (offsets into 32000 bytes vram)
  const d6 = 32000;
  const d4 = 160;

  // Incremental coordinate calculation replicating vertical column-planar skips
  function advance() {
    a1 += 2;
    a1 += 158; // lea $9e(a1), a1 => +158 (making total row skip a1+160)
    if (a1 >= d6) {
      a1 += -31992; // lea $ffff8308(a1), a1 => subtract 32000, add 8 (column step)
      if (a1 >= d4) {
        a1 += -158; // lea $ffffff62(a1), a1 => subtract 160, add 2 (next frame plane)
      }
    }
  }

  while (a5 < a5_end) {
    let ctrl = bytes[a5++];
    let count = 0;
    let isRepeat = false;

    if (ctrl === 0) {
      if (a5 + 1 >= a5_end) break;
      count = (bytes[a5] << 8) | bytes[a5 + 1];
      a5 += 2;
      isRepeat = true;
    } else if (ctrl === 1) {
      if (a5 + 1 >= a5_end) break;
      count = (bytes[a5] << 8) | bytes[a5 + 1];
      a5 += 2;
      isRepeat = false;
    } else if (ctrl >= 128) {
      count = 256 - ctrl;
      isRepeat = false;
    } else {
      count = ctrl;
      isRepeat = true;
    }

    if (isRepeat) {
      // Repeat a single word read from the uncompressed word stream (a4)
      if (a4 + 1 >= bytes.length) break;
      const val = (bytes[a4] << 8) | bytes[a4 + 1];
      a4 += 2;
      for (let i = 0; i < count; i++) {
        if (a1 >= 32000) break;
        vram[a1] = (val >> 8) & 0xFF;
        vram[a1 + 1] = val & 0xFF;
        advance();
      }
    } else {
      // Copy count consecutive literal words from the uncompressed stream (a4)
      for (let i = 0; i < count; i++) {
        if (a4 + 1 >= bytes.length) break;
        const val = (bytes[a4] << 8) | bytes[a4 + 1];
        a4 += 2;
        if (a1 >= 32000) break;
        vram[a1] = (val >> 8) & 0xFF;
        vram[a1 + 1] = val & 0xFF;
        advance();
      }
    }
  }

  return {
    resolution: res > 2 ? 0 : res,
    palette,
    vram
  };
}

/**
 * Decodes unpacked Tiny Stuff planar VRAM according to designated resolution.
 */
export function tryDecodeTinyImage(ext: string, bytes: Uint8Array): TinyDecodedImage | null {
  const tinyResult = decompressTiny(bytes);
  if (!tinyResult) return null;

  let width = 320;
  let height = 200;
  let colors = 16;
  let resolution = tinyResult.resolution;

  // Align custom extensions to specific Atari resolutions
  const upperExt = ext.toUpperCase();
  if (upperExt === "TN1") resolution = 0;
  else if (upperExt === "TN2") resolution = 1;
  else if (upperExt === "TN3") resolution = 2;

  if (resolution === 0) {
    width = 320;
    height = 200;
    colors = 16;
  } else if (resolution === 1) {
    width = 640;
    height = 200;
    colors = 4;
  } else if (resolution === 2) {
    width = 640;
    height = 400;
    colors = 2;
  }

  let palette = tinyResult.palette;
  if (colors === 2) {
    palette = [[255, 255, 255], [0, 0, 0]]; // High contrast monochrome fallback
  }

  const rgba = decodePlanarVRAM(tinyResult.vram, palette, colors, width, height);
  const detail = `Tiny Stuff (.${upperExt}) Image | ${width}x${height} | ${colors} colors`;

  return {
    detail,
    rgba,
    width,
    height
  };
}

export function tryRenderAtariSTImage(ext: string, bytes: Uint8Array, canvas: HTMLCanvasElement): { detail: string; rgba: Uint8ClampedArray } | null {
  const upperExt = ext.toUpperCase();
  if (upperExt === "TN1" || upperExt === "TN2" || upperExt === "TN3" || upperExt === "TNY") {
    const decoded = tryDecodeTinyImage(ext, bytes);
    if (decoded) {
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      return decoded;
    }
    return null;
  }

  if (ext === "SPC" || ext === "SPS") {
    try {
      const rgba = decodeSpectrumSPC(bytes);
      canvas.width = 300; // fit perfectly
      canvas.height = 200;
      return {
        detail: `Spectrum 512 (.SPC) Multi-Palette Graphic | 320x200 | 512 dynamic colors`,
        rgba
      };
    } catch (e) {
      return null;
    }
  }

  if (ext === "IMG") {
    try {
      const res = decodeGemImg(bytes);
      if (res) {
        canvas.width = res.width;
        canvas.height = res.height;
        return {
          detail: `GEM Interactive Graphic (.IMG) | ${res.width}x${res.height} | Monochrome 1-bit`,
          rgba: res.rgba
        };
      }
    } catch (e) {
      return null;
    }
  }

  if (ext === "ANM") {
    try {
      const frames = parseNeoAnimStrips(bytes);
      if (frames.length > 0) {
        const frame = frames[0];
        const rgba = decodePlanarVRAM(frame.pixels, frame.palette, 16, 320, 200);
        canvas.width = 320;
        canvas.height = 200;
        return {
          detail: `Neochrome Anim Strip (.ANM) | ${frames.length} Frame(s) | 16 Colors per frame`,
          rgba
        };
      }
    } catch (e) {
      return null;
    }
  }

  let width = 320; 
  let height = 200; 
  let colors = 16;
  let screenDataOffset = 0; 
  let paletteOffset = -1;
  let isCompressedDegas = false;

  if (ext === "PI1" || ext === "ART") {
    paletteOffset = 2; 
    screenDataOffset = 34;
  } else if (ext === "PC1") {
    width = 320;
    height = 200;
    colors = 16;
    paletteOffset = 2;
    screenDataOffset = 34;
    isCompressedDegas = true;
  } else if (ext === "NEO") {
    paletteOffset = 4; 
    screenDataOffset = 128;
  } else if (ext === "PI2") {
    width = 640; 
    height = 200; 
    colors = 4; 
    paletteOffset = 2; 
    screenDataOffset = 34;
  } else if (ext === "PC2") {
    width = 640;
    height = 200;
    colors = 4;
    paletteOffset = 2;
    screenDataOffset = 34;
    isCompressedDegas = true;
  } else if (ext === "PI3" || ext === "DOO") {
    width = 640; 
    height = 400; 
    colors = 2; 
    paletteOffset = (ext === "PI3") ? 2 : -1; 
    screenDataOffset = (ext === "PI3") ? 34 : 0;
  } else if (ext === "PC3") {
    width = 640;
    height = 400;
    colors = 2;
    paletteOffset = 2;
    screenDataOffset = 34;
    isCompressedDegas = true;
  } else if (ext === "MUR") {
    paletteOffset = -1; 
    screenDataOffset = 0;
  } else if (ext === "PBX") {
    width = 320;
    height = 200;
    colors = 16;
    if (bytes.length >= 32032) {
      if (bytes[0] === 0x50 && bytes[1] === 0x42 && bytes[2] === 0x58) { // "PBX"
        paletteOffset = 4;
        screenDataOffset = bytes.length >= 32064 ? 64 : 32;
      } else {
        paletteOffset = 0;
        screenDataOffset = 32;
      }
    } else {
      paletteOffset = -1;
      screenDataOffset = 0;
    }
  } else {
    return null; 
  }

  if (isCompressedDegas) {
    if (bytes.length < 34) return null;
  } else {
    const expectedLength = screenDataOffset + (width * height / (8 / (colors === 16 ? 4 : colors === 4 ? 2 : 1)));
    if (bytes.length < expectedLength && ext !== "MUR") return null;
  }

  canvas.width = width;
  canvas.height = height;

  let palette = new Array(16).fill(0).map(() => [0, 0, 0]);
  const defaultPalette = getDefaultSTPalette();
  for (let i = 0; i < 16; i++) {
    palette[i] = defaultPalette[i] || [0, 0, 0];
  }

  if (paletteOffset !== -1 && paletteOffset + 32 <= bytes.length) {
    for (let i = 0; i < 16; i++) {
      const idx = paletteOffset + (i * 2);
      const word = (bytes[idx] << 8) | bytes[idx + 1];
      const b = (word & 0x007);
      const g = ((word & 0x070) >> 4);
      const r = ((word & 0x700) >> 8);
      palette[i] = [r << 5, g << 5, b << 5];
    }
  } else if (colors === 2) {
    palette[0] = [255, 255, 255];
    palette[1] = [0, 0, 0];
  }

  let vramSlice: Uint8Array;
  if (isCompressedDegas) {
    const compressedSlice = bytes.subarray(screenDataOffset);
    const resolution = ext === "PC1" ? 0 : ext === "PC2" ? 1 : 2;
    vramSlice = decompressDegasPC(compressedSlice, resolution);
  } else {
    vramSlice = bytes.subarray(screenDataOffset);
  }

  const rgba = decodePlanarVRAM(vramSlice, palette, colors, width, height);

  return {
    detail: `${ext} Atari ST ${isCompressedDegas ? 'Compressed' : 'Raw'} Graphic | ${width}x${height} | ${colors} colors`,
    rgba
  };
}
