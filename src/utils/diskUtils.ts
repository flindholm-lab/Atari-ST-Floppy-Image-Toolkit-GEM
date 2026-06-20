/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DiskGeometry, DiskFileInfo } from '../types';

const signatureCache = new WeakMap<Uint8Array, string>();

export function detectPackerSignature(bytes: Uint8Array): string {
  if (!bytes || bytes.length < 4) return "None";
  const cached = signatureCache.get(bytes);
  if (cached !== undefined) return cached;
  const result = detectPackerSignatureInternal(bytes);
  signatureCache.set(bytes, result);
  return result;
}

function detectPackerSignatureInternal(bytes: Uint8Array): string {
  if (!bytes || bytes.length < 4) return "None";

  // ----- Helper check functions -----
  const checkLong = (offset: number, val: number): boolean => {
    if (offset < 0 || offset + 4 > bytes.length) return false;
    const num = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    return num === (val >>> 0);
  };

  const checkWord = (offset: number, val: number): boolean => {
    if (offset < 0 || offset + 2 > bytes.length) return false;
    const num = (bytes[offset] << 8) | bytes[offset + 1];
    return num === val;
  };

  const checkString = (offset: number, str: string): boolean => {
    if (offset < 0 || offset + str.length > bytes.length) return false;
    for (let i = 0; i < str.length; i++) {
      if (bytes[offset + i] !== str.charCodeAt(i)) return false;
    }
    return true;
  };

  const checkLastLongString = (str: string): boolean => {
    if (bytes.length < 4) return false;
    return checkString(bytes.length - 4, str);
  };

  // ----- 1. 4PAK -----
  if (checkLong(58, 0x4e714ef9)) {
    return "4PAK Executable Packer";
  }

  // ----- 2. Automation Packer -----
  // Data: ISDATA('LSD!') || ISDATA('LSD$') || ISDATA('AUTM') (v2.3/4), ISDATA('LSDC') (Chunked), ISDATA('AU5!') (v5.01), ISDATA('AU5C') (v5.01 Chunked)
  if (checkString(0, "LSD!")) return "Automation Packer v2.x/v3.x / JAM / LSD Raw Data";
  if (checkString(0, "LSD$") || checkString(0, "AUTM")) {
    return "Automation Packer v2.x/v3.x Raw Data";
  }
  if (checkString(0, "LSDC")) {
    return "Automation Chunked Raw Data";
  }
  if (checkString(0, "AU5!")) {
    return "Automation Packer v5.01 Raw Data";
  }
  if (checkString(0, "AU5C")) {
    return "Automation Packer v5.01 Chunked Raw Data";
  }
  // Program: ISPROG(482, 0x2e337200l) (v2.3r), ISPROG(482, 0x2e353100l) || ISPROG(482, 0x2e357200l) (v2.51), ISPROG(836, 'AU5!') (v5.01)
  if (checkLong(482, 0x2e337200)) {
    return "Automation Packer v2.3r Executable";
  }
  if (checkLong(482, 0x2e353100) || checkLong(482, 0x2e357200)) {
    return "Automation Packer v2.51 Executable";
  }
  if (checkString(836, "AU5!")) {
    return "Automation Packer v5.01 Executable";
  }

  // ----- 3. ATOM Packer (inc. Thunder / BMT) -----
  // Data: ISDATA('ATOM') (v3.1/3.3/Thunder), ... ATM5
  if (checkString(0, "ATOM")) {
    return "Atomik / Thunder Raw Data";
  }
  if (checkString(0, "ATM5")) {
    return "Atomik Cruncher v3.5 Raw Data";
  }
  // Program: ISPROG(516, 'ATOM') (v3.1), ISPROG(538, 'ATOM') (v3.3), ISPROG(564, '/BMT') (v3.3 BMT), ISPROG(336, 0x1b3250f0l) || ISPROG(634, '3.5 ') (v3.5)
  if (checkString(516, "ATOM")) {
    return "Atomik Cruncher v3.1 Executable Packer";
  }
  if (checkString(538, "ATOM")) {
    return "Atomik Cruncher v3.3 Executable Packer";
  }
  if (checkString(564, "/BMT")) {
    return "Atomik Cruncher v3.3 BMT Executable Packer";
  }
  if (checkLong(336, 0x1b3250f0) || checkString(634, "3.5 ")) {
    return "Atomik Cruncher v3.5 Executable Packer";
  }

  // ----- 4. BRAS -----
  if (checkString(30, "BRAS")) {
    return "BRAS Executable Packer";
  }

  // ----- 5. Bytekiller -----
  if (checkLastLongString("JPM!")) {
    return "Bytekiller (JPM Data) Raw Data";
  }
  if (checkLong(72, 0x0007fd00)) {
    return "Bytekiller v2 Executable Packer";
  }
  if (checkLong(72, 0x224a7053)) {
    return "Bytekiller v3 Executable Packer";
  }
  if (checkLong(28, 0x487a00aa)) {
    return "Bytekiller (Russ Payne) Executable Packer";
  }
  if (checkLong(190, 0x4efa0020)) {
    return "Bytekiller (JPM Prog) Executable Packer";
  }

  // ----- 6. DC Squish Packer -----
  if (checkString(40, "Squi")) {
    if (checkString(58, "10")) return "DC Squish Packer v1.0 Executable";
    if (checkString(58, "12")) return "DC Squish Packer v1.2 Executable";
    if (checkString(58, "14")) return "DC Squish Packer v1.4 Executable";
    if (checkString(58, "21")) return "DC Squish Packer v2.1 Executable";
    return "DC Squish Packer Executable";
  }

  // ----- 7. Gollum Packer -----
  if (checkLong(192, 0x42401018)) {
    return "Gollum Packer (Non-Huffman) Executable";
  }
  if (checkLong(192, 0x22572c7a)) {
    return "Gollum Packer (Huffman) Executable";
  }

  // ----- 8. Gremlin Packer -----
  if (checkLastLongString("GUS*")) {
    return "Gremlin Packer Raw Data";
  }

  // ----- 9. Happy Packer -----
  if (checkString(52, "EASY")) {
    return "Happy Packer Executable";
  }

  // ----- 10. ICE Packer / Superior -----
  if (checkLastLongString("Ice!")) {
    return "ICE Packer v1.1 Raw Data";
  }
  if (checkString(0, "Ice!")) {
    return "Pack-Ice v2.0/v2.2 Raw Data";
  }
  if (checkString(0, "ICE!")) {
    return "Pack-Ice v2.3/v2.4 Raw Data";
  }
  if (checkLong(70, 0x610000a0)) {
    return "Pack-Ice v1.1 Executable Packer";
  }
  if (checkWord(54, 0x2e3c)) {
    return "Pack-Ice v2.0 Executable Packer";
  }
  if (checkString(452, "Ice!")) {
    return "Pack-Ice v2.2 Executable Packer";
  }
  if (checkString(448, "ICE!")) {
    return "Pack-Ice v2.3 Executable Packer";
  }
  if (checkString(442, "ICE!")) {
    return "Pack-Ice v2.4 Executable Packer";
  }
  if (checkLong(28, 0x41fa0220)) {
    return "Superior PE Executable Packer";
  }

  // ----- 11. IMP Packer -----
  if (checkString(0, "IMP!")) {
    return "IMP Packer Raw Data";
  }

  // ----- 12. Ivory Dragon Packer -----
  if (checkLastLongString("PAWN")) {
    return "Ivory Dragon Packer Raw Data";
  }
  if (checkLong(96, 0x610000b2)) {
    return "Ivory Dragon Packer Executable";
  }

  // ----- 13. FIRE Packer -----
  if (checkLastLongString("Fire")) {
    return "FIRE Packer v1.0 Raw Data";
  }
  if (checkString(0, "FIRE")) {
    return "FIRE Packer v2.0 Raw Data";
  }
  if (checkString(36, "ire ")) {
    return "FIRE Packer v1.0 Executable";
  }
  if (checkString(36, "ire!")) {
    return "FIRE Packer v2.0 Executable";
  }

  // ----- 14. J Packer -----
  if (checkString(576, "cker")) {
    return "J Packer Executable";
  }

  // ----- 15. JAM Packer -----
  if (checkString(0, "LZH!")) {
    return "JAM LZH Raw Data";
  }
  if (checkString(0, "LZW!")) {
    return "JAM LZW Raw Data";
  }
  if (checkString(672, "JAM ") || checkString(674, "JAM ") || checkString(706, "JAM ")) {
    return "JAM Packer v1 Executable";
  }
  if (checkString(1170, "LSD!")) {
    return "JAM Packer v2 JAM3 Executable";
  }
  if (checkString(1170, "LZH!")) {
    return "JAM Packer LZH JAM3 Executable";
  }
  if (checkString(758, "LSD!")) {
    return "JAM Packer v2 JAM4 Executable";
  }
  if (checkString(1194, "LZH!")) {
    return "JAM Packer LZH JAM4 Executable";
  }
  if (checkString(544, "LZW!")) {
    return "JAM Packer LZW JAM4 Executable";
  }
  if (checkString(712, "Ice!")) {
    return "JAM Packer ICE JAM4 Executable";
  }

  // ----- 16. JEK Packer -----
  if (checkLong(28, 0x2a6f0004) && checkLong(32, 0x226d0010)) {
    return "JEK Packer / Byte Killer Executable";
  }
  if (checkLastLongString("JEK!")) {
    return "JEK Packer Raw Data";
  }
  if (checkString(638, "JEK ")) {
    return "JEK Packer v1.2d Executable";
  }
  if (checkString(646, "JEK ")) {
    return "JEK Packer v1.3d Executable";
  }

  // ----- 17. Le Crunch Packer -----
  if (checkString(0, "LeCr")) {
    return "Le Crunch Packer Raw Data";
  }

  // ----- 18. LSD Packer -----
  if (checkLastLongString("END!") || checkLastLongString("LSD!")) {
    return "LSD Packer Raw Data";
  }
  if (checkString(638, "PLEA") || checkString(638, "PACK")) {
    return "LSD Packer Executable";
  }
  if (checkString(650, "1.2 ")) {
    return "LSD Packer v1.2 Executable";
  }

  // ----- 19. MPack Packer -----
  if (checkLong(230, 0x4ac04440)) {
    return "MPack Packer Type 1 Executable";
  }
  if (checkLong(228, 0x4ac04440)) {
    return "MPack Packer Type 2 Executable";
  }
  if (checkLong(230, 0x7800284a)) {
    return "MPack Packer Type 3 Executable";
  }

  // ----- 20. PA Packer -----
  if (checkLong(102, 0x425d51cf)) {
    return "PA Packer Executable";
  }

  // ----- 21. PFX Packer -----
  if (checkString(422, "-lz5")) {
    return "PFX Packer v1.13 Executable";
  }
  if (checkString(564, "-lz5")) {
    return "PFX Packer v1.13/v1.6 Executable";
  }
  if (checkString(586, "-lz5")) {
    return "PFX Packer v1.8/v2.1 Executable";
  }
  if (checkString(1052, "-lz5")) {
    return "PFX Packer v2.1 (Anti-Virus) Executable";
  }

  // ----- 22. Pompey Packer -----
  if (checkLastLongString("POPI") || checkLastLongString("PUFF")) {
    return "Pompey Packer Raw Data";
  }
  if (checkLong(158, 0x00847604)) {
    return "Pompey Packer v1.5 Executable";
  }
  if (checkLong(158, 0x60000084)) {
    return "Pompey Packer v1.9 Executable";
  }
  if (checkLong(158, 0x340460f0)) {
    return "Pompey Packer v1.9 Var 1 Executable";
  }
  if (checkLong(158, 0x3f3c000a)) {
    return "Pompey Packer v1.9 Var 2 Executable";
  }
  if (checkLong(158, 0x76046022)) {
    return "Pompey Packer v2.3 Executable";
  }
  if (checkLong(158, 0x65647201)) {
    return "Pompey Packer v2.6 Executable";
  }
  if (checkLong(158, 0x60e67205)) {
    return "Pompey Packer v3.0 Executable";
  }

  // ----- 23. Power Packer -----
  if (checkString(0, "PP20")) {
    return "Power Packer v2.0 Raw Data";
  }

  // ----- 24. QPak Packer -----
  if (checkString(4, "2-JM")) {
    return "QPak Packer v2 Raw Data";
  }
  if (checkString(52, "2-JM")) {
    return "QPak Packer v2 Executable";
  }

  // ----- 25. RNC Packer (Propack) -----
  if (checkLong(0, 0x524E4301)) {
    return "Rob Northen Compression (Method 1) Raw Data";
  }
  if (checkLong(0, 0x524E4302)) {
    return "Rob Northen Compression (Method 2) Raw Data";
  }
  if (checkLong(146, 0x0c54601a)) {
    return "RNC Copylock Executable";
  }
  if (checkLong(642, 0x524e4302)) {
    return "RNC2 Executable";
  }

  // ----- 26. Sentry Packer -----
  if (checkLastLongString("Snt2")) {
    return "Sentry Packer v2.05 Raw Data";
  }
  if (checkString(522, "2.05")) {
    return "Sentry Packer v2.05 Executable";
  }
  if (checkString(526, "2.11")) {
    return "Sentry Packer v2.11 Executable";
  }

  // ----- 27. Speedpacker -----
  if (checkString(0, "SP20")) {
    return "Speedpacker v2.0 Raw Data";
  }
  if (checkString(0, "SPv3")) {
    return "Speedpacker v3.0 Raw Data";
  }
  if (checkString(542, "SP20")) {
    return "Speedpacker v2.0 Executable";
  }
  if (checkLong(28, 0x4e417633)) {
    return "Speedpacker v3.0 Var 1 Executable";
  }
  if (checkString(1816, "SPv3")) {
    return "Speedpacker v3.0 Var 2 Executable";
  }
  if (checkString(30, "SPv3")) {
    return "Speedpacker v3.0 Var 3 Executable";
  }

  // ----- 28. STOS Packer -----
  if (checkLong(68, 0x0007fd00)) {
    return "STOS Executable Packer";
  }

  // ----- 29. Thunder Packer -----
  if (checkString(422, "ATOM")) {
    return "Thunder V1 Executable Packer";
  }
  if (checkString(480, "ATOM")) {
    return "Thunder V1.1 Executable Packer";
  }
  if (checkString(452, "ATOM")) {
    return "Thunder V2 Executable Packer";
  }

  // ----- 30. Vic2 Packer -----
  if (checkString(0, "Vic2")) {
    return "Vic2 Packer Raw Data";
  }

  // ----- 31. Degas Elite (Graphics Format) -----
  if (checkWord(0, 0x8000) || checkWord(0, 0x8001) || checkWord(0, 0x8002)) {
    return "Degas Elite Compressed Image";
  }

  // ----- 32. Unidentified / Unknown Packers -----
  if (checkLong(118, 0x4e714e71)) {
    return "Unidentified/Unknown Packer 1";
  }
  if (checkString(442, "****") && checkWord(0, 0x601a)) {
    return "Unidentified/Unknown Packer 2";
  }
  if (checkLong(572, 0x4e5a2c1f)) {
    return "Unidentified/Unknown Packer 3";
  }
  if (checkLong(522, 0x44fc0010)) {
    return "Unidentified/Unknown Packer 4";
  }

  // ----- Heuristics & Scan-Based fallback -----
  // If the file didn't match any precise signature template, we run a scan-based keyword search on the first 8192 bytes
  let scanLength = Math.min(bytes.length, 8192);
  let asciiContext = "";
  for (let i = 0; i < scanLength; i++) {
    asciiContext += (bytes[i] >= 32 && bytes[i] <= 126) ? String.fromCharCode(bytes[i]) : " ";
  }

  if (asciiContext.includes("THE MEDWAY BOYS")) return "The Medway Boys Packer";
  if (asciiContext.includes("ICE!")) return "Pack-Ice v2.4 Executable Packer";
  if (asciiContext.includes("Ice!")) return "Pack-Ice v2.1 Executable Packer";
  if (asciiContext.includes("Pack-Ice")) return "Pack-Ice v2.1 Executable Packer";
  if (asciiContext.includes("DPAK") || asciiContext.includes("NEW_DPAK") || asciiContext.includes("XERUD")) {
    return "Mike Watson (Xerud) NEW_DPAK";
  }
  if (asciiContext.includes("JAM Packer") || asciiContext.includes("The JAM Packer") || asciiContext.includes("JAM PACKER")) {
    return "The JAM Packer Executable";
  }
  if (asciiContext.includes("ATOMIC") || asciiContext.includes("THUNDER")) {
    return "JPM Thunder Packer / ATOMIC";
  }

  if (asciiContext.includes("ATOM") || asciiContext.includes("ATM5") || asciiContext.includes("ATM3") || asciiContext.includes("Atomik")) {
    const idx = asciiContext.indexOf("ATOM");
    if (idx >= 0 && idx + 12 <= bytes.length) {
      const uLen = readUint32BE(bytes, idx + 4);
      const pLength = readUint32BE(bytes, idx + 8);
      if (uLen > 0 && uLen < 16777216 && idx + pLength <= bytes.length) {
        const absolutePackedEnd = idx + pLength;
        const absoluteLiteralLenOffset = absolutePackedEnd - 4;
        let isV2 = false;
        if (absoluteLiteralLenOffset >= idx + 12 && absoluteLiteralLenOffset + 4 <= bytes.length) {
          const literalLength = readUint32BE(bytes, absoluteLiteralLenOffset);
          const absoluteLiteralsStart = absoluteLiteralLenOffset - literalLength;
          if (absoluteLiteralsStart >= idx + 12 && absoluteLiteralsStart <= absolutePackedEnd) {
            isV2 = true;
          }
        }
        if (isV2) return "Thunder V2 Executable Packer";
        try {
          const testThunV1 = decompressThunderV1(bytes, idx);
          if (testThunV1) return "Thunder V1 Executable Packer";
        } catch (e) {}
        return "Atomik Cruncher Executable Packer";
      }
    }
    return "Atomik Cruncher Executable Packer";
  }

  if (asciiContext.includes("AUTOMATION PACKER V2.3")) return "Automation 2.3 Packer";
  if (asciiContext.includes("AUTOMATION PACKER") || asciiContext.includes("Automation") || asciiContext.includes("COMPACTER")) {
    return "Automation Compacter";
  }
  if (asciiContext.includes("POMPEY PIRATES") || asciiContext.includes("POMPEY")) return "Pompey Pirates Packer";
  if (asciiContext.includes("JEK PACKER") || asciiContext.includes("JEK!")) return "JEK Packer / Byte Killer";

  // Tail-end scanning fallback
  const tailStart = Math.max(0, bytes.length - 1024);
  let tailAscii = "";
  for (let i = tailStart; i < bytes.length; i++) {
    tailAscii += (bytes[i] >= 32 && bytes[i] <= 126) ? String.fromCharCode(bytes[i]) : " ";
  }
  if (tailAscii.includes("THE MEDWAY BOYS")) return "The Medway Boys Packer";
  if (tailAscii.includes("JPM!")) return "Bytekiller (JPM Data) Raw Data";
  if (tailAscii.includes("GUS*")) return "Gremlin Packer Raw Data";
  if (tailAscii.includes("JEK!") || tailAscii.includes("JEK PACKER")) return "JEK Packer / Byte Killer";

  // ----- Atari ST Executable Header fallback -----
  const isExecutableHeader = (bytes[0] === 0x60 && (bytes[1] === 0x1A || bytes[1] === 0x1C || bytes[1] === 0x00));
  const isByteSwappedHeader = (bytes.length >= 4 && bytes[0] === 0x1A && bytes[1] === 0x00 && bytes[3] === 0x61);
  if (isExecutableHeader || isByteSwappedHeader) {
    return "Atari ST Executable (BRA $1C)";
  }

  return "None";
}

// Utility scan routines
export function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

export function findAsciiSignature(bytes: Uint8Array, text: string, start: number, end: number): number {
  const needle = text.split("").map(c => c.charCodeAt(0));
  const limit = Math.min(end, bytes.length - needle.length);
  for (let i = start; i < limit; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

export function bytesToAsciiScan(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : " ").join("");
}

export function bytesToString(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 32 && bytes[i] < 127) str += String.fromCharCode(bytes[i]);
  }
  return str;
}

export function stringToBytes(str: string, len: number): Uint8Array {
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = i < str.length ? str.charCodeAt(i) : 0x20;
  }
  return arr;
}

export function formatSizeBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + " " + ["B", "KB", "MB"][i];
}

export function dateTimeToFatTime(dateObj: Date): number {
  return (dateObj.getHours() << 11) | (dateObj.getMinutes() << 5) | Math.floor(dateObj.getSeconds() / 2);
}

export function dateTimeToFatDate(dateObj: Date): number {
  return ((dateObj.getFullYear() - 1980) << 9) | ((dateObj.getMonth() + 1) << 5) | dateObj.getDate();
}

// FAT12 Binary parsers
export function readFAT12Entry(diskBytes: Uint8Array, cluster: number, geometry: DiskGeometry): number {
  if (!diskBytes) return 0;
  const pos = geometry.fatTableStart + Math.floor((cluster * 3) / 2);
  const singleFatSize = geometry.sectorsPerFat * geometry.bytesPerSector;
  if (pos >= geometry.fatTableStart + singleFatSize) return 0xFFF;

  const b1 = diskBytes[pos] || 0;
  const b2 = diskBytes[pos + 1] || 0;
  const val = b1 | (b2 << 8);

  return (cluster % 2) === 0 ? (val & 0x0FFF) : (val >> 4);
}

export function writeFAT12EntryAllCopies(workingBytes: Uint8Array, cluster: number, value: number, geometry: DiskGeometry): void {
  value = value & 0x0FFF;
  const singleFatSize = geometry.sectorsPerFat * geometry.bytesPerSector;
  for (let fatIdx = 0; fatIdx < geometry.numFats; fatIdx++) {
    const base = geometry.fatTableStart + (fatIdx * singleFatSize);
    const pos = base + Math.floor((cluster * 3) / 2);
    
    const b1 = workingBytes[pos] || 0;
    const b2 = workingBytes[pos + 1] || 0;
    let val = b1 | (b2 << 8);

    if ((cluster % 2) === 0) {
      val = (val & 0xF000) | value;
    } else {
      val = (val & 0x000F) | (value << 4);
    }

    workingBytes[pos] = val & 0xFF;
    workingBytes[pos + 1] = (val >> 8) & 0xFF;
  }
}

export function getClusterChain(diskBytes: Uint8Array, startCluster: number, geometry: DiskGeometry): number[] {
  const chain: number[] = [];
  let curr = startCluster;
  let watchdog = 0;
  while (curr >= 2 && curr < 0xFF8 && watchdog < 4096) {
    if (chain.includes(curr)) break; 
    chain.push(curr);
    curr = readFAT12Entry(diskBytes, curr, geometry);
    watchdog++;
  }
  return chain;
}

export function scoreDirectoryAtOffset(diskBytes: Uint8Array, offset: number, maxEntries: number): number {
  if (offset + (maxEntries * 32) > diskBytes.length) {
    maxEntries = Math.floor((diskBytes.length - offset) / 32);
  }
  if (maxEntries <= 0) return -1;

  let score = 0;
  for (let i = 0; i < maxEntries; i++) {
    const entryOff = offset + (i * 32);
    const firstByte = diskBytes[entryOff];

    if (firstByte === 0x00) continue;

    // Check first byte validity based on standard GEMDOS/MS-DOS rules
    const syms = "_^$~!#%&-{}()@'".split('').map(c => c.charCodeAt(0));
    const isValidFirst = (
      firstByte === 0xE5 || firstByte === 0x05 ||
      (firstByte >= 0x41 && firstByte <= 0x5A) ||
      (firstByte >= 0x61 && firstByte <= 0x7A) ||
      (firstByte >= 0x30 && firstByte <= 0x39) ||
      syms.includes(firstByte) ||
      (firstByte >= 128 && firstByte <= 254 && firstByte !== 0xF8 && firstByte !== 0xF9)
    );
    
    if (!isValidFirst) {
      return -1; // Heavy penalty for garbage/FAT tables
    }

    const attr = diskBytes[entryOff + 11];
    if ((attr & 0xC0) !== 0) {
      return -1; // Heavy penalty for garbage/corrupted flags
    }

    // Check name characters: must be valid ASCII character codes and NO null bytes at all in first 11 chars!
    let hasInvalidChars = false;
    for (let j = 0; j < 11; j++) {
      const char = diskBytes[entryOff + j];
      if (char === 0x00) {
        // Standard directories pad with spaces (0x20), never with nulls (0x00)
        hasInvalidChars = true;
        break;
      }
      if (char < 0x20 && char !== 0x05) {
        hasInvalidChars = true;
        break;
      }
    }

    if (hasInvalidChars) {
      return -1; // Heavy penalty
    }

    const cluster = diskBytes[entryOff + 26] | (diskBytes[entryOff + 27] << 8);
    if (cluster > 4000) {
      return -1; // Heavy penalty
    }

    score++;
  }
  return score;
}

export function getDiskDirEntries(diskBytes: Uint8Array, dirCluster: number, geometry: DiskGeometry): DiskFileInfo[] {
  const entries: DiskFileInfo[] = [];
  const segments: { bytes: Uint8Array; diskOffset: number }[] = [];

  if (dirCluster === 0) {
    segments.push({
      bytes: diskBytes.slice(geometry.rootDirStart, geometry.rootDirStart + (geometry.rootDirEntries * 32)),
      diskOffset: geometry.rootDirStart
    });
  } else {
    // Bulletproof direct physical subdirectory search:
    let actualOffset: number | null = null;
    for (let offset = 512; offset < diskBytes.length - 64; offset += 512) {
      if (diskBytes[offset] === 0x2E && 
          diskBytes[offset + 1] === 0x20 && 
          diskBytes[offset + 11] === 0x10 &&
          diskBytes[offset + 32] === 0x2E &&
          diskBytes[offset + 33] === 0x2E &&
          diskBytes[offset + 43] === 0x10) {
        
        const startCluster = diskBytes[offset + 26] | (diskBytes[offset + 27] << 8);
        if (startCluster === dirCluster) {
          actualOffset = offset;
          break;
        }
      }
    }

    if (actualOffset !== null) {
      console.log(`[getDiskDirEntries] Bulletproof bypassed directory cluster ${dirCluster} to physical offset ${actualOffset}.`);
      segments.push({
        bytes: diskBytes.slice(actualOffset, actualOffset + geometry.bytesPerCluster),
        diskOffset: actualOffset
      });

      const chain = getClusterChain(diskBytes, dirCluster, geometry);
      if (chain.length > 1) {
        const calcOffsetFirst = geometry.dataAreaStart + (dirCluster - 2) * geometry.bytesPerCluster;
        const delta = actualOffset - calcOffsetFirst;

        for (let i = 1; i < chain.length; i++) {
          const c = chain[i];
          const calcOffsetC = geometry.dataAreaStart + (c - 2) * geometry.bytesPerCluster;
          const realOffsetC = calcOffsetC + delta;
          if (realOffsetC >= 0 && realOffsetC + geometry.bytesPerCluster <= diskBytes.length) {
            segments.push({
              bytes: diskBytes.slice(realOffsetC, realOffsetC + geometry.bytesPerCluster),
              diskOffset: realOffsetC
            });
          }
        }
      }
    } else {
      const chain = getClusterChain(diskBytes, dirCluster, geometry);
      for (let cluster of chain) {
        const offset = geometry.dataAreaStart + (cluster - 2) * geometry.bytesPerCluster;
        segments.push({
          bytes: diskBytes.slice(offset, offset + geometry.bytesPerCluster),
          diskOffset: offset
        });
      }
    }
  }

  for (let seg of segments) {
    for (let off = 0; off < seg.bytes.byteLength; off += 32) {
      const firstByte = seg.bytes[off];
      
      if (firstByte === 0x00) break;

      const isDeleted = (firstByte === 0xE5 || firstByte === 0x05);
      const attr = seg.bytes[off + 11];
      if (attr & 0x08) continue; // Skip Volume Label

      const isHidden = (attr & 0x02) === 0x02;

      let nameBytes = seg.bytes.slice(off, off + 8);
      if (isDeleted) {
        nameBytes[0] = (firstByte === 0x05) ? 0x45 : 0x5F;
      }

      const nameStr = bytesToString(nameBytes).trim();
      const extStr = bytesToString(seg.bytes.slice(off + 8, off + 11)).trim();
      const isDir = (attr & 0x10) !== 0;
      
      const startCluster = seg.bytes[off + 26] | (seg.bytes[off + 27] << 8);
      const fileSize = seg.bytes[off + 28] | (seg.bytes[off + 29] << 8) | (seg.bytes[off + 30] << 16) | (seg.bytes[off + 31] << 24);

      const printableName = nameStr + (extStr ? "." + extStr : "");

      entries.push({
        name: printableName,
        name83: nameStr,
        ext83: extStr,
        isDir: isDir,
        size: fileSize,
        cluster: startCluster,
        diskOffset: seg.diskOffset + off,
        stagedStatus: 'NORMAL',
        isDeleted: isDeleted,
        isHidden: isHidden
      });
    }
  }
  return entries;
}

export function isGeometryCompliant(diskBytes: Uint8Array): boolean {
  if (!diskBytes || diskBytes.length < 512) return false;
  
  const bytesPerSector = diskBytes[11] | (diskBytes[12] << 8);
  const sectorsPerCluster = diskBytes[13];
  const reservedSectors = diskBytes[14] | (diskBytes[15] << 8);
  const numFats = diskBytes[16];
  const rootDirEntries = diskBytes[17] | (diskBytes[18] << 8);
  const totalSectors = diskBytes[19] | (diskBytes[20] << 8);
  const sectorsPerFat = diskBytes[22] | (diskBytes[23] << 8);

  // Check typical non-compliant/fake properties for standard Atari disks
  if (bytesPerSector !== 512) return false;
  if (sectorsPerCluster !== 1 && sectorsPerCluster !== 2 && sectorsPerCluster !== 4 && sectorsPerCluster !== 8) return false;
  if (reservedSectors === 0 || reservedSectors > 10) return false;
  if (numFats !== 1 && numFats !== 2) return false;
  if (rootDirEntries !== 64 && rootDirEntries !== 112 && rootDirEntries !== 224 && rootDirEntries !== 576) return false;
  if (sectorsPerFat === 0 || sectorsPerFat > 32) return false;
  if (totalSectors === 0 || totalSectors * 512 > diskBytes.length + 102400) return false;

  return true;
}

export function discoverDirectoryContent(diskBytes: Uint8Array): {
  rootDirStart: number;
  rootDirEntries: number;
  bytesPerCluster: number;
} {
  let bytesPerSector = diskBytes[11] | (diskBytes[12] << 8);
  if (bytesPerSector !== 512 && bytesPerSector !== 1024) bytesPerSector = 512;
  let sectorsPerCluster = diskBytes[13];
  if (sectorsPerCluster === 0 || sectorsPerCluster > 8) sectorsPerCluster = 2; 
  
  const bytesPerCluster = bytesPerSector * sectorsPerCluster;

  // Let's determine a logical default based on total file size
  let bestOffset = 3584; 
  let expectedEntries = 112;

  if (diskBytes.length <= 368640) {
    bestOffset = 2560; // Sector 5 (360KB single sided default)
    expectedEntries = 64;
  } else {
    bestOffset = 3584; // Sector 7 (720KB double sided default)
    expectedEntries = 112;
  }

  let bestScore = 0; // Initialize at 0 so we only choose a scan candidate if it has actual valid formatted file records

  // Search through all sectors up to 30 sectors (15360 bytes)
  for (let offset = 512; offset < 15360; offset += 512) {
    if (offset + 512 > diskBytes.length) break;

    const score = scoreDirectoryAtOffset(diskBytes, offset, 16);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
      expectedEntries = (offset < 3000) ? 64 : 112;
    }
  }

  return {
    rootDirStart: bestOffset,
    rootDirEntries: expectedEntries,
    bytesPerCluster
  };
}

export function scoreDirectory(diskBytes: Uint8Array): number {
  let bestScore = 0;

  for (let offset = 512; offset < 15360; offset += 512) {
    if (offset + 512 > diskBytes.length) break;

    const rootDirEntries = (offset < 3000) ? 64 : 112;
    const score = scoreDiskLayoutWithGeom(diskBytes, offset, rootDirEntries);
    if (score > bestScore) {
      bestScore = score;
    }
  }

  return bestScore;
}

export function deduceGeometryForRootOffset(diskBytes: Uint8Array, rootDirStart: number, rootDirEntries: number): DiskGeometry {
  const bytesPerSector = 512;
  const reservedSectors = 1;
  const numFats = 2;
  
  // 1. Start with the boot sector's BPB value as a candidate if valid
  let sectorsPerCluster = diskBytes[13];
  if (sectorsPerCluster !== 1 && sectorsPerCluster !== 2 && sectorsPerCluster !== 4 && sectorsPerCluster !== 8) {
    sectorsPerCluster = 2; // Default for ST disks
  }
  
  // 2. Calculate initial sectorsPerFat based on rootDirStart
  let sectorsPerFat = Math.max(1, Math.floor((rootDirStart - 512) / 1024));
  let singleFatSize = sectorsPerFat * bytesPerSector;
  let fatTableStart = reservedSectors * bytesPerSector;
  let fatTableSize = numFats * singleFatSize;
  let rootDirSectors = Math.floor((rootDirEntries * 32 + (bytesPerSector - 1)) / bytesPerSector);
  let dataAreaStart = rootDirStart + rootDirSectors * bytesPerSector;
  
  // 3. Scan the disk to see if any subdirectories imply a different sectorsPerCluster and dataAreaStart!
  const subDirs: { cluster: number; offset: number }[] = [];
  for (let offset = 512; offset < diskBytes.length - 64; offset += 512) {
    if (diskBytes[offset] === 0x2E && 
        diskBytes[offset + 1] === 0x20 && 
        diskBytes[offset + 11] === 0x10 &&
        diskBytes[offset + 32] === 0x2E &&
        diskBytes[offset + 33] === 0x2E &&
        diskBytes[offset + 43] === 0x10) {
      
      const startCluster = diskBytes[offset + 26] | (diskBytes[offset + 27] << 8);
      if (startCluster >= 2 && startCluster < 4096) {
        subDirs.push({ cluster: startCluster, offset });
      }
    }
  }

  let bestSectorsPerCluster = sectorsPerCluster;
  let bestDataAreaStart = dataAreaStart;
  
  if (subDirs.length > 0) {
    let maxAgreement = 0;
    for (const testSPC of [1, 2, 4]) {
      const counts = new Map<number, number>();
      for (const sd of subDirs) {
        const impliedDataAreaStart = sd.offset - (sd.cluster - 2) * testSPC * 512;
        if (impliedDataAreaStart >= rootDirStart + rootDirSectors * 512 && impliedDataAreaStart % 512 === 0) {
          counts.set(impliedDataAreaStart, (counts.get(impliedDataAreaStart) || 0) + 1);
        }
      }
      for (const [das, count] of counts.entries()) {
        if (count > maxAgreement) {
          maxAgreement = count;
          bestSectorsPerCluster = testSPC;
          bestDataAreaStart = das;
        } else if (count === maxAgreement && maxAgreement > 0) {
          const currentDiff = Math.abs(bestDataAreaStart - (rootDirStart + rootDirSectors * 512));
          const testDiff = Math.abs(das - (rootDirStart + rootDirSectors * 512));
          if (testDiff < currentDiff) {
            bestSectorsPerCluster = testSPC;
            bestDataAreaStart = das;
          }
        }
      }
    }
    sectorsPerCluster = bestSectorsPerCluster;
    dataAreaStart = bestDataAreaStart;
    
    // Dynamically adjust root directory size if the space changed!
    if (dataAreaStart > rootDirStart) {
      rootDirSectors = Math.floor((dataAreaStart - rootDirStart) / bytesPerSector);
      rootDirEntries = rootDirSectors * 16;
    }
    console.log(`[deduceGeometryForRootOffset] Subdirectory vote determined sectorsPerCluster = ${sectorsPerCluster}, dataAreaStart = ${dataAreaStart}, rootDirEntries = ${rootDirEntries}.`);
  }
  
  // Recalculate dependent parameters with updated factors
  singleFatSize = sectorsPerFat * bytesPerSector;
  fatTableStart = reservedSectors * bytesPerSector;
  fatTableSize = numFats * singleFatSize;
  const bytesPerCluster = sectorsPerCluster * bytesPerSector;
  let totalSectors = Math.floor(diskBytes.length / 512);

  if (diskBytes.length >= 512) {
    const bytesPerSectVal = diskBytes[11] | (diskBytes[12] << 8);
    const bpbSectVal = diskBytes[19] | (diskBytes[20] << 8);
    if (bytesPerSectVal === 512 && bpbSectVal > 0 && bpbSectVal <= totalSectors + 32) {
      totalSectors = bpbSectVal;
    }
  }

  return {
    bytesPerSector,
    sectorsPerCluster,
    reservedSectors,
    numFats,
    rootDirEntries,
    totalSectors,
    sectorsPerFat,
    singleFatSize,
    fatTableStart,
    fatTableSize,
    rootDirStart,
    rootDirSectors,
    dataAreaStart,
    bytesPerCluster,
    isFallback: true
  };
}

export function scoreDiskLayoutWithGeom(diskBytes: Uint8Array, rootDirStart: number, rootDirEntries: number): number {
  if (rootDirStart + (rootDirEntries * 32) > diskBytes.length) {
    return -100;
  }
  
  // 1. Score the root directory itself
  const rScore = scoreDirectoryAtOffset(diskBytes, rootDirStart, rootDirEntries);
  if (rScore < 0) return -100; // Not a valid directory structure

  if (rScore === 0) return 0; // Valid but empty

  // 2. Parse entries and score subdirectories
  const tempGeom = deduceGeometryForRootOffset(diskBytes, rootDirStart, rootDirEntries);
  const rootEntries = getDiskDirEntries(diskBytes, 0, tempGeom);

  let subDirectoryScoreSum = 0;
  let subDirectoryCount = 0;

  for (const entry of rootEntries) {
    if (entry.isDir && !entry.isDeleted && entry.name !== '.' && entry.name !== '..') {
      const clusterNum = (typeof entry.cluster === 'number') ? entry.cluster : parseInt(entry.cluster, 10);
      if (!isNaN(clusterNum) && clusterNum >= 2 && clusterNum < 4000) {
        const chain = getClusterChain(diskBytes, clusterNum, tempGeom);
        if (chain.length > 0) {
          const firstCluster = chain[0];
          const offset = tempGeom.dataAreaStart + (firstCluster - 2) * tempGeom.bytesPerCluster;
          const subScore = scoreDirectoryAtOffset(diskBytes, offset, 16);
          if (subScore >= 0) {
            // Found a valid subdirectory! Award it
            subDirectoryScoreSum += (subScore + 5); 
          } else {
            // Highly likely mismatched layout, penalty!
            subDirectoryScoreSum -= 30;
          }
          subDirectoryCount++;
          if (subDirectoryCount >= 3) break;
        }
      } else if (!isNaN(clusterNum) && clusterNum !== 0) {
        // Invalid cluster number in directory, penalty!
        subDirectoryScoreSum -= 20;
      }
    }
  }

  return rScore + subDirectoryScoreSum;
}

export function deinterleaveSingleSided(diskBytes: Uint8Array, spt: number): Uint8Array {
  const bytesPerTrackSide = spt * 512;
  const totalSectors = Math.floor(diskBytes.length / 512);
  const tracksEstimate = Math.ceil(totalSectors / (spt * 2));
  
  const reconstructed = new Uint8Array(tracksEstimate * bytesPerTrackSide);
  let destPtr = 0;
  
  for (let t = 0; t < tracksEstimate; t++) {
    const srcStart = t * 2 * bytesPerTrackSide;
    if (srcStart >= diskBytes.length) break;
    
    const sliceLen = Math.min(bytesPerTrackSide, diskBytes.length - srcStart);
    reconstructed.set(diskBytes.subarray(srcStart, srcStart + sliceLen), destPtr);
    destPtr += sliceLen;
  }
  
  return reconstructed.slice(0, destPtr);
}

export function optimizeDiskImage(
  diskBytes: Uint8Array,
  msaSectorsPerTrack?: number,
  msaSides?: number
): {
  bytes: Uint8Array;
  wasDeinterleaved: boolean;
  isFallback: boolean;
} {
  // If the disk is very small (less than 450KB), it must be single sided anyway,
  // so no need to de-interleave. Just return as is.
  if (diskBytes.length < 450000) {
    return { bytes: diskBytes, wasDeinterleaved: false, isFallback: false };
  }

  // Parse Boot Sector BPB
  let bpbTotalSectors = 0;
  let bpbSides = 0;
  let bpbSectPerTrack = 0;
  let hasValidBPB = false;

  if (diskBytes.length >= 512) {
    const bytesPerSector = diskBytes[11] | (diskBytes[12] << 8);
    const reservedSectors = diskBytes[14] | (diskBytes[15] << 8);
    const numFats = diskBytes[16];
    if (bytesPerSector === 512 && reservedSectors > 0 && reservedSectors <= 10 && (numFats === 1 || numFats === 2)) {
      bpbTotalSectors = diskBytes[19] | (diskBytes[20] << 8);
      bpbSides = diskBytes[26] | (diskBytes[27] << 8);
      bpbSectPerTrack = diskBytes[24] | (diskBytes[25] << 8);
      hasValidBPB = true;
    }
  }

  // Determine if it is a faked double-sided format containing a single-sided "hidden" image
  let shouldDeinterleave = false;
  let useSpt = 9;

  // Case 1: MSA header specifically says 1 side, but decompression generated a double-sided size
  if (msaSides === 1) {
    shouldDeinterleave = true;
    useSpt = msaSectorsPerTrack || bpbSectPerTrack || 9;
  }
  // Case 2: BPB of the hidden image says 1 side or <= 820 sectors, but physical buffer is double-sided (~720KB+)
  else if (hasValidBPB && (bpbSides === 1 || (bpbTotalSectors > 0 && bpbTotalSectors <= 820))) {
    shouldDeinterleave = true;
    useSpt = bpbSectPerTrack || msaSectorsPerTrack || 9;
  }

  if (shouldDeinterleave) {
    console.log(`[Disk Optimizer] Detected single-sided BPB (${bpbTotalSectors || 720} sectors, sides=1) inside a double-sided container (length=${diskBytes.length}). Deinterleaving with spt = ${useSpt}...`);
    const candidate = deinterleaveSingleSided(diskBytes, useSpt);
    if (candidate.length >= 512) {
      // Correct single-sided flags inside deinterleaved boot sector
      candidate[26] = 1;
      candidate[27] = 0;
      
      const currentTotalSectors = candidate[19] | (candidate[20] << 8);
      // Ensure we have a valid single-sided total sector count in BPB
      if (currentTotalSectors === 0 || currentTotalSectors > 820) {
        const standardSingleSidedSectors = useSpt * 80; // (e.g. 720 or 800)
        candidate[19] = standardSingleSidedSectors & 0xFF;
        candidate[20] = (standardSingleSidedSectors >> 8) & 0xFF;
      }
    }
    return {
      bytes: candidate,
      wasDeinterleaved: true,
      isFallback: false
    };
  }

  // --- HEURISTIC SCORING FALLBACK ---
  // Only search / heuristically deinterleave if the original layout is UNREADABLE (asIsScore <= 0)
  // because otherwise we risk destroying valid double-sided geometry.
  const asIsDiscovery = discoverDirectoryContent(diskBytes);
  const asIsScore = scoreDiskLayoutWithGeom(diskBytes, asIsDiscovery.rootDirStart, asIsDiscovery.rootDirEntries);

  if (asIsScore <= 0) {
    let bestDeinterleaved: Uint8Array | null = null;
    let bestDeinterleavedScore = asIsScore;
    let bestSpt = 9;

    for (const spt of [9, 10, 11]) {
      const candidate = deinterleaveSingleSided(diskBytes, spt);
      const candDiscovery = discoverDirectoryContent(candidate);
      const candidateScore = scoreDiskLayoutWithGeom(candidate, candDiscovery.rootDirStart, candDiscovery.rootDirEntries);
      if (candidateScore > bestDeinterleavedScore) {
        bestDeinterleavedScore = candidateScore;
        bestDeinterleaved = candidate;
        bestSpt = spt;
      }
    }

    if (bestDeinterleaved && bestDeinterleavedScore > asIsScore && bestDeinterleavedScore >= 1) {
      console.log(`[Disk Optimizer] Heuristics detected faked double-sided layout! Re-aligning to single-sided with spt = ${bestSpt}. Score improved from ${asIsScore} to ${bestDeinterleavedScore}.`);
      const cleanedBytes = new Uint8Array(bestDeinterleaved);
      if (cleanedBytes.length >= 512) {
        // Force heads/sides in boot sector to 1
        cleanedBytes[26] = 1;
        cleanedBytes[27] = 0;
        
        const currentTotalSectors = cleanedBytes[19] | (cleanedBytes[20] << 8);
        if (currentTotalSectors === 0 || currentTotalSectors > 820) {
          const standardSingleSidedSectors = bestSpt * 80;
          cleanedBytes[19] = standardSingleSidedSectors & 0xFF;
          cleanedBytes[20] = (standardSingleSidedSectors >> 8) & 0xFF;
        }
      }
      
      return {
        bytes: cleanedBytes,
        wasDeinterleaved: true,
        isFallback: true
      };
    }
  }

  return { bytes: diskBytes, wasDeinterleaved: false, isFallback: false };
}

// MSA Image compression/decompression
export function decompressMSA(msaBytes: Uint8Array): Uint8Array {
  const sectorsPerTrack = (msaBytes[2] << 8) | msaBytes[3];
  const sides = ((msaBytes[4] << 8) | msaBytes[5]) + 1; 
  const startTrack = (msaBytes[6] << 8) | msaBytes[7];
  const endTrack = (msaBytes[8] << 8) | msaBytes[9];
  
  const totalTracks = endTrack - startTrack + 1;
  const bytesPerTrack = sectorsPerTrack * 512;
  const totalSizeBytes = totalTracks * bytesPerTrack * sides;
  
  const uncompressedDisk = new Uint8Array(totalSizeBytes);
  let srcPtr = 10; 
  let destPtr = 0;

  let outOfData = false;
  for (let track = startTrack; track <= endTrack; track++) {
    for (let side = 0; side < sides; side++) {
      if (srcPtr + 2 > msaBytes.length) {
        outOfData = true;
        break;
      }
      
      const trackLen = (msaBytes[srcPtr] << 8) | msaBytes[srcPtr + 1];
      srcPtr += 2;

      if (srcPtr + trackLen > msaBytes.length) {
        outOfData = true;
        break;
      }

      if (trackLen === bytesPerTrack) {
        uncompressedDisk.set(msaBytes.subarray(srcPtr, srcPtr + trackLen), destPtr);
        destPtr += bytesPerTrack;
        srcPtr += trackLen;
      } else {
        const endTrackPtr = srcPtr + trackLen;
        const trackDestStart = destPtr;
        
        while (srcPtr < endTrackPtr) {
          const byte = msaBytes[srcPtr++];
          if (byte === 0xE5) { 
            if (srcPtr + 3 > endTrackPtr) {
              outOfData = true;
              break;
            }
            
            const dataByte = msaBytes[srcPtr++];
            const count = (msaBytes[srcPtr] << 8) | msaBytes[srcPtr + 1];
            srcPtr += 2;

            for (let c = 0; c < count; c++) {
              if (destPtr - trackDestStart >= bytesPerTrack) break;
              uncompressedDisk[destPtr++] = dataByte;
            }
          } else {
            if (destPtr - trackDestStart >= bytesPerTrack) break;
            uncompressedDisk[destPtr++] = byte;
          }
        }
        destPtr = trackDestStart + bytesPerTrack;
      }
    }
    if (outOfData) break;
  }
  return uncompressedDisk.slice(0, destPtr);
}

export function decompressRLE(sourceBytes: Uint8Array): Uint8Array {
  const dest: number[] = [];
  let i = 0;
  while (i < sourceBytes.length) {
    const b = sourceBytes[i++];
    if (b === undefined) break;
    const header = b > 127 ? b - 256 : b;
    if (header >= 0 && header <= 127) {
      for (let count = 0; count < header + 1; count++) {
        if (i < sourceBytes.length) dest.push(sourceBytes[i++]);
      }
    } else if (header >= -127 && header <= -1) {
      const val = sourceBytes[i++];
      if (val === undefined) break;
      for (let count = 0; count < -header + 1; count++) dest.push(val);
    }
  }
  return new Uint8Array(dest);
}

// Pack-Ice binary decompressor
export function findEmbeddedBlockSignature(bytes: Uint8Array, sigBytes: number[]): number {
  if (bytes.length < sigBytes.length) return -1;
  const firstByte = sigBytes[0];
  let searchIdx = 0;
  while (true) {
    const idx = bytes.indexOf(firstByte, searchIdx);
    if (idx === -1 || idx + sigBytes.length > bytes.length) return -1;
    let match = true;
    for (let j = 1; j < sigBytes.length; j++) {
      if (bytes[idx + j] !== sigBytes[j]) {
        match = false;
        break;
      }
    }
    if (match) return idx;
    searchIdx = idx + 1;
  }
}

export function findAllEmbeddedBlockSignatures(bytes: Uint8Array, sigBytes: number[]): number[] {
  const matches: number[] = [];
  if (bytes.length < sigBytes.length) return matches;
  const firstByte = sigBytes[0];
  let searchIdx = 0;
  while (true) {
    const idx = bytes.indexOf(firstByte, searchIdx);
    if (idx === -1 || idx + sigBytes.length > bytes.length) break;
    let match = true;
    for (let j = 1; j < sigBytes.length; j++) {
      if (bytes[idx + j] !== sigBytes[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      matches.push(idx);
    }
    searchIdx = idx + 1;
  }
  return matches;
}

interface IceBitReader {
  getBit(): number;
  getBits(n: number): number;
  readRawByte(): number;
}

// Emulates Motorola 68000: add.b d7, d7 / bne / move.b -(a5), d7 / roxl.b #1, d7
function createBitReader24(src: Uint8Array, startIdx: number): IceBitReader | null {
  let src_idx = startIdx;
  if (src_idx <= 0) return null;
  let d7 = src[--src_idx];
  
  return {
    getBit() {
      let bit = (d7 >>> 7) & 1;
      d7 = (d7 << 1) & 0xFF;
      if (d7 === 0) {
        if (src_idx <= 0) throw new Error("OOB");
        let new_byte = src[--src_idx];
        bit = (new_byte >>> 7) & 1;
        d7 = ((new_byte << 1) | 1) & 0xFF; // Carry flag (1) goes to LSB
      }
      return bit;
    },
    getBits(n: number) {
      let val = 0;
      for (let i = 0; i < n; i++) val = (val << 1) | this.getBit();
      return val;
    },
    readRawByte() {
      if (src_idx <= 0) throw new Error("OOB");
      return src[--src_idx];
    }
  };
}

// Emulates Motorola 68000: add.l d7, d7 / bne / move.l -(a5), d7 / roxl.l #1, d7
function createBitReader21(src: Uint8Array, startIdx: number): IceBitReader | null {
  let src_idx = startIdx;
  if (src_idx < 4) return null;
  src_idx -= 4;
  let d7 = readUint32BE(src, src_idx);
  
  return {
    getBit() {
      let bit = (d7 >>> 31) & 1;
      d7 = (d7 << 1) >>> 0;
      if (d7 === 0) {
        if (src_idx < 4) throw new Error("OOB");
        src_idx -= 4;
        let new_word = readUint32BE(src, src_idx);
        bit = (new_word >>> 31) & 1;
        d7 = ((new_word << 1) | 1) >>> 0; // Carry flag (1) goes to LSB
      }
      return bit;
    },
    getBits(n: number) {
      let val = 0;
      for (let i = 0; i < n; i++) val = (val << 1) | this.getBit();
      return val;
    },
    readRawByte() {
      if (src_idx <= 0) throw new Error("OOB");
      return src[--src_idx]; // 68k move.b -(a5) natively shares the bitstream pointer!
    }
  };
}

function decompressPackIceInternal(
  bytes: Uint8Array,
  start: number,
  isIce21: boolean,
  packedSize: number,
  origSize: number,
  initialSrcIdx: number
): Uint8Array | null {
  const src = bytes.subarray(start);
  const dst = new Uint8Array(origSize);
  let p_idx = origSize;

  let src_idx = initialSrcIdx;
  if (src_idx > src.length) src_idx = src.length;

  const br = isIce21 ? createBitReader21(src, src_idx) : createBitReader24(src, src_idx);
  if (!br) return null;

  const lenbits = [1, 2, 2, 3, 8, 15];
  const maxlen = [1, 3, 3, 7, 255, 32767];
  const literalOffset = [1, 2, 5, 8, 15, 270];

  try {
    while (p_idx > 0) {
      if (br.getBit()) { 
        // --- LITERAL COPY ---
        let tablepos = 0;
        let len = 0;
        while (tablepos < 6) {
          len = br.getBits(lenbits[tablepos]);
          if (len !== maxlen[tablepos] || tablepos === 5) {
            len += literalOffset[tablepos];
            break;
          }
          tablepos++;
        }
        
        if (p_idx < len) len = p_idx;
        
        for (let i = 0; i < len; i++) {
          p_idx--;
          dst[p_idx] = br.readRawByte();
        }
      }

      if (p_idx <= 0) break;

      // --- MATCH COPY ---
      const extra_bits1 = [0, 0, 1, 2, 10];
      const sldOffset1 = [0, 1, 2, 4, 8];
      let tablepos = 0;
      
      while (tablepos < 4 && br.getBit()) tablepos++;
      
      let len_raw = sldOffset1[tablepos] + br.getBits(extra_bits1[tablepos]);
      let pos = 0;
      
      if (len_raw !== 0) {
        const extra_bits2 = [8, 5, 12];
        const sldOffset2 = [32, 0, 288];
        let tablepos2 = 0;
        while (tablepos2 < 2 && br.getBit()) tablepos2++;
        
        pos = sldOffset2[tablepos2] + br.getBits(extra_bits2[tablepos2]);
        
        // Per Ancient: 2.4 incorporates raw length directly into pos if pos != 0
        if (!isIce21 && pos !== 0) {
          pos += len_raw;
        }
      } else {
        if (br.getBit()) pos = 64 + br.getBits(9);
        else pos = br.getBits(6);
      }
      
      let len = len_raw + 2;
      
      // Match distance resolution mapping to Ancient C++ implementations
      let copyDistance = isIce21 ? (pos + len) : (pos + 1);
      
      if (p_idx < len) len = p_idx;
      
      for (let i = 0; i < len; i++) {
        p_idx--;
        let src_copy = p_idx + copyDistance;
        if (p_idx < 0 || src_copy >= dst.length) throw new Error("OOB copy");
        dst[p_idx] = dst[src_copy];
      }
    }

    // --- PICTURE CHUNKY DECRUNCH (Optional Payload flag) ---
    if (br.getBit()) {
      let pic_idx = origSize;
      const picIterations = Math.min(4000, Math.floor(origSize / 8));
      for (let i = 0; i < picIterations; i++) {
        let d0 = 0, d1 = 0, d2 = 0, d3 = 0;
        for (let j = 0; j < 4; j++) {
          pic_idx -= 2;
          if (pic_idx < 0) throw new Error("Pic OOB");
          let d4 = (dst[pic_idx] << 8) | dst[pic_idx + 1];
          for (let k = 0; k < 4; k++) {
            d0 = ((d0 << 1) | ((d4 >> 15) & 1)) >>> 0; d4 = (d4 << 1) & 0xFFFF;
            d1 = ((d1 << 1) | ((d4 >> 15) & 1)) >>> 0; d4 = (d4 << 1) & 0xFFFF;
            d2 = ((d2 << 1) | ((d4 >> 15) & 1)) >>> 0; d4 = (d4 << 1) & 0xFFFF;
            d3 = ((d3 << 1) | ((d4 >> 15) & 1)) >>> 0; d4 = (d4 << 1) & 0xFFFF;
          }
        }
        dst[pic_idx]     = (d0 >> 8) & 0xFF; 
        dst[pic_idx + 1] = d0 & 0xFF;
        dst[pic_idx + 2] = (d1 >> 8) & 0xFF; 
        dst[pic_idx + 3] = d1 & 0xFF;
        dst[pic_idx + 4] = (d2 >> 8) & 0xFF; 
        dst[pic_idx + 5] = d2 & 0xFF;
        dst[pic_idx + 6] = (d3 >> 8) & 0xFF; 
        dst[pic_idx + 7] = d3 & 0xFF;
      }
    }
    
    return dst;

  } catch (e) {
    return null; 
  }
}

export function decompressPackIce(bytes: Uint8Array, offset?: number): Uint8Array | null {
  const candidates: {
    start: number;
    isIce21: boolean;
    forcedOrigSize: number;
    forcedPackedSize: number;
    forcedSrcIdx: number;
  }[] = [];

  const seen = new Set<string>();
  const addCandidate = (start: number, isIce21: boolean, origSize: number, packedSize: number, srcIdx: number) => {
    if (origSize <= 0 || origSize > 0x800000) return;
    if (packedSize <= 0 || packedSize > bytes.length) return;
    if (srcIdx <= 0 || srcIdx > bytes.length - start) return;
    
    const key = `${start}_${isIce21}_${origSize}_${srcIdx}`;
    if (seen.has(key)) return;
    seen.add(key);

    candidates.push({
      start,
      isIce21,
      forcedOrigSize: origSize,
      forcedPackedSize: packedSize,
      forcedSrcIdx: srcIdx
    });
  };

  if (offset !== undefined) {
    let isIce21 = false;
    if (offset >= 0 && offset + 4 <= bytes.length) {
      if (bytes[offset] === 0x49 && bytes[offset + 1] === 0x63 && bytes[offset + 2] === 0x65 && bytes[offset + 3] === 0x21) {
        isIce21 = true;
      }
    }
    let packedSize = 0;
    let origSize = 0;
    if (offset + 12 <= bytes.length) {
      packedSize = readUint32BE(bytes, offset + 4);
      origSize = readUint32BE(bytes, offset + 8);
    }
    if (packedSize > 0 && origSize > 0) {
      for (const d of [0, 12, 8, -1, -2, -4]) {
        addCandidate(offset + 12, isIce21, origSize, packedSize, packedSize + d);
        addCandidate(offset, isIce21, origSize, packedSize, packedSize + d);
      }
    } else {
      addCandidate(offset, isIce21, 32000, bytes.length - offset, bytes.length - offset);
    }
  } else {
    // Phase 1: Scanning for raw ICE signatures
    const sigs = [
      { prefix: [0x49, 0x43, 0x45, 0x21], isIce21: false }, // ICE!
      { prefix: [0x49, 0x63, 0x65, 0x21], isIce21: true }   // Ice!
    ];

    let foundIceSig = false;
    for (const { prefix, isIce21 } of sigs) {
      const starts = findAllEmbeddedBlockSignatures(bytes, prefix);
      for (const start of starts) {
        foundIceSig = true;
        if (start + 12 <= bytes.length) {
          const packedSize = readUint32BE(bytes, start + 4);
          const origSize = readUint32BE(bytes, start + 8);
          if (packedSize > 0 && packedSize <= bytes.length && origSize > 0 && origSize <= 0x800000) {
            for (let d = -256; d <= 256; d++) {
              addCandidate(start, isIce21, origSize, packedSize, packedSize + 12 + d);
              addCandidate(start + 12, isIce21, origSize, packedSize, packedSize + d);
            }
          }
        }
      }
    }

    if (!foundIceSig) {
      // If no raw ICE signature was found anywhere, doing trial/heuristic deep scanning
      // across millions of assemblies is highly expensive and triggers hangs.
      // We skip Phases 2-4 for auto-depacking unless a packer signature suggestion or ASCII Pack-Ice string exists.
      const packerSig = detectPackerSignature(bytes);
      const fileString = bytesToAsciiScan(bytes.subarray(0, Math.min(bytes.length, 4096)));
      
      const probabilityIce = packerSig.includes("Pack-Ice") || fileString.includes("Pack-Ice") || fileString.includes("ICE!");
      if (!probabilityIce) {
        return null; // Fast path rejection: absolutely not a Pack-Ice file!
      }
    }

    // Phase 2: Extracting PRG payload dimensions
    const possibleEnds: number[] = [bytes.length];
    if (bytes.length >= 28 && bytes[0] === 0x60 && (bytes[1] === 0x1A || bytes[1] === 0x1C || bytes[1] === 0x00)) {
      const ts = readUint32BE(bytes, 2);
      const ds = readUint32BE(bytes, 6);
      const ss = readUint32BE(bytes, 14);
      if (ts + ds + ss > 0 && 28 + ts + ds + ss <= bytes.length) {
        possibleEnds.push(28 + ts + ds + ss);
      }
      if (ts + ds > 0 && 28 + ts + ds <= bytes.length) {
        possibleEnds.push(28 + ts + ds);
      }
      if (ts > 0 && 28 + ts <= bytes.length) {
        possibleEnds.push(28 + ts);
      }
    }

    // Phase 3: Deep-scanning assembly for 16/32-bit sizes
    const immSizes: number[] = [];
    const codeScanEnd = Math.min(bytes.length - 6, 4096);
    for (let i = 28; i < codeScanEnd; i += 2) {
      const op = bytes[i];
      const mode = bytes[i + 1];
      // MOVE.L #imm, Dn/An
      if (op >= 0x20 && op <= 0x2E && (mode === 0x3C || mode === 0x7C)) {
        const val = readUint32BE(bytes, i + 2);
        if (val > 1000 && val <= 0x800000) {
          immSizes.push(val);
        }
      }
      // MOVE.W #imm, Dn/An
      if (((op >= 0x10 && op <= 0x1E) || (op >= 0x30 && op <= 0x3E)) && (mode === 0x3C || mode === 0x7C)) {
        const val = (bytes[i + 2] << 8) | bytes[i + 3];
        if (val > 1000 && val < 0x800000) {
          immSizes.push(val, val + 32, val + 34, val + 66, val + 128);
        }
      }
    }

    // Trial original sizes
    const trialOrigSizes = Array.from(new Set([...immSizes, 32000, 32034, 32066, 32128]));
    
    // Trial starts
    let searchStart = 0;
    const axIdx = bytesToAsciiScan(bytes.subarray(0, Math.min(bytes.length, 2048))).indexOf("Axe/Delight");
    if (axIdx >= 0) {
      searchStart = axIdx + 12;
    }
    const trialStarts = Array.from(new Set([
      searchStart, searchStart + 12, searchStart + 24,
      0, 2, 12, 14, 28, 30, 32, 40, 64, 120, 128, 160, 230, 256
    ])).filter(s => s >= 0);

    // Enormous padding sweep: delta from -1024 to 256
    const deltas: number[] = [];
    for (let d = -1024; d <= 256; d++) {
      deltas.push(d);
    }

    // Assemble candidate matrix
    for (const prgEnd of possibleEnds) {
      const validStarts = trialStarts.filter(s => s < prgEnd);
      for (const start of validStarts) {
        const packSize = prgEnd - start;
        if (packSize <= 0) continue;

        for (const isIce21 of [true, false]) {
          for (const origSize of trialOrigSizes) {
            if (origSize <= packSize) continue; // Original decompressed size must always be strictly greater than packed size!
            for (const delta of deltas) {
              const srcIdx = packSize + delta;
              addCandidate(start, isIce21, origSize, packSize, srcIdx);
            }
          }
        }
      }
    }
  }

  // Try each candidate configuration
  for (const cand of candidates) {
    try {
      const result = decompressPackIceInternal(
        bytes,
        cand.start,
        cand.isIce21,
        cand.forcedPackedSize,
        cand.forcedOrigSize,
        cand.forcedSrcIdx
      );
      if (result !== null) {
        return result;
      }
    } catch (e) {
      // Fallback to next configuration
    }
  }

  return null;
}

class BackwardInputStream {
  private buffer: Uint8Array;
  private currentOffset: number;
  private endOffset: number;

  constructor(buffer: Uint8Array, startOffset: number, endOffset: number) {
    this.buffer = buffer;
    this.currentOffset = endOffset;
    this.endOffset = startOffset;
    if (this.currentOffset < this.endOffset || this.currentOffset > buffer.length || this.endOffset > buffer.length) {
      throw new Error("DecompressionError");
    }
  }

  eof(): boolean {
    return this.currentOffset <= this.endOffset;
  }

  readByte(): number {
    if (this.currentOffset <= this.endOffset) {
      throw new Error("DecompressionError");
    }
    this.currentOffset--;
    return this.buffer[this.currentOffset];
  }

  readBE16(): number {
    const b0 = this.readByte();
    const b1 = this.readByte();
    return (b1 << 8) | b0;
  }

  readBE32(): number {
    const b0 = this.readByte();
    const b1 = this.readByte();
    const b2 = this.readByte();
    const b3 = this.readByte();
    return (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
  }

  readLE16(): number {
    const b0 = this.readByte();
    const b1 = this.readByte();
    return (b0 << 8) | b1;
  }
}

class BackwardOutputStream {
  private buffer: Uint8Array;
  private startOffset: number;
  private currentOffset: number;
  private endOffset: number;

  constructor(buffer: Uint8Array, startOffset: number, endOffset: number) {
    this.buffer = buffer;
    this.startOffset = startOffset;
    this.currentOffset = endOffset;
    this.endOffset = endOffset;
    if (this.startOffset > this.endOffset || this.currentOffset > buffer.length || this.endOffset > buffer.length) {
      throw new Error("DecompressionError");
    }
  }

  eof(): boolean {
    return this.currentOffset <= this.startOffset;
  }

  getOffset(): number {
    return this.currentOffset;
  }

  writeByte(value: number) {
    if (this.currentOffset <= this.startOffset) {
      throw new Error("DecompressionError");
    }
    this.currentOffset--;
    this.buffer[this.currentOffset] = value;
  }

  copy(distance: number, count: number, defaultChar?: number): number {
    if (distance <= 0) {
      throw new Error("DecompressionError");
    }
    
    if (defaultChar !== undefined) {
      if (this.startOffset + count > this.currentOffset) {
        throw new Error("DecompressionError");
      }
      let prevCount = 0;
      let ret = 0;
      if (this.currentOffset + distance > this.endOffset) {
        prevCount = Math.min(count, this.currentOffset + distance - this.endOffset);
        for (let i = 0; i < prevCount; i++) {
          this.currentOffset--;
          this.buffer[this.currentOffset] = defaultChar;
          ret = defaultChar;
        }
      }
      for (let i = prevCount; i < count; i++) {
        this.currentOffset--;
        ret = this.buffer[this.currentOffset] = this.buffer[this.currentOffset + distance];
      }
      return ret;
    } else {
      if (this.startOffset + count > this.currentOffset || this.currentOffset + distance > this.endOffset) {
        throw new Error("DecompressionError");
      }
      let ret = 0;
      for (let i = 0; i < count; i++) {
        this.currentOffset--;
        ret = this.buffer[this.currentOffset] = this.buffer[this.currentOffset + distance];
      }
      return ret;
    }
  }
}

class MSBBitReader {
  private inputStream: BackwardInputStream;
  private _bufContent: number = 0;
  private _bufLength: number = 0;

  constructor(inputStream: BackwardInputStream) {
    this.inputStream = inputStream;
  }

  readBits8(count: number): number {
    return this.readBitsGeneric(count, () => {
      return { val: this.inputStream.readByte(), len: 8 };
    });
  }

  getBufContent(): number {
    return this._bufContent;
  }

  getBufLength(): number {
    return this._bufLength;
  }

  reset(bufContent: number = 0, bufLength: number = 0) {
    this._bufContent = bufContent;
    this._bufLength = bufLength;
  }

  private readBitsGeneric(count: number, readWord: () => { val: number; len: number }): number {
    let ret = 0;
    while (count > 0) {
      if (!this._bufLength) {
        const { val, len } = readWord();
        this._bufContent = val;
        this._bufLength = len;
      }
      const maxCount = Math.min(count, this._bufLength);
      this._bufLength -= maxCount;
      ret = (ret << maxCount) | ((this._bufContent >> this._bufLength) & ((1 << maxCount) - 1));
      count -= maxCount;
    }
    return ret;
  }
}

class LSBBitReader {
  private inputStream: BackwardInputStream;
  private _bufContent: number = 0;
  private _bufLength: number = 0;

  constructor(inputStream: BackwardInputStream) {
    this.inputStream = inputStream;
  }

  readBits8(count: number): number {
    return this.readBitsGeneric(count, () => {
      return { val: this.inputStream.readByte(), len: 8 };
    });
  }

  getBufContent(): number {
    return this._bufContent;
  }

  getBufLength(): number {
    return this._bufLength;
  }

  reset(bufContent: number = 0, bufLength: number = 0) {
    this._bufContent = bufContent;
    this._bufLength = bufLength;
  }

  private readBitsGeneric(count: number, readWord: () => { val: number; len: number }): number {
    let ret = 0;
    let pos = 0;
    while (count > 0) {
      if (!this._bufLength) {
        const { val, len } = readWord();
        this._bufContent = val;
        this._bufLength = len;
      }
      const maxCount = Math.min(count, this._bufLength);
      ret |= (this._bufContent & ((1 << maxCount) - 1)) << pos;
      this._bufContent >>= maxCount;
      this._bufLength -= maxCount;
      count -= maxCount;
      pos += maxCount;
    }
    return ret;
  }
}

class VariableLengthCodeDecoder {
  bitLengths: number[];
  offsets: number[];

  constructor(...args: number[]) {
    this.bitLengths = args.map(v => Math.abs(v));
    this.offsets = [];
    let length = 0;
    for (let i = 0; i < args.length; i++) {
       const val = args[i];
       if (val < 0) {
         this.offsets[i] = 0;
         length = 1 << (-val);
       } else {
         this.offsets[i] = length;
         length += (1 << val);
       }
    }
  }

  decode(bitReaderFn: (count: number) => number, base: number): number {
    if (base >= this.bitLengths.length) {
      throw new Error("DecompressionError");
    }
    return this.offsets[base] + bitReaderFn(this.bitLengths[base]);
  }

  decodeCascade(bitReaderFn: (count: number) => number): number {
    const N = this.bitLengths.length;
    for (let i = 0; i < N; i++) {
      const len = this.bitLengths[i];
      if (!len) {
        throw new Error("DecompressionError");
      }
      const tmp = bitReaderFn(len);
      if (i === N - 1 || tmp !== (1 << len) - 1) {
        return this.offsets[i] - i + tmp;
      }
    }
    throw new Error("DecompressionError");
  }
}

class DynamicHuffmanDecoder {
  private readonly maxCount = 314;
  private _initialCount: number;
  private _count: number = 0;
  private _nodes: {
    frequency: number;
    index: number;
    parent: number;
    leftLeaf: number;
    rightLeaf: number;
  }[];
  private _codeMap: Uint32Array;

  constructor(initialCount: number = 314) {
    this._initialCount = initialCount;
    this._nodes = Array.from({ length: this.maxCount * 2 - 1 }, () => ({
      frequency: 0,
      index: 0,
      parent: 0,
      leftLeaf: 0,
      rightLeaf: 0
    }));
    this._codeMap = new Uint32Array(this.maxCount * 2 - 1);
    this.reset();
  }

  reset() {
    this._count = this._initialCount;
    if (!this._count) return;
    for (let i = 0; i < this._count; i++) {
      this._nodes[i].frequency = 1;
      this._nodes[i].index = i + (this.maxCount - this._count) * 2;
      this._nodes[i].parent = this.maxCount * 2 - this._count + (i >> 1);
      this._nodes[i].leftLeaf = 0;
      this._nodes[i].rightLeaf = 0;
      this._codeMap[i + (this.maxCount - this._count) * 2] = i;
    }
    for (let i = this.maxCount * 2 - this._count, j = 0; i < this.maxCount * 2 - 1; i++, j += 2) {
      const l = (j >= this._count) ? j + (this.maxCount - this._count) * 2 : j;
      const r = (j + 1 >= this._count) ? j + 1 + (this.maxCount - this._count) * 2 : (j + 1);
      this._nodes[i].frequency = this._nodes[l].frequency + this._nodes[r].frequency;
      this._nodes[i].index = i;
      this._nodes[i].parent = this.maxCount + (i >> 1);
      this._nodes[i].leftLeaf = l;
      this._nodes[i].rightLeaf = r;
      this._codeMap[i] = i;
    }
  }

  decode(bitReader: () => number): number {
    if (!this._count) {
      throw new Error("DecompressionError");
    }
    if (this._count === 1) return 0;
    let code = this.maxCount * 2 - 2;
    while (code >= this.maxCount) {
      code = bitReader() ? this._nodes[code].rightLeaf : this._nodes[code].leftLeaf;
    }
    return code;
  }

  update(code: number) {
    if (code >= this._count) {
      throw new Error("DecompressionError");
    }
    if (this._count === 1) {
      this._nodes[0].frequency = 1;
      return;
    }

    while (code !== this.maxCount * 2 - 2) {
      this._nodes[code].frequency++;

      const index = this._nodes[code].index;
      let destIndex = index;
      const freq = this._nodes[code].frequency;

      while (destIndex !== this.maxCount * 2 - 2 && freq > this._nodes[this._codeMap[destIndex + 1]].frequency) {
        destIndex++;
      }
      if (index !== destIndex) {
        const getParentLeafRef = (currentCode: number): { obj: any; key: 'leftLeaf' | 'rightLeaf' } => {
          const parent = this._nodes[this._nodes[currentCode].parent];
          if (parent.leftLeaf === currentCode) {
            return { obj: parent, key: 'leftLeaf' };
          } else {
            return { obj: parent, key: 'rightLeaf' };
          }
        };

        const destCode = this._codeMap[destIndex];
        
        const tempIndex = this._nodes[code].index;
        this._nodes[code].index = this._nodes[destCode].index;
        this._nodes[destCode].index = tempIndex;

        const tempCodeMap = this._codeMap[index];
        this._codeMap[index] = this._codeMap[destIndex];
        this._codeMap[destIndex] = tempCodeMap;

        const refA = getParentLeafRef(code);
        const refB = getParentLeafRef(destCode);
        const valA = refA.obj[refA.key];
        refA.obj[refA.key] = refB.obj[refB.key];
        refB.obj[refB.key] = valA;

        const tempParent = this._nodes[code].parent;
        this._nodes[code].parent = this._nodes[destCode].parent;
        this._nodes[destCode].parent = tempParent;
      }
      code = this._nodes[code].parent;
    }
    this._nodes[code].frequency++;
  }

  halve() {
    if (!this._count) return;
    if (this._count === 1) {
      this._nodes[0].frequency = (this._nodes[0].frequency + 1) >> 1;
      return;
    }

    for (let i = (this.maxCount - this._count) * 2, j = (this.maxCount - this._count) * 2; i < this.maxCount * 2 - 1 && j < this.maxCount * 2 - this._count; i++) {
      if (this._codeMap[i] < this.maxCount) {
        this._nodes[this._codeMap[i]].index = j++;
      }
    }

    for (let i = 0; i < this._count; i++) {
      this._nodes[i].frequency = (this._nodes[i].frequency + 1) >> 1;
      this._nodes[i].parent = this.maxCount + (this._nodes[i].index >> 1);
      this._codeMap[this._nodes[i].index] = i;
    }

    for (let i = this.maxCount * 2 - this._count, j = (this.maxCount - this._count) * 2; i < this.maxCount * 2 - 1; i++, j += 2) {
      const l = this._codeMap[j];
      const r = this._codeMap[j + 1];
      const freq = this._nodes[l].frequency + this._nodes[r].frequency;
      this._nodes[i].frequency = freq;
      this._nodes[i].index = i;
      this._nodes[i].parent = this.maxCount + (i >> 1);
      this._nodes[i].leftLeaf = l;
      this._nodes[i].rightLeaf = r;
      this._codeMap[i] = i;

      for (let k = i; k > 0 && freq < this._nodes[this._codeMap[k - 1]].frequency; k--) {
        const code = this._codeMap[k];
        const destCode = this._codeMap[k - 1];

        const tempIndex = this._nodes[code].index;
        this._nodes[code].index = this._nodes[destCode].index;
        this._nodes[destCode].index = tempIndex;

        const tempParent = this._nodes[code].parent;
        this._nodes[code].parent = this._nodes[destCode].parent;
        this._nodes[destCode].parent = tempParent;

        const tempMap = this._codeMap[k];
        this._codeMap[k] = this._codeMap[k - 1];
        this._codeMap[k - 1] = tempMap;
      }
    }
  }

  getMaxFrequency(): number {
    return this._nodes[this.maxCount * 2 - 2].frequency;
  }
}

function decompressInternalV2(packedData: Uint8Array, rawSize: number, packedSize: number): Uint8Array {
  const inputStream = new BackwardInputStream(packedData, 12, packedSize);
  const bitReader = new MSBBitReader(inputStream);

  const readBits = (count: number) => bitReader.readBits8(count);
  const readByte = () => inputStream.readByte();

  // anchor-bit handling
  {
    if (inputStream.readBE16() & 0x8000) {
      readByte(); // align byte
    }
    const tmp = readByte();
    for (let i = 1, j = 7; i < 0x80; i <<= 1, j--) {
      if (tmp & i) {
        bitReader.reset(tmp >> (8 - j), j);
        break;
      }
    }
  }

  const rawData = new Uint8Array(rawSize);
  const outputStream = new BackwardOutputStream(rawData, 0, rawSize);

  const litVlcDecoder = new VariableLengthCodeDecoder(1, 2, 2, 3, 10);
  const countBaseDecoder = new VariableLengthCodeDecoder(1, 1, 1, 1);
  const countDecoder = new VariableLengthCodeDecoder(0, 0, 1, 2, 10);
  const distanceBaseDecoder = new VariableLengthCodeDecoder(1, 1);
  const distanceDecoder = new VariableLengthCodeDecoder(5, 8, 12);

  for (;;) {
    if (readBits(1)) {
      const litLength = litVlcDecoder.decodeCascade(readBits) + 1;
      for (let i = 0; i < litLength; i++) {
        outputStream.writeByte(readByte());
      }
    }
    // exit criteria
    if (outputStream.eof()) break;

    const countBase = countBaseDecoder.decodeCascade(readBits);
    const count = countDecoder.decode(readBits, countBase) + 2;
    let distance = 0;
    if (count === 2) {
      if (readBits(1)) {
        distance = readBits(9) + 0x40;
      } else {
        distance = readBits(6);
      }
    } else {
      let distanceBase = distanceBaseDecoder.decodeCascade(readBits);
      if (distanceBase < 2) distanceBase ^= 1;
      distance = distanceDecoder.decode(readBits, distanceBase);
    }
    distance += count;
    outputStream.copy(distance, count);
  }

  if (!inputStream.eof()) {
    throw new Error("DecompressionError");
  }

  return rawData;
}

function decompressInternalLZH(packedData: Uint8Array, rawSize: number, packedSize: number): Uint8Array {
  const inputStream = new BackwardInputStream(packedData, 12, packedSize);
  const bitReader = new MSBBitReader(inputStream);

  const readBit = () => bitReader.readBits8(1);
  const readBits = (count: number) => bitReader.readBits8(count);

  const rawData = new Uint8Array(rawSize);
  const outputStream = new BackwardOutputStream(rawData, 0, rawSize);

  const decoder = new DynamicHuffmanDecoder(314);
  const vlcDecoder = new VariableLengthCodeDecoder(5, 5, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10);

  while (!outputStream.eof()) {
    const symbol = decoder.decode(readBit);
    if (decoder.getMaxFrequency() === 0x8000) {
      decoder.halve();
    }
    decoder.update(symbol);
    if (symbol < 256) {
      outputStream.writeByte(symbol);
    } else {
      const distance = vlcDecoder.decode(readBits, readBits(4)) + 1;
      const count = symbol - 253;
      outputStream.copy(distance, count, 0x20);
    }
  }

  if (!inputStream.eof()) {
    throw new Error("DecompressionError");
  }

  return rawData;
}

function decompressInternalLZW(packedData: Uint8Array, rawSize: number, packedSize: number): Uint8Array {
  const inputStream = new BackwardInputStream(packedData, 12, packedSize);
  const bitReader = new LSBBitReader(inputStream);

  const readBit = () => bitReader.readBits8(1);
  const readByte = () => inputStream.readByte();

  const rawData = new Uint8Array(rawSize);
  const outputStream = new BackwardOutputStream(rawData, 0, rawSize);

  while (!outputStream.eof()) {
    if (readBit()) {
      outputStream.writeByte(readByte());
    } else {
      const byte1 = readByte();
      const byte2 = readByte();
      const code = byte1 | ((byte2 & 0xf0) << 4);
      const count = (byte2 & 0xf) + 3;
      
      const distance = ((0xfed + rawSize - outputStream.getOffset() - code) & 0xfff) + 1;
      if (distance + outputStream.getOffset() >= rawSize) {
        for (let i = 0; i < count; i++) {
          outputStream.writeByte(0x20);
        }
      } else {
        outputStream.copy(distance, count);
      }
    }
  }

  if (!inputStream.eof()) {
    throw new Error("DecompressionError");
  }

  return rawData;
}

export function decompressJam(bytes: Uint8Array, offset?: number): Uint8Array | null {
  if (offset !== undefined) {
    return decompressJamAtOffset(bytes, offset);
  }

  // Scanning mode (when no offset is provided)
  // First, check offset 0 as a fast path
  const resStart = decompressJamAtOffset(bytes, 0);
  if (resStart !== null) return resStart;

  // Otherwise, scan the entire file for the signatures: LSD!, LZH!, LZW!
  // JAM-packer self-extracting executables contain the signature embedded in the file.
  for (let i = 1; i <= bytes.length - 12; i++) {
    const hdr0 = bytes[i];
    const hdr1 = bytes[i + 1];
    const hdr2 = bytes[i + 2];
    const hdr3 = bytes[i + 3];
    
    // Check if we hit LSD!, LZH!, or LZW!
    const isLsd = (hdr0 === 0x4C && hdr1 === 0x53 && hdr2 === 0x44 && hdr3 === 0x21); // LSD!
    const isLzh = (hdr0 === 0x4C && hdr1 === 0x5A && hdr2 === 0x48 && hdr3 === 0x21); // LZH!
    const isLzw = (hdr0 === 0x4C && hdr1 === 0x5A && hdr2 === 0x57 && hdr3 === 0x21); // LZW!
    
    if (isLsd || isLzh || isLzw) {
      const res = decompressJamAtOffset(bytes, i);
      if (res !== null) return res;
    }
  }

  return null;
}

function decompressJamAtOffset(bytes: Uint8Array, offset: number): Uint8Array | null {
  if (bytes.length - offset < 12) return null;

  const hdr0 = bytes[offset];
  const hdr1 = bytes[offset + 1];
  const hdr2 = bytes[offset + 2];
  const hdr3 = bytes[offset + 3];
  
  const isLsd = (hdr0 === 0x4C && hdr1 === 0x53 && hdr2 === 0x44 && hdr3 === 0x21); // LSD!
  const isLzh = (hdr0 === 0x4C && hdr1 === 0x5A && hdr2 === 0x48 && hdr3 === 0x21); // LZH!
  const isLzw = (hdr0 === 0x4C && hdr1 === 0x5A && hdr2 === 0x57 && hdr3 === 0x21); // LZW!

  if (!isLsd && !isLzh && !isLzw) return null;

  const rawSize = readUint32BE(bytes, offset + 4);
  let packedSize = readUint32BE(bytes, offset + 8);

  if (isLsd) {
    packedSize += 4;
  } else if (isLzh) {
    packedSize += 12;
  }

  if (offset + packedSize > bytes.length || rawSize <= 0 || rawSize > 0x800000) {
    return null;
  }

  try {
    const sliced = bytes.subarray(offset, offset + packedSize);
    if (isLsd) {
      return decompressInternalV2(sliced, rawSize, packedSize);
    } else if (isLzh) {
      return decompressInternalLZH(sliced, rawSize, packedSize);
    } else if (isLzw) {
      return decompressInternalLZW(sliced, rawSize, packedSize);
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Rob Northen Compression (RNC Format)
export function decompressRNC(bytes: Uint8Array, offset?: number): Uint8Array | null {
  let start = offset !== undefined ? offset : findEmbeddedBlockSignature(bytes, [0x52, 0x4E, 0x43, 0x01]);
  let rncStart = start;
  if (rncStart < 0) {
    rncStart = findEmbeddedBlockSignature(bytes, [0x52, 0x4E, 0x43, 0x02]);
  }
  if (rncStart < 0 || rncStart + 18 > bytes.length) return null;

  const method = bytes[rncStart + 3];
  if (method !== 0x01 && method !== 0x02) return null;

  const outSize = readUint32BE(bytes, rncStart + 4);
  if (outSize === 0 || outSize > 0x800000) return null;

  const data = bytes.subarray(rncStart);
  return method === 0x02 ? decompressRNCMethod2(data, outSize) : decompressRNCMethod1(data, outSize);
}

function decompressRNCMethod2(data: Uint8Array, outSize: number): Uint8Array | null {
  const output = new Uint8Array(outSize);
  let outPos = 0;
  let inPos = 18;
  let bitBuf = 0;
  let bitsLeft = 0;

  function getBit() {
    if (bitsLeft === 0) {
      if (inPos >= data.length) return 0;
      bitBuf = data[inPos++];
      bitsLeft = 8;
    }
    const bit = bitBuf & 1;
    bitBuf >>= 1;
    bitsLeft--;
    return bit;
  }

  function getByte() {
    return inPos < data.length ? data[inPos++] : 0;
  }

  function getBits(n: number) {
    let val = 0;
    for (let i = 0; i < n; i++) val = (val << 1) | getBit();
    return val;
  }

  function getOffset() {
    if (!getBit()) {
      const b1 = getByte();
      const b2 = getByte();
      return ((b1 << 8) | b2) + 1;
    }
    const b1 = getByte();
    const b2 = getByte();
    return (((b1 << 8) | b2) | 0x10000) + 1;
  }

  getBits(2);

  while (outPos < outSize && inPos < data.length) {
    if (!getBit()) {
      output[outPos++] = getByte();
    } else if (!getBit()) {
      let length = 4 + getBit();
      if (getBit()) {
        length = (length - 1) * 2 + getBit();
        if (length === 9) {
          length = (getBits(4) + 3) * 4;
          for (let i = 0; i < length && outPos < outSize; i++) output[outPos++] = getByte();
          continue;
        }
      }
      const offset = getOffset();
      for (let i = 0; i < length && outPos < outSize; i++) {
        output[outPos] = output[outPos - offset];
        outPos++;
      }
    } else if (!getBit()) {
      const offset = getByte() + 1;
      const length = 2;
      for (let i = 0; i < length && outPos < outSize; i++) {
        output[outPos] = output[outPos - offset];
        outPos++;
      }
    } else if (!getBit()) {
      const offset = getOffset();
      let length = 3;
      for (let i = 0; i < length && outPos < outSize; i++) {
        output[outPos] = output[outPos - offset];
        outPos++;
      }
    } else if (!getBit()) {
      let length = getByte() + 8;
      if (length === 8) { getBit(); continue; }
      const offset = getOffset();
      for (let i = 0; i < length && outPos < outSize; i++) {
        output[outPos] = output[outPos - offset];
        outPos++;
      }
    } else {
      let length = getByte() + 8;
      const offset = getOffset();
      for (let i = 0; i < length && outPos < outSize; i++) {
        output[outPos] = output[outPos - offset];
        outPos++;
      }
    }
  }
  return outPos > 0 ? output : null;
}

interface HuffTree {
  lengths: Uint8Array;
  codes: Uint16Array;
  maxLen: number;
  numSymbols: number;
}

function decompressRNCMethod1(data: Uint8Array, outSize: number): Uint8Array | null {
  const output = new Uint8Array(outSize);
  let outPos = 0;
  let inPos = 18;
  let bitBuf = 0;
  let bitsLeft = 0;

  function getBit() {
    if (bitsLeft === 0) {
      if (inPos + 1 >= data.length) return 0;
      bitBuf = data[inPos] | (data[inPos + 1] << 8);
      inPos += 2;
      bitsLeft = 16;
    }
    const bit = bitBuf & 1;
    bitBuf >>= 1;
    bitsLeft--;
    return bit;
  }

  function getBits(n: number) {
    let val = 0;
    for (let i = 0; i < n; i++) val = (val << 1) | getBit();
    return val;
  }

  function buildHuffDecoder(numSymbols: number): HuffTree {
    const lengths = new Uint8Array(numSymbols);
    let idx = 0;
    while (idx < numSymbols) {
      let len = 0;
      while (getBit() === 0) len++;
      len++;
      let count = getBits(4);
      if (count === 15) {
        let extra;
        do { extra = getBits(4); count += extra; } while (extra === 15);
      }
      count++;
      for (let c = 0; c < count && idx < numSymbols; c++) lengths[idx++] = len;
    }
    const maxLen = Math.max(...lengths) || 1;
    const codes = new Uint16Array(numSymbols);
    const blCount = new Uint16Array(maxLen + 1);
    for (let i = 0; i < numSymbols; i++) if (lengths[i]) blCount[lengths[i]]++;
    let code = 0;
    blCount[0] = 0;
    const nextCode = new Uint16Array(maxLen + 1);
    for (let bits = 1; bits <= maxLen; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    for (let i = 0; i < numSymbols; i++) {
      const len = lengths[i];
      if (len) { codes[i] = nextCode[len]++; }
    }
    return { lengths, codes, maxLen, numSymbols };
  }

  function decodeSymbol(tree: HuffTree): number {
    let code = 0;
    for (let len = 1; len <= tree.maxLen; len++) {
      code = (code << 1) | getBit();
      for (let i = 0; i < tree.numSymbols; i++) {
        if (tree.lengths[i] === len && tree.codes[i] === code) {
          if (i < 2) return i;
          return getBits(i - 1) | (1 << (i - 1));
        }
      }
    }
    return 0;
  }

  while (outPos < outSize && inPos < data.length) {
    const rawTree = buildHuffDecoder(16);
    const lenTree = buildHuffDecoder(64);
    const posTree = buildHuffDecoder(64);
    let subchunks = getBits(16);

    while (subchunks-- > 0 && outPos < outSize) {
      let rawLen = decodeSymbol(rawTree);
      while (rawLen-- > 0 && outPos < outSize && inPos < data.length) {
        output[outPos++] = data[inPos++];
      }
      if (subchunks > 0 && outPos < outSize) {
        const offset = decodeSymbol(lenTree) + 1;
        const length = decodeSymbol(posTree) + 2;
        for (let i = 0; i < length && outPos < outSize; i++) {
          output[outPos] = output[outPos - offset];
          outPos++;
        }
      }
    }
  }
  return outPos > 0 ? output : null;
}

export function decompressLZ77Backward(compressed: Uint8Array, uncompressedSize: number): Uint8Array | null {
  if (!uncompressedSize || uncompressedSize > 0x800000) return null;

  const candidates: number[] = [compressed.length];
  if (compressed.length >= 28 && 
      compressed[0] === 0x60 && 
      (compressed[1] === 0x1A || compressed[1] === 0x1C || compressed[1] === 0x00)) {
    const textSize = readUint32BE(compressed, 2);
    const dataSize = readUint32BE(compressed, 6);
    const symSize = readUint32BE(compressed, 14);
    
    const end1 = 28 + textSize + dataSize;
    const end2 = 28 + textSize + dataSize + symSize;
    if (end1 > 28 && end1 <= compressed.length) {
      candidates.push(end1);
    }
    if (end2 > 28 && end2 <= compressed.length && end2 !== end1) {
      candidates.push(end2);
    }
  }

  for (const actualEnd of candidates) {
    const output = new Uint8Array(uncompressedSize);
    let srcPos = actualEnd - 1;
    let dstPos = uncompressedSize - 1;
    let bitReg = 0;
    let bitNum = 0;
    let success = true;

    while (dstPos >= 0 && srcPos >= 0) {
      if (bitNum === 0) {
        bitReg = compressed[srcPos--];
        bitNum = 8;
      }
      const bit = bitReg & 1;
      bitReg >>= 1;
      bitNum--;

      if (bit === 0) {
        if (srcPos < 0) { success = false; break; }
        output[dstPos--] = compressed[srcPos--];
      } else {
        if (srcPos < 1) { success = false; break; }
        const length = (compressed[srcPos--] & 0xFF) + 2;
        const b1 = compressed[srcPos--];
        const b2 = compressed[srcPos--];
        const offset = b1 | (b2 << 8);
        
        // Safety check to prevent out of bounds write/read
        if (offset < 0 || dstPos + offset + 1 >= uncompressedSize) {
          success = false;
          break;
        }

        for (let i = 0; i < length && dstPos >= 0; i++) {
          output[dstPos] = output[dstPos + offset + 1];
          dstPos--;
        }
      }
    }
    if (success && dstPos < 0) {
      // Validate that output isn't entirely zeros (since we start filled with zeros)
      let nonZeros = 0;
      for (let idx = 0; idx < Math.min(output.length, 100); idx++) {
        if (output[idx] !== 0) nonZeros++;
      }
      if (nonZeros > 0 || output.length < 10) {
        return output;
      }
    }
  }
  return null;
}

export function decompressJek(bytes: Uint8Array): Uint8Array | null {
  if (!bytes || bytes.length < 12) return null;

  // Let's gather candidates for the end of the compressed file stream
  const candidates: number[] = [bytes.length];
  if (bytes[0] === 0x60 && (bytes[1] === 0x1A || bytes[1] === 0x1C || bytes[1] === 0x00)) {
    const textSize = readUint32BE(bytes, 2);
    const dataSize = readUint32BE(bytes, 6);
    const symSize = readUint32BE(bytes, 14);
    
    // Possibilities for compressed stream end:
    const end1 = 28 + textSize + dataSize;
    const end2 = 28 + textSize + dataSize + symSize;
    if (end1 > 28 && end1 <= bytes.length) {
      candidates.push(end1);
    }
    if (end2 > 28 && end2 <= bytes.length && end2 !== end1) {
      candidates.push(end2);
    }
  }

  for (const actualEnd of candidates) {
    if (actualEnd < 8) continue;
    
    let offset = actualEnd;
    offset -= 4;
    
    const xorKey = ((bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3]) >>> 0;
    
    let d0 = 0;
    
    const readLong = (): number => {
      if (offset < 4) throw new Error("End of compressed stream");
      offset -= 4;
      return ((bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3]) >>> 0;
    };

    const getBit = (): number => {
      let carry = d0 & 1;
      d0 = d0 >>> 1;
      
      if (d0 === 0) {
        let w = readLong();
        w = (w ^ xorKey) >>> 0;
        
        carry = w & 1;
        d0 = (w >>> 1) | 0x80000000;
        d0 = d0 >>> 0;
      }
      return carry;
    };

    const getBits = (n: number): number => {
      let res = 0;
      for (let i = 0; i < n; i++) {
        res = ((res << 1) | getBit()) >>> 0;
      }
      return res;
    };

    const MAX_SIZE = 4 * 1024 * 1024;
    const outBuffer = new Uint8Array(MAX_SIZE);
    let outPtr = MAX_SIZE;

    try {
      while (outPtr > 0) {
        if (getBit() === 0) {
          if (getBit() === 0) {
            const count = getBits(3) + 1;
            for (let i = 0; i < count; i++) {
              if (outPtr > 0) outBuffer[--outPtr] = getBits(8);
            }
          } else {
            const off = getBits(8);
            const count = 2;
            let src = outPtr + off;
            for (let i = 0; i < count; i++) {
              const val = (src - 1 >= 0 && src - 1 < MAX_SIZE) ? outBuffer[src - 1] : 0;
              src--;
              if (outPtr > 0) outBuffer[--outPtr] = val;
            }
          }
        } else {
          const cmd = getBits(2);
          let off = 0;
          let count = 0;
          
          if (cmd === 0) {
            off = getBits(9); count = 3;
          } else if (cmd === 1) {
            off = getBits(10); count = 4;
          } else if (cmd === 2) {
            count = getBits(8) + 1;
            off = getBits(12);
          } else if (cmd === 3) {
            count = getBits(8) + 9;
            for (let i = 0; i < count; i++) {
              if (outPtr > 0) outBuffer[--outPtr] = getBits(8);
            }
            continue;
          }
          
          let src = outPtr + off;
          for (let i = 0; i < count; i++) {
            const val = (src - 1 >= 0 && src - 1 < MAX_SIZE) ? outBuffer[src - 1] : 0;
            src--;
            if (outPtr > 0) outBuffer[--outPtr] = val;
          }
        }
      }
    } catch (e) {
      // Loop halts gracefully on "End of compressed stream"
    }

    const resultBuf = outBuffer.slice(outPtr);
    if (resultBuf.length < 28) continue;

    // Heuristic scan for classical Atari ST PRG header signature
    let prgStart = -1;
    let expectedSize = 0;
    
    for (let i = 0; i < resultBuf.length - 28; i++) {
      if (resultBuf[i] === 0x60 && resultBuf[i+1] === 0x1A) {
        const textLen = ((resultBuf[i+2] << 24) | (resultBuf[i+3] << 16) | (resultBuf[i+4] << 8) | resultBuf[i+5]) >>> 0;
        const dataLen = ((resultBuf[i+6] << 24) | (resultBuf[i+7] << 16) | (resultBuf[i+8] << 8) | resultBuf[i+9]) >>> 0;
        const symLen = ((resultBuf[i+14] << 24) | (resultBuf[i+15] << 16) | (resultBuf[i+16] << 8) | resultBuf[i+17]) >>> 0;
        
        const totalExpected = (28 + textLen + dataLen + symLen) >>> 0;
        if (totalExpected > 0 && totalExpected <= resultBuf.length - i + 512) { 
          prgStart = i;
          expectedSize = totalExpected;
          break;
        }
      }
    }

    if (prgStart !== -1) {
      const actualEnd = Math.min(resultBuf.length, prgStart + expectedSize);
      return resultBuf.slice(prgStart, actualEnd);
    } else if (resultBuf.length >= 32000) {
      // If we got a raw block of reasonable size, return it
      return resultBuf;
    }
  }

  return null;
}

// Atomik Cruncher v3.1 & v3.5 backward depacker (Universal PRG + Data Edition)
export function decompressAtomik(bytes: Uint8Array, offset?: number): Uint8Array | null {
  let orig_size = 0;
  let packed_size = 0;
  let packed_data_offset = 0;
  let is_prg = false; 
  let is_v31 = false; 

  const readUint32BE = (buf: Uint8Array, idx: number) => 
    ((buf[idx] << 24) | (buf[idx + 1] << 16) | (buf[idx + 2] << 8) | buf[idx + 3]) >>> 0;

  // 1. HEURISTIC DETECTION
  let atm_pos = -1;
  let searchIdx = offset !== undefined ? offset : 0;
  let maxSearch = offset !== undefined ? offset + 1 : bytes.length - 12;
  
  // Phase 1: Check for standard Data Header
  for (; searchIdx < maxSearch; searchIdx++) {
    if (bytes[searchIdx] === 0x41) { 
      const sig = readUint32BE(bytes, searchIdx);
      if (sig === 0x41544d35 || sig === 0x41544d33 || sig === 0x41544f4d) { 
        const o_sz = readUint32BE(bytes, searchIdx + 4);
        const p_sz = readUint32BE(bytes, searchIdx + 8);
        if (o_sz > 0 && o_sz < 33554432 && p_sz > 0 && p_sz < 33554432) {
          atm_pos = searchIdx;
          orig_size = o_sz;
          packed_size = p_sz;
          packed_data_offset = searchIdx + 12;
          if (sig === 0x41544d33) is_v31 = true;
          break;
        }
      }
    }
  }

  // Phase 2: Check for Packed PRG Executable
  if (atm_pos === -1) {
    const atomikStr = [0x41, 0x54, 0x4F, 0x4D, 0x49, 0x4B]; // "ATOMIK"
    searchIdx = offset !== undefined ? offset : 0;
    
    outer: for (; searchIdx <= bytes.length - 38; searchIdx++) {
      if (bytes[searchIdx] === 0x41) {
        for (let i = 1; i < 6; i++) {
          if (bytes[searchIdx + i] !== atomikStr[i]) continue outer;
        }
        
        // Scan ahead to determine if this is the v3.1 format
        let found_v31 = false;
        for (let k = 0; k < 20; k++) {
            if (bytes[searchIdx + k] === 0x33 && bytes[searchIdx + k + 1] === 0x2E && bytes[searchIdx + k + 2] === 0x31) {
                found_v31 = true;
                break;
            }
        }

        // Apply dynamically targeted offsets based on the PRG version
        let o_sz, p_sz, data_offset;
        if (found_v31) {
            o_sz = readUint32BE(bytes, searchIdx + 22);
            p_sz = readUint32BE(bytes, searchIdx + 26);
            data_offset = searchIdx + 30;
        } else {
            o_sz = readUint32BE(bytes, searchIdx + 30);
            p_sz = readUint32BE(bytes, searchIdx + 34);
            data_offset = searchIdx + 38;
        }
        
        if (o_sz > 0 && o_sz < 33554432 && p_sz > 0 && p_sz < 33554432) {
          atm_pos = searchIdx;
          orig_size = o_sz;
          packed_size = p_sz;
          packed_data_offset = data_offset;
          is_prg = true;
          is_v31 = found_v31;
          break;
        }
      }
    }
  }

  if (atm_pos === -1) return null;

  const dst = new Uint8Array(orig_size);
  let dst_idx = orig_size;

  let src_idx = packed_data_offset + packed_size;
  if (src_idx > bytes.length) src_idx = bytes.length;

  const readByte = () => {
    if (src_idx <= packed_data_offset) return 0;
    return bytes[--src_idx];
  };

  let picture_cnt = 0;
  let cmd = 0;

  if (is_prg) {
    cmd = readByte();
  } else {
    picture_cnt = readByte();
    cmd = readByte();
  }

  while (cmd === 0 && src_idx > packed_data_offset) {
    if (!is_prg) picture_cnt = cmd;
    cmd = readByte();
  }

  let mask = 0x80;
  while ((cmd & 1) === 0 && mask > 0) {
    cmd >>= 1;
    mask >>= 1;
  }
  cmd >>= 1;

  const getBits = (len: number): number => {
    let tmp = 0;
    while (len > 0) {
      tmp = (tmp << 1) >>> 0;
      mask >>= 1;
      if (mask === 0) {
        cmd = readByte();
        mask = 0x80;
      }
      if ((cmd & mask) !== 0) {
        tmp |= 1;
      }
      len--;
    }
    return tmp;
  };

  // 4. MAIN DECODING LOOP
  while (dst_idx > 0 && src_idx > packed_data_offset) {
    let special_offset_tab_full = false;
    let special_offset = 0;
    const special_offset_tab = new Int32Array(7);
    let short_char_tab_full = false;
    const short_char_tab = new Uint8Array(16);

    // Atomik 3.1 does not support dynamic block header tables. Skip them.
    if (!is_v31) {
      if (getBits(1) === 1) {
        special_offset = readByte();
        let offset_val = 1;
        for (let i = 0; i < 7; i++) {
          if (offset_val === special_offset) offset_val += 2;
          special_offset_tab[i] = offset_val;
          offset_val += 2;
        }
        special_offset_tab_full = true;
      }

      if (getBits(1) === 1) {
        for (let i = 0; i < 16; i++) {
          short_char_tab[i] = readByte();
        }
        short_char_tab_full = true;
      }
    }

    const length_bits = readByte();
    const msb = readByte(); 
    const lsb = readByte(); 

    let block_size = (msb << 8) | lsb;
    if (block_size === 0 && src_idx <= packed_data_offset) break; 

    if (dst_idx < block_size) block_size = dst_idx; 
    const block_target_idx = dst_idx - block_size;

    while (dst_idx > block_target_idx && src_idx > packed_data_offset) {
      if (getBits(1) === 0) {
        dst[--dst_idx] = readByte();
      } else {
        let len = 0;
        while (getBits(1) === 0) {
          if (len === length_bits) {
            let val = 0;
            if (is_v31) {
              // CRITICAL FIX: Atomik 3.1 Terminator Bit Logic
              if (getBits(1) === 1) {
                val = 1; // Terminator: Stop reading, just add 1
              } else {
                val = getBits(4); // Extender: Read 4 bits
                if (val === 0) {
                  val = getBits(8);
                  val += 15;
                }
              }
            } else {
              // Atomik 3.5 Length Logic
              val = getBits(4);
              if (val === 0) {
                val = getBits(8);
                if (val === 0) {
                  val = getBits(14);
                  val += 255;
                }
                val += 15;
              }
            }
            len += val;
            break;
          }
          len++;
        }

        let offset = 0;
        if (len === 0) {
          if (getBits(1) === 1) {
            const idx = getBits(4);
            if (short_char_tab_full) {
              dst[--dst_idx] = short_char_tab[idx];
            } else {
              const tmp = dst_idx >= dst.length ? 0 : dst[dst_idx]; 
              let sub = idx;
              if (sub > 7) sub += 0xf0;
              dst[--dst_idx] = (tmp - sub) & 0xFF;
            }
            continue;
          } else {
            len = 2;
            offset = 2;
          }
        } else {
          len += 2;
          offset = 3;
        }

        let match_offset = 0;
        const offset_idx = getBits(offset);
        if (offset_idx > 7) return null; // Bounds protection

        if (is_v31) {
            // CRITICAL FIX: Atomik 3.1 strict legacy DBF offset tables
            const v31_offset_table_1 = [0, 32, 96, 352, 864, 1888, 3936, 8032];
            const v31_bit_table_1    = [5, 6, 8, 9, 10, 11, 12, 13];
            match_offset = v31_offset_table_1[offset_idx] + getBits(v31_bit_table_1[offset_idx]);
        } else {
            // Atomik 3.5 offset tables & math
            const bit_table = [1, 2, 4, 5, 6, 7, 8, 9];
            const offset_table = [0, 32, 96, 352, 864, 1888, 3936, 8032];
            const base_bits = bit_table[offset_idx];

            if (special_offset_tab_full) {
                let bits_val = getBits(base_bits);
                bits_val <<= 4;
                let index = getBits(3);
                if (index === 7) {
                    if (getBits(1) === 1) {
                        let idx2 = getBits(3);
                        idx2 = (idx2 + idx2) & 0xff;
                        bits_val |= idx2;
                    } else {
                        bits_val |= special_offset;
                    }
                } else {
                    if (index >= 0 && index < special_offset_tab.length) {
                        bits_val |= special_offset_tab[index];
                    }
                }
                match_offset = offset_table[offset_idx] + bits_val;
            } else {
                const bits_to_read = base_bits + 4;
                match_offset = offset_table[offset_idx] + getBits(bits_to_read);
            }
        }

        let q_idx = dst_idx + match_offset + 1;
        if (dst_idx - block_target_idx < len) {
          len = dst_idx - block_target_idx;
        }

        while (len > 0) {
          dst_idx--;
          q_idx--;
          let val = (q_idx >= 0 && q_idx < dst.length) ? dst[q_idx] : 0;
          dst[dst_idx] = val;
          len--;
        }
      }
    }
  }

  let final_data = dst;
  let final_size = orig_size;

  if (dst_idx > 0) {
      final_size = orig_size - dst_idx;
      final_data = new Uint8Array(final_size);
      final_data.set(dst.subarray(dst_idx));
  }

  // 5. ATARI ST CHUNKY TO PLANAR
  while (picture_cnt > 0 && final_size > 32000) {
    final_size -= 4;
    let offset = readUint32BE(final_data, final_size);

    if (offset > final_size - 32000) offset = final_size - 32000;
    if (offset < 0) offset = 0; 

    let p = offset;
    for (let i = 0; i < 4000; i++) {
      let plane0 = 0, plane1 = 0, plane2 = 0, plane3 = 0;
      for (let j = 0; j < 8; j++) {
        let data = final_data[p + j];
        plane0 <<= 2; plane1 <<= 2; plane2 <<= 2; plane3 <<= 2;
        plane3 += data & 1; data >>= 1;
        plane2 += data & 1; data >>= 1;
        plane1 += data & 1; data >>= 1;
        plane0 += data & 1;
        plane3 += data & 2; data >>= 1;
        plane2 += data & 2; data >>= 1;
        plane1 += data & 2; data >>= 1;
        plane0 += data & 2;
      }
      final_data[p++] = (plane0 >> 8) & 0xFF; final_data[p++] = plane0 & 0xFF;
      final_data[p++] = (plane1 >> 8) & 0xFF; final_data[p++] = plane1 & 0xFF;
      final_data[p++] = (plane2 >> 8) & 0xFF; final_data[p++] = plane2 & 0xFF;
      final_data[p++] = (plane3 >> 8) & 0xFF; final_data[p++] = plane3 & 0xFF;
    }
    picture_cnt--;
  }

  return final_data.subarray(0, final_size);
}

export function decompressThunderV2(bytes: Uint8Array, offset?: number): Uint8Array | null {
  if (!bytes || bytes.length < 12) return null;

  let atomOffset = -1;
  const searchStart = offset !== undefined ? offset : 0;
  
  if (offset !== undefined) {
    if (offset + 12 <= bytes.length &&
        bytes[offset] === 0x41 && bytes[offset+1] === 0x54 && bytes[offset+2] === 0x4F && bytes[offset+3] === 0x4D) {
      atomOffset = offset;
    }
  } else {
    const limit = Math.min(bytes.length - 12, 10000);
    for (let i = 0; i < limit; i++) {
      if (bytes[i] === 0x41 && bytes[i+1] === 0x54 && bytes[i+2] === 0x4F && bytes[i+3] === 0x4D) {
        atomOffset = i;
        break;
      }
    }
  }

  if (atomOffset === -1) return null;

  try {
    const uncompressedLength = ((bytes[atomOffset + 4] << 24) |
                                (bytes[atomOffset + 5] << 16) |
                                (bytes[atomOffset + 6] << 8) |
                                bytes[atomOffset + 7]) >>> 0;

    if (uncompressedLength <= 0 || uncompressedLength > 16 * 1024 * 1024) {
      return null;
    }

    const packedEndOffset = ((bytes[atomOffset + 8] << 24) |
                            (bytes[atomOffset + 9] << 16) |
                            (bytes[atomOffset + 10] << 8) |
                            bytes[atomOffset + 11]) >>> 0;

    const absolutePackedEnd = atomOffset + packedEndOffset;
    if (absolutePackedEnd > bytes.length) {
      return null;
    }

    const absoluteLiteralLenOffset = absolutePackedEnd - 4;
    const literalLength = ((bytes[absoluteLiteralLenOffset] << 24) |
                          (bytes[absoluteLiteralLenOffset + 1] << 16) |
                          (bytes[absoluteLiteralLenOffset + 2] << 8) |
                          bytes[absoluteLiteralLenOffset + 3]) >>> 0;

    const absoluteLiteralsStart = absoluteLiteralLenOffset - literalLength;
    const absoluteBitstreamStart = atomOffset + 12;

    if (absoluteLiteralsStart < absoluteBitstreamStart) {
      return null;
    }

    let a2 = absoluteBitstreamStart;
    const a3 = absoluteLiteralsStart;
    let a0 = absoluteLiteralsStart;

    const dest = new Uint8Array(uncompressedLength + 4096);
    let a4 = 0;
    let d7 = 0x8000;

    function u3(): boolean {
      let carry = (d7 & 0x8000) !== 0;
      d7 = (d7 << 1) & 0xFFFF;
      if (d7 === 0) {
        if (a2 + 1 >= bytes.length) {
          if (a4 >= uncompressedLength) {
            return false;
          }
          throw new Error("Unexpected end of compressed bitstream");
        }
        const word = (bytes[a2] << 8) | bytes[a2 + 1];
        a2 += 2;
        carry = (word & 0x8000) !== 0;
        d7 = ((word << 1) | 1) & 0xFFFF;
      }
      return carry;
    }

    function u14(d1: number): number {
      let d2 = 0;
      if (d1 > 0) {
        for (let i = 0; i < d1; i++) {
          let carry = (d7 & 0x8000) !== 0;
          d7 = (d7 << 1) & 0xFFFF;
          if (d7 === 0) {
            if (a2 + 1 >= bytes.length) {
              if (a4 >= uncompressedLength) return 0;
              throw new Error("Unexpected end of bitstream in literal retrieval");
            }
            const word = (bytes[a2] << 8) | bytes[a2 + 1];
            a2 += 2;
            carry = (word & 0x8000) !== 0;
            d7 = ((word << 1) | 1) & 0xFFFF;
          }
          d2 = (d2 << 1) | (carry ? 1 : 0);
        }
      }
      return d2;
    }

    function u4(): number {
      let d1 = 0;
      for (let i = 0; i < 4; i++) {
        let carry = (d7 & 0x8000) !== 0;
        d7 = (d7 << 1) & 0xFFFF;
        if (d7 === 0) {
          if (a2 + 1 >= bytes.length) {
            if (a4 >= uncompressedLength) return 0;
            throw new Error("Buffer overflow inside code reading cycle");
          }
          const word = (bytes[a2] << 8) | bytes[a2 + 1];
          a2 += 2;
          carry = (word & 0x8000) !== 0;
          d7 = ((word << 1) | 1) & 0xFFFF;
        }
        d1 = (d1 << 1) | (carry ? 1 : 0);
      }
      let d2 = 0;
      if (d1 > 0) {
        d2 = u14(d1);
      }
      return d2;
    }

    function writeByte(b: number) {
      if (a4 >= dest.length) return;
      dest[a4++] = b;
    }

    function copyMatch(offsetVal: number, length: number) {
      if (offsetVal <= 0) {
        if (a4 >= uncompressedLength) return;
        throw new Error(`Invalid match copy window size: ${offsetVal}`);
      }
      let match_ptr = a4 - offsetVal;
      if (match_ptr < 0) {
        if (a4 >= uncompressedLength) return;
        throw new Error(`Backward offset ref ${offsetVal} points out of allocated address bounds`);
      }
      for (let i = 0; i < length; i++) {
        if (a4 >= dest.length) break;
        dest[a4] = dest[match_ptr];
        a4++;
        match_ptr++;
      }
    }

    while (a2 <= a3) {
      if (a4 >= uncompressedLength) {
        break;
      }

      let d1 = 0;
      if (!u3()) {
        if (a0 >= absolutePackedEnd) {
          if (a4 >= uncompressedLength) break;
          throw new Error("Literal pointer read overflows file boundary limit");
        }
        writeByte(bytes[a0++]);
      } else {
        if (!u3()) {
          d1 = 0;
          for (let i = 0; i < 3; i++) {
            d1 = (d1 << 1) | (u3() ? 1 : 0);
          }
          if (d1 === 1) {
            for (let i = 0; i < 10; i++) {
              if (a0 >= absolutePackedEnd) {
                if (a4 >= uncompressedLength) break;
                throw new Error("Unexpected end of literals inside block-copy run");
              }
              writeByte(bytes[a0++]);
            }
          } else if (d1 === 0) {
            writeByte(0);
          } else {
            const d2 = u14(d1);
            const d0 = d2;
            const d2_offset = u4();
            copyMatch(d2_offset, d0 + 1);
          }
        } else {
          if (!u3()) {
            d1 = 0;
            for (let i = 0; i < 4; i++) {
              d1 = (d1 << 1) | (u3() ? 1 : 0);
            }
            if (d1 === 1) {
              if (a0 - 1 < absoluteLiteralsStart) {
                if (a4 >= uncompressedLength) break;
                throw new Error("Backward index mismatch at literal head boundary");
              }
              writeByte(bytes[a0 - 1]);
            } else if (d1 < 1) {
              const d2 = u4();
              const d0 = d2;
              if (d0 === 0) {
                const d2_first = u4();
                const d0_new = d2_first;
                const d2_second = u4();
                copyMatch(d2_second, d0_new + 1);
              } else {
                let repeat_val = 0;
                if (!u3()) {
                  if (a0 >= absolutePackedEnd) {
                    if (a4 >= uncompressedLength) break;
                    throw new Error("Unexpected end of literals on repeating byte stream");
                  }
                  repeat_val = bytes[a0++];
                }
                for (let i = 0; i < d0 + 1; i++) {
                  writeByte(repeat_val);
                }
              }
            } else {
              const d2 = u14(d1);
              const d0 = 2;
              copyMatch(d2, d0 + 1);
            }
          } else {
            const d0 = 1;
            if (a0 >= absolutePackedEnd) {
              if (a4 >= uncompressedLength) break;
              throw new Error("Unexpected end of literals during short match sequence");
            }
            const d2 = bytes[a0++];
            copyMatch(d2, d0 + 1);
          }
        }
      }
    }

    return dest.subarray(0, uncompressedLength);
  } catch (err) {
    return null;
  }
}

export function decompressAutomation(packed: Uint8Array, offset?: number): Uint8Array | null {
  if (!packed || packed.length < 12) return null;
  const dv = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);

  let dataStart = -1;
  
  if (offset !== undefined) {
    dataStart = offset;
  } else {
    // Heuristic Scan for Automation packed data block (optimized range)
    const scanLimit = Math.min(8192, packed.length - 12);
    for (let i = 0; i <= scanLimit; i++) {
      const uSize = dv.getUint32(i + 4, false); // Expected Unpacked Size
      const pSize = dv.getUint32(i + 8, false); // Expected Packed Size Delta
      
      if (pSize > 0 && uSize >= pSize && uSize < 32 * 1024 * 1024) {
        const endOffset = i + 8 + pSize;
        // M68k packer normally aligns EOF close to the target pointer
        if (endOffset <= packed.length + 4 && endOffset >= packed.length - 1024) {
          dataStart = i;
          break;
        }
      }
    }
  }

  if (dataStart === -1) {
    return null;
  }

  let a0 = dataStart + 4;
  if (a0 + 4 > packed.length) return null;
  const d5 = dv.getUint32(a0, false); // Depacked Size
  a0 += 4;

  if (d5 === 0 || d5 > 32 * 1024 * 1024) return null;

  const outBuffer = new Uint8Array(d5);
  let a1 = d5; // Output pointer starts at the VERY END

  if (a0 + 4 > packed.length) return null;
  const delta = dv.getUint32(a0, false);
  a0 += delta; 
  a0 -= 4; // SUBA.L #4, A0

  // Dummy check TST.W -(A0)
  a0 -= 2;
  if (a0 < 0 || a0 + 2 > packed.length) return null;
  
  const testWord = dv.getInt16(a0, false);
  if (testWord < 0) { // BPL.S
    a0 -= 1; // SUBQ.L #1, A0
  }

  // --- Bit Stream Init ---
  let d0 = 0;
  let carry = 0;

  a0 -= 1;
  if (a0 < 0 || a0 >= packed.length) return null;
  d0 = packed[a0];

  // LSL.B / ROXL.B mapping
  function getBit() {
    carry = (d0 >> 7) & 1;
    d0 = (d0 << 1) & 0xFF;
    if (d0 === 0) {
      a0 -= 1;
      if (a0 < 0 || a0 >= packed.length) {
        throw new Error("Unexpected end of packed stream");
      }
      d0 = packed[a0];
      const nextCarry = (d0 >> 7) & 1;
      d0 = ((d0 << 1) | carry) & 0xFF;
      carry = nextCarry;
    }
    return carry;
  }

  function getBits(numBits: number, initialD1 = 0) {
    let d1 = initialD1;
    for (let i = 0; i < numBits; i++) {
      d1 = ((d1 << 1) | getBit()) & 0xFFFF;
    }
    return d1;
  }

  // Predefined Huffman-like index tables found in the ASM
  const lowerTable = [10, 3, 2, 2];
  const upperTable = [14, 7, 4, 1];
  const repeatLittleTableBits = [10, 2, 1, 0, 0];
  const repeatLittleTableAdj  = [10, 6, 4, 3, 2];
  const offsetBigTableBits = [11, 4, 7];
  const offsetBigTableAdj  = [288, 0, 32];

  const endA0 = dataStart + 12; // Termination marker

  // --- MAIN DECOMPRESSION LOOP ---
  try {
    while (true) {
      const bit = getBit();
      
      if (bit !== 0) {
        // --- JUNK (Uncompressed Copy) ---
        let d1 = 0;
        const bit2 = getBit();
        
        if (bit2 !== 0) {
          let d3 = 3;
          while (true) {
            d1 = 0;
            const bitSize = lowerTable[d3];
            const mask = (1 << bitSize) - 1;
            d1 = getBits(bitSize, 0);

            if (d3 !== 0 && d1 === mask) {
              d3--;
            } else {
              break;
            }
          }
          d1 += upperTable[d3];
        }
        
        // Copy Junk bytes (DBF D1 loops D1+1 times)
        for (let i = 0; i <= d1; i++) {
          a0--;
          a1--;
          if (a1 < 0) return null;
          if (a0 < 0 || a0 >= packed.length) return null;
          outBuffer[a1] = packed[a0];
        }
      }

      // Termination Check
      if (a0 <= endA0) break;

      // --- REPEATS (LZ Matches) ---
      let d2 = 3;
      while (true) {
        if (getBit() === 0) break;
        d2--;
        if (d2 < 0) break;
      }

      let d1 = 0;
      d2 += 1;

      const bitSize = repeatLittleTableBits[d2];
      if (bitSize !== 0) {
        d1 = getBits(bitSize, 0);
      }
      d1 += repeatLittleTableAdj[d2];

      let offset = 0;
      if (d1 === 2) {
        // Small Offset logic
        let d3, d4;
        if (getBit() === 0) {
          d3 = 5;
          d4 = 0;
        } else {
          d3 = 8;
          d4 = 0x40; // 64
        }
        offset = getBits(d3 + 1, 0);
        offset += d4;
      } else {
        // Big Offset logic
        let d3 = 1;
        while (true) {
          if (getBit() === 0) break;
          d3--;
          if (d3 < 0) break;
        }
        d3 += 1;
        const bitSize2 = offsetBigTableBits[d3];
        offset = getBits(bitSize2 + 1, 0);
        offset += offsetBigTableAdj[d3];
      }

      let a2 = a1 + offset;
      a2 += d1; // Length

      // Reverse overlap copy - ensures we read decompressed data backwards
      if (a2 > outBuffer.length) {
        a2 = outBuffer.length; // Minor clamp for gracefully failing on edge padding
      }

      for (let i = 0; i < d1; i++) {
        a1--;
        a2--;
        if (a1 < 0) return null;
        if (a2 < 0 || a2 >= outBuffer.length) return null;
        outBuffer[a1] = outBuffer[a2];
      }
    }

    return outBuffer;
  } catch (err) {
    return null;
  }
}

export function decompressThunderV1(bytes: Uint8Array, offset?: number): Uint8Array | null {
  if (!bytes || bytes.length < 12) return null;

  let atomOffset = -1;
  if (offset !== undefined) {
    if (offset + 12 <= bytes.length &&
        bytes[offset] === 0x41 && bytes[offset+1] === 0x54 && bytes[offset+2] === 0x4F && bytes[offset+3] === 0x4D) {
      atomOffset = offset;
    }
  } else {
    // Scan for ATOM header
    const limit = Math.min(bytes.length - 12, 10000);
    for (let i = 0; i < limit; i++) {
      if (bytes[i] === 0x41 && bytes[i+1] === 0x54 && bytes[i+2] === 0x4F && bytes[i+3] === 0x4D) {
        atomOffset = i;
        break;
      }
    }
  }

  if (atomOffset === -1) return null;

  try {
    const uncompressedLength = readUint32BE(bytes, atomOffset + 4);
    const packedLength = readUint32BE(bytes, atomOffset + 8);

    let a2 = atomOffset + 12;
    let packedEnd = a2 + packedLength;

    if (packedEnd > bytes.length || packedLength > 16777216) {
      packedEnd = bytes.length;
    }

    if (uncompressedLength <= 0 || uncompressedLength > 16777216) {
      return null;
    }

    const dest = new Uint8Array(uncompressedLength);
    let a4 = 0;
    let d1 = 0;

    while (a2 < packedEnd) {
      if (a4 >= uncompressedLength) break;
      if (a2 + 1 >= bytes.length) break;

      let d4 = (bytes[a2] << 8) | bytes[a2 + 1];
      a2 += 2;

      let bit14 = (d4 >> 14) & 1;
      let bit15 = (d4 >> 15) & 1;

      if (bit14 === 0) {
        if (bit15 === 1) {
          d4 &= 0x7FFF;
          if (a2 >= bytes.length) break;
          d1 = bytes[a2++];
        }
        d4 += 0x2000;
        while (true) {
          let carry = d4 & 1;
          d4 >>= 1;
          if (d4 === 0) break;

          if (a4 >= dest.length) break;

          if (carry) {
            dest[a4++] = d1;
          } else {
            if (a2 >= bytes.length) break;
            dest[a4++] = bytes[a2++];
          }
        }
      } else if (bit15 === 0) {
        d4 &= 0xBFFF;
        if (a2 >= bytes.length) break;
        let d2 = bytes[a2++];

        let count = d4 + 1;
        for (let i = 0; i < count; i++) {
          if (a4 >= dest.length) break;
          dest[a4++] = d2;
        }
      } else {
        d4 &= 0x3FFF;
        if (a2 >= bytes.length) break;
        let next_byte = bytes[a2++];

        let length = (d4 >> 8) + 1;
        let offsetVal = ((d4 & 0xFF) << 8) | next_byte;
        let match_ptr = a4 - offsetVal;

        if (match_ptr < 0) {
          if (a4 >= uncompressedLength) break;
          return null;
        }

        for (let i = 0; i < length; i++) {
          if (a4 >= dest.length) break;
          dest[a4] = dest[match_ptr];
          a4++;
          match_ptr++;
        }
      }
    }

    if (a4 > 0) {
      return dest.subarray(0, a4);
    }
  } catch (err) {
    return null;
  }
  return null;
}
