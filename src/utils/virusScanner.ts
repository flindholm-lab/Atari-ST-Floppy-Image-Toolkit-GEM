/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DiskGeometry, DiskFileInfo } from '../types';
import { getDiskDirEntries, getClusterChain, writeFAT12EntryAllCopies } from './diskUtils';

/**
 * Struct detailing scanning results for reporting and UI interaction layers.
 */
export interface VirusScanResult {
  virusFound: boolean;
  type: 'BootSector' | 'File' | 'None';
  name: string;
  description: string;
  target: string;
  offset?: number;
  canDisinfect: boolean;
}

/**
 * Struct mapping out signature patterns.
 * 'bytes' holds the raw search tokens.
 * 'mask' holds 'x' (must match exactly) or '?' (wildcard/variable).
 * 'fixedOffset' optionally anchors the signature to an absolute position (e.g. 0 or 4).
 * 'requiredString' optionally enforces that a specific ASCII string must reside in the sector.
 */
export interface MaskedSignature {
  name: string;
  description: string;
  bytes: number[];
  mask: string;
  fixedOffset?: number;
  requiredString?: string;
}

export interface FileVirusSignature {
  name: string;
  description: string;
  bytes: number[];
  mask: string;
}

/**
 * Calculates the standard 16-bit word checksum used by the Atari ST TOS.
 * If the sum of all 256 words (512 bytes) in Sector 0 adds up to exactly 0x1234
 * (unsigned 16-bit wrapping), the operating system flags the sector as
 * bootable and executes it on system startup.
 * @param sectorBytes A 512-byte buffer representing Sector 0
 * @returns The computed 16-bit checksum
 */
export function calculateBootChecksum(sectorBytes: Uint8Array): number {
  if (sectorBytes.length < 512) {
    throw new Error('Boot checksum requires a complete 512-byte sector.');
  }
  let sum = 0;
  for (let i = 0; i < 512; i += 2) {
    const val = (sectorBytes[i] << 8) | sectorBytes[i + 1];
    sum = (sum + val) & 0xFFFF;
  }
  return sum;
}

/**
 * Helper utility to search for raw ASCII substring signatures inside a sector.
 * Converts byte inputs to unsigned values before evaluation to prevent signed mismatch bugs.
 */
export function containsString(data: Uint8Array, needle: string): boolean {
  const len = needle.length;
  if (data.length < len) return false;
  
  const codes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    codes[i] = needle.charCodeAt(i) & 0xFF;
  }

  for (let i = 0; i <= data.length - len; i++) {
    let match = true;
    for (let j = 0; j < len; j++) {
      const byteA = data[i + j] & 0xFF;
      const byteB = codes[j] & 0xFF;
      if (byteA !== byteB) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Scans a byte buffer for a specific assembly signature with wildcards.
 * Supports flexible sliding scans or absolute fixed-offset scans.
 * Normalizes all comparisons with 0xFF to prevent signed/unsigned array index mismatches.
 * Uses .charAt() to guarantee absolute compatibility with all browser runtimes.
 * @param data Byte sequence to search (usually 512 bytes)
 * @param sig Signature definition
 * @returns Found index offset, or -1 if no match was found
 */
export function findMaskedPattern(data: Uint8Array, sig: MaskedSignature | FileVirusSignature): number {
  const len = sig.bytes.length;
  if (data.length < len) return -1;

  // Unified loop: locks the range based on fixedOffset boundaries
  const start = ('fixedOffset' in sig && sig.fixedOffset !== undefined) ? sig.fixedOffset : 0;
  const end = ('fixedOffset' in sig && sig.fixedOffset !== undefined) ? sig.fixedOffset : (data.length - len);

  for (let i = start; i <= end; i++) {
    let match = true;
    for (let j = 0; j < len; j++) {
      if (sig.mask.charAt(j) === 'x') {
        const byteA = data[i + j] & 0xFF;
        const byteB = sig.bytes[j] & 0xFF;
        if (byteA !== byteB) {
          match = false;
          break;
        }
      }
    }
    if (match) return i;
  }
  return -1;
}

// Recursive helper to traverse directories on the virtual floppy disk
function getAllDiskFilesRecursive(
  diskBytes: Uint8Array,
  geometry: DiskGeometry,
  dirCluster: number,
  visited: Set<number> = new Set()
): DiskFileInfo[] {
  if (dirCluster !== 0 && visited.has(dirCluster)) return [];
  if (dirCluster !== 0) visited.add(dirCluster);

  const files: DiskFileInfo[] = [];
  try {
    const entries = getDiskDirEntries(diskBytes, dirCluster, geometry);
    for (const entry of entries) {
      if (entry.isDeleted) continue;
      if (entry.isDir) {
        if (entry.name !== '.' && entry.name !== '..') {
          files.push(entry);
          const subFiles = getAllDiskFilesRecursive(diskBytes, geometry, entry.cluster as number, visited);
          files.push(...subFiles);
        }
      } else {
        files.push(entry);
      }
    }
  } catch (err) {
    console.error('Error scanning folder cluster:', dirCluster, err);
  }
  return files;
}

// 21 Specific Boot Sector Virus Signatures
export const specificVirusSignatures: MaskedSignature[] = [
  {
    name: 'ACA Virus',
    description: 'Classic early resident boot infector that hooks trap vectors and identifies with OEM Label ACA.',
    bytes: [0x60, 0x00, 0x00, 0x94, 0x41, 0x43, 0x41, 0x09],
    mask: 'xxxxxxxx',
    fixedOffset: 0
  },
  {
    name: 'Zorro Virus',
    description: 'Extremely rare but aggressive vector hijacking boot sector threat.',
    bytes: [0xEB, 0x34, 0x90, 0x03, 0x60, 0x18, 0x4E, 0xF9, 0xC7, 0x11, 0xD6, 0x00],
    mask: 'xxxxxxxxxxxx',
    fixedOffset: 0
  },
  {
    name: 'Freeze Virus',
    description: 'Infects and locks up memory-resident pipelines upon cold boots.',
    bytes: [0x48, 0x7A, 0x22, 0x78, 0x04, 0x2E, 0x93, 0xFC],
    mask: 'xxxxxxxx'
  },
  {
    name: 'CT Virus',
    description: 'Memory resident threat targeting floppy sector operations with typical instruction loops.',
    bytes: [0x20, 0x5F, 0x55, 0x88, 0x95, 0xCA, 0x22, 0x6A, 0x04, 0x36],
    mask: 'xxxxxxxxxx'
  },
  {
    name: 'Cookie Virus',
    description: 'Famous resident boot payload demanding a cookie on execution.',
    bytes: [0x49, 0x20, 0x57, 0x41, 0x4E, 0x54, 0x20, 0x41, 0x20, 0x43, 0x4F, 0x4F, 0x4B, 0x49, 0x45, 0x21], // "I WANT A COOKIE!"
    mask: 'xxxxxxxxxxxxxxxx'
  },
  {
    name: 'Blot Virus',
    description: 'Destructive boot sector infector that corrupts BIOS parameter metadata.',
    bytes: [0x12, 0x12, 0x34, 0x56, 0x21, 0x48, 0x00, 0x04, 0x31, 0x7C],
    mask: 'xxxxxxxxxx'
  },
  {
    name: 'Finland / Toubab Virus',
    description: 'A variant featuring an inquisitive social greeting signature.',
    bytes: [0x48, 0x69, 0x21, 0x52, 0x20, 0x55, 0x20, 0x6E, 0x69, 0x63, 0x65, 0x3F], // "Hi!R U nice?"
    mask: 'xxxxxxxxxxxx'
  },
  {
    name: 'Directory Waster Virus',
    description: 'Highly destructive sector threat replicating 14 times before wiping the root directory.',
    bytes: [0x24, 0x12, 0xB4, 0x91, 0x67, 0x34, 0x41, 0xFA],
    mask: 'xxxxxxxx'
  },
  {
    name: 'Flying Chimp Virus',
    description: 'Resident system sector modifier replicating into high system space bounds.',
    bytes: [0x4E, 0x5E, 0x41, 0xFA, 0x00, 0x06, 0x20, 0x50, 0x4E, 0xD0],
    mask: 'xxxxxxxxxx'
  },
  {
    name: 'Evil Nick Virus',
    description: 'Infector containing a specific string gift message.',
    bytes: [0x45, 0x56, 0x49, 0x4C, 0x20, 0x21, 0x20, 0x2D, 0x20, 0x41, 0x20, 0x47, 0x69, 0x66, 0x74], // "EVIL ! - A Gift"
    mask: 'xxxxxxxxxxxxxxx'
  },
  {
    name: 'Screen Virus',
    description: 'Visual sector payload modifier hiding within standard boot spaces.',
    bytes: [0x0C, 0x6C, 0xE6, 0x56, 0x00, 0x02, 0x67, 0x00],
    mask: 'xxxxxxxx'
  },
  {
    name: 'Oli Virus',
    description: 'System vector hook displaying custom verification installation messages.',
    bytes: [0x4F, 0x4C, 0x49, 0x2D, 0x56, 0x49, 0x52, 0x55, 0x53], // "OLI-VIRUS"
    mask: 'xxxxxxxxx'
  },
  {
    name: 'Muncher / Vire 87 Virus',
    description: 'Vintage 1987 floppy resident boot infector.',
    bytes: [0x56, 0x49, 0x52, 0x45, 0x20, 0x38, 0x37], // "VIRE 87"
    mask: 'xxxxxxx',
    fixedOffset: 0
  },
  {
    name: 'Green Goblins Virus',
    description: 'Retro game compilations sector interrupter displaying playful warnings.',
    bytes: [0x54, 0x68, 0x65, 0x20, 0x4C, 0x69, 0x74, 0x74, 0x6C, 0x65, 0x20, 0x47, 0x72, 0x65, 0x65, 0x6E], // "The Little Green"
    mask: 'xxxxxxxxxxxxxxxx'
  },
  {
    name: 'Virus Master',
    description: 'Custom message boot payload targeting standard system operations.',
    bytes: [0x74, 0x68, 0x65, 0x20, 0x76, 0x69, 0x72, 0x75, 0x73, 0x20, 0x6D, 0x61, 0x73, 0x74, 0x65, 0x72], // "the virus master"
    mask: 'xxxxxxxxxxxxxxxx'
  },
  {
    name: 'Macumba Virus',
    description: 'Destructive vector-hooking resident sector threat.',
    bytes: [0xEB, 0x34, 0x90, 0x05, 0x60, 0x18, 0x4E, 0xF9, 0x01, 0xDE, 0x5C, 0x00],
    mask: 'xxxxxxxxxxxx',
    fixedOffset: 0
  },
  {
    name: 'Pirate Trap Virus',
    description: 'A classic resident Trojan intercepting BIOS Trap routines. It features an ASCII console warning string on boot.',
    bytes: [0x4E, 0x4E, 0x4E, 0x4E, 0x91, 0x04, 0xAB, 0x00],
    mask:  'xxxxxxxx',
    fixedOffset: 4, 
    requiredString: '*** The Pirate Trap ***' 
  },
  {
    name: 'Signum Boot Virus',
    description: 'Highly contagious system trap interceptor vector virus. Patches system variables.',
    bytes: [0x41, 0xFA, 0xFF, 0xC4, 0x22, 0x79, 0x00, 0x00, 0x04, 0xC6, 0xD3, 0xFC],
    mask:  'xxxxxxxxxxxx'
  },
  {
    name: 'Ghost Boot Virus (Mouse)',
    description: 'Late-stage Mouse/Ghost variant targeting memory bounds. Intercepts timers, border flashes, and degrades tracking.',
    bytes: [0x48, 0xE7, 0xFF, 0xFE, 0x41, 0xFA, 0x00, 0x00, 0x20, 0x3C],
    mask:  'xxxxxx??xx'
  },
  {
    name: 'Ghost Boot Virus (GFA / Mouse)',
    description: 'Prevalent memory-resident boot block infector GFA variant that intercepts disk hardware vectors.',
    bytes: [0x26, 0x3C, 0x00, 0x00, 0x00, 0xD6, 0x43, 0xF8, 0x01, 0x40],
    mask:  'xxxxxxxxxx'
  },
  {
    name: 'MAD Virus',
    description: 'A benign but highly disruptive resident joke virus that triggers visual scroll distortion effects and a retro chip tune after a counter limit of infections.',
    bytes: [0x48, 0xE7, 0xFF, 0xFE, 0x41, 0xFA, 0x00, 0x00, 0x20, 0x7C],
    mask:  'xxxxxx??xx'
  },
  {
    name: 'MAD Virus (Scrolltext / Repeating)',
    description: 'Benign but highly visible resident joke virus that flashes borders, rotates screens, and triggers a retro sound loop.',
    bytes: [0xE3, 0x4B, 0xD5, 0x3D, 0x97, 0x8C],
    mask: 'xxxxxx'
  },
  {
    name: 'Signum / BPL Boot Virus Variant',
    description: 'Resident system vector and BIOS trap modifier using a supervisor stack hijack loader.',
    bytes: [0x41, 0xFA, 0x07, 0x7A, 0x43, 0xFA, 0x00, 0x06, 0x60, 0x00, 0x02, 0x6E],
    mask: 'xxxxxxxxxxxx'
  },
  {
    name: 'Kobold #2 Virus',
    description: 'Destructive loader partition virus which alters the root allocation structure.',
    bytes: [0x4B, 0x4F, 0x42, 0x4F, 0x4C, 0x44, 0x23, 0x32, 0x20, 0x41, 0x4B, 0x54, 0x49, 0x56, 0x21], // "KOBOLD#2 AKTIV!"
    mask:  'x?xxxx?xxxxxxxx'
  },
  {
    name: 'Greenpeace Virus',
    description: 'An eco-themed resident boot sector virus that displays scrolltexts on boot and intercepts BIOS calls.',
    bytes: [0x48, 0xE7, 0xFF, 0xFE, 0x41, 0xFA, 0x00, 0x4C, 0x20, 0x3C],
    mask:  'xxxxxxxxxx'
  },
  {
    name: 'SCA Boot Virus',
    description: 'Classic boot-sector infector originally targeting Amiga architectures, occasionally written to ST images.',
    bytes: [0x53, 0x43, 0x41, 0x20, 0x56, 0x49, 0x52, 0x55, 0x53], // "SCA VIRUS"
    mask:  'xxxxxxxxx'
  },
  {
    name: 'Medway Boys Boot Virus',
    description: 'System vector and trap infector developed by the infamous scene group, hijacking system loader sectors.',
    bytes: [0x4D, 0x45, 0x44, 0x57, 0x41, 0x59, 0x20, 0x42, 0x4F, 0x59, 0x53], // "MEDWAY BOYS"
    mask:  'xxxxxxxxxxx'
  }
];

export const fileVirusSignatures: FileVirusSignature[] = [
  {
    name: 'Pluto File Virus',
    description: 'A virulent resident parasitical infector targeting assembly executable structures, appending its signature string payload PLUTO.',
    bytes: [0x50, 0x4C, 0x55, 0x54, 0x4F, 0x20, 0x56, 0x49, 0x52, 0x55, 0x53], // "PLUTO VIRUS"
    mask: 'xxxxxxxxxxx'
  },
  {
    name: 'Saddam File Virus',
    description: 'Destructive file infector appending offensive political statements of Saddam Hussein and corrupting system memory.',
    bytes: [0x53, 0x41, 0x44, 0x44, 0x41, 0x4D, 0x20, 0x48, 0x55, 0x53, 0x53, 0x45, 0x49, 0x4E], // "SADDAM HUSSEIN"
    mask: 'xxxxxxxxxxxxxx'
  },
  {
    name: 'Medway Boys File Infector',
    description: 'A virus developed by the Medway crew targeting executable application storage offsets.',
    bytes: [0x4D, 0x45, 0x44, 0x57, 0x41, 0x59, 0x20, 0x42, 0x4F, 0x59, 0x53], // "MEDWAY BOYS"
    mask: 'xxxxxxxxxxx'
  },
  {
    name: 'Byte Bandit File Infector',
    description: 'File-level replication of the harmful Byte Bandit segment sequence.',
    bytes: [0x42, 0x59, 0x54, 0x45, 0x20, 0x42, 0x41, 0x4E, 0x44, 0x49, 0x54], // "BYTE BANDIT"
    mask: 'xxxxxxxxxxx'
  }
];

/**
 * Performs a comprehensive scan on a floppy disk sector layout.
 * Evaluates execution architectures via a robust Tiered Priority engine.
 * @param diskBytes Raw disk image bytes
 * @param geometry Target disk geometric mapping
 * @returns Array containing discovered threat signatures
 */
export function scanLoadedDisk(
  diskBytes: Uint8Array | null,
  geometry: DiskGeometry | null
): VirusScanResult[] {
  const results: VirusScanResult[] = [];
  if (!diskBytes || !geometry) return results;

  // 1. ISOLATE SECTOR 0 (Boot Sector: 512 bytes)
  const sector0 = diskBytes.slice(0, 512);
  const sum = calculateBootChecksum(sector0);
  const isExecutable = (sum === 0x1234);

  // =========================================================================
  // TIER 1: SPECIFIC VIRUS SIGNATURE DATABASE (Boot Sector)
  // =========================================================================
  for (const sig of specificVirusSignatures) {
    const matchOffset = findMaskedPattern(sector0, sig);
    if (matchOffset !== -1) {
      if (sig.requiredString && !containsString(sector0, sig.requiredString)) {
        continue; // String check failed
      }
      results.push({
        virusFound: true,
        type: 'BootSector',
        name: sig.name,
        description: sig.description,
        target: 'Boot Sector (Sector 0)',
        offset: matchOffset,
        canDisinfect: true,
      });
    }
  }

  // =========================================================================
  // TIER 2: FILE-LEVEL SCANNING
  // =========================================================================
  try {
    const files = getAllDiskFilesRecursive(diskBytes, geometry, 0);
    for (const file of files) {
      if (file.isDir || file.size <= 0) continue;

      // Retrieve full file body
      let fileBytes = new Uint8Array(file.size);
      let bytesWritten = 0;
      const chain = getClusterChain(diskBytes, file.cluster as number, geometry);
      for (const cluster of chain) {
        const offset = geometry.dataAreaStart + (cluster - 2) * geometry.bytesPerCluster;
        const toRead = Math.min(geometry.bytesPerCluster, file.size - bytesWritten);
        if (offset + toRead <= diskBytes.length) {
          fileBytes.set(diskBytes.slice(offset, offset + toRead), bytesWritten);
        }
        bytesWritten += toRead;
      }

      // Scan file bytes
      for (const sig of fileVirusSignatures) {
        const matchOffset = findMaskedPattern(fileBytes, sig);
        if (matchOffset !== -1) {
          results.push({
            virusFound: true,
            type: 'File',
            name: sig.name,
            description: sig.description,
            target: `File: \\${file.name}`,
            offset: matchOffset,
            canDisinfect: true,
          });
        }
      }
    }
  } catch (err) {
    console.error('File-level scanning failed:', err);
  }

  // If specific, high-confidence viruses are identified, return immediately.
  if (results.length > 0) {
    return results;
  }

  // =========================================================================
  // TIER 3: KNOWN SAFE (WHITELISTED) EXECUTABLES (Boot Sector)
  // =========================================================================
  const safeSignatures: MaskedSignature[] = [
    {
      name: 'Rob Northen CopyLock',
      description: 'Legitimate commercial anti-piracy boot loader.',
      bytes: [0x52, 0x6F, 0x62, 0x20, 0x4E, 0x6F, 0x72, 0x74, 0x68, 0x65, 0x6E], // "Rob Northen"
      mask:  'xxxxxxxxxxx'
    },
    {
      name: 'FastCopy Formatter',
      description: 'Legitimate FastCopy custom formatted disk boot sector.',
      bytes: [0x46, 0x43, 0x4F, 0x50, 0x59], // "FCOPY"
      mask:  'xxxxx'
    },
    {
      name: 'Automation Menu Loader',
      description: 'Legitimate scene menu compilation boot code.',
      bytes: [0x41, 0x55, 0x54, 0x4F, 0x4D, 0x41, 0x54, 0x49, 0x4F, 0x4E], // "AUTOMATION"
      mask:  'xxxxxxxxxx'
    },
    {
      name: 'Benign TOS Boot Sector Jump',
      description: 'Standard safe Atari ST boot sector jump past geometry definitions.',
      bytes: [0x60, 0x00], // Matches standard BRA (0x60) displacement byte values cleanly
      mask:  'x?',
      fixedOffset: 0
    },
    {
      name: 'Benign DOS Boot Sector Jump (Short)',
      description: 'Standard safe DOS short jump used on PC-compatible hybrid formatted disks.',
      bytes: [0xEB, 0x00], // Matches standard JMP SHORT (0xEB) displacement byte values cleanly
      mask:  'x?',
      fixedOffset: 0
    },
    {
      name: 'Benign DOS Boot Sector Jump (Near)',
      description: 'Standard safe DOS near jump used on PC-compatible hybrid formatted disks.',
      bytes: [0xE9, 0x00, 0x00], // Matches standard JMP NEAR (0xE9) displacement byte values cleanly
      mask:  'x??',
      fixedOffset: 0
    }
  ];

  let isWhitelisted = false;
  for (const safeSig of safeSignatures) {
    if (findMaskedPattern(sector0, safeSig) !== -1) {
      if (safeSig.requiredString && !containsString(sector0, safeSig.requiredString)) {
        continue;
      }
      isWhitelisted = true;
      break; 
    }
  }

  if (isWhitelisted) {
    return results; // Clean exit; Sector is known and completely safe.
  }

  // =========================================================================
  // TIER 4: GENERIC FAMILY SIGNATURES & FALLBACK WARNINGS
  // =========================================================================
  const genericVirusSignatures: MaskedSignature[] = [
    {
      name: 'Ghost / MAD Virus Family (Generic)',
      description: 'A mutated or obfuscated variant of the Ghost/MAD family. Uses a recognizable register-dump loader stub.',
      bytes: [0x48, 0xE7, 0xFF, 0xFE],
      mask:  'xxxx'
    }
  ];

  for (const sig of genericVirusSignatures) {
    const matchOffset = findMaskedPattern(sector0, sig);
    if (matchOffset !== -1) {
      results.push({
        virusFound: true,
        type: 'BootSector',
        name: sig.name,
        description: sig.description,
        target: 'Boot Sector (Sector 0)',
        offset: matchOffset,
        canDisinfect: true,
      });
      return results; // Stop on first generic match
    }
  }

  // If we reach this point, the sector is executing code but matches NOTHING in our database.
  if (isExecutable) {
    results.push({
      virusFound: true,
      type: 'BootSector',
      name: 'Unrecognized Executable Boot Sector',
      description: 'The boot sector checksum validates to 0x1234, but its binary code sequence matches no known safe OS configurations.',
      target: 'Boot Sector (Sector 0)',
      canDisinfect: true,
    });
  }

  return results;
}

/**
 * Disinfects the target disk using the non-destructive vector demotion method.
 *
 * Rather than blindly zeroing out critical floppy descriptors:
 * 1. Preserves critical BIOS Parameter Block (BPB) metadata between bytes 11-27.
 * 2. Rewrites the entry branch pointer to jump cleanly past geometry definitions.
 * 3. Injects a permanent return anchor (0x4E75 RTS) at offset 30.
 * 4. Resets the final execution checksum words to zero, cleanly dropping execution flags.
 */
export function disinfectDisk(
  diskBytes: Uint8Array,
  geometry: DiskGeometry,
  issues: VirusScanResult[]
): Uint8Array {
  const cleanDisk = new Uint8Array(diskBytes);

  for (const issue of issues) {
    if (issue.type === 'BootSector') {
      // Step A: Patch initial entry instruction branch pointer to point past BPB geometry block
      // 0x60 0x1C is a benign branch instruction skipping to byte 30.
      cleanDisk[0] = 0x60;
      cleanDisk[1] = 0x1C;
      cleanDisk[2] = 0x00;
      cleanDisk[3] = 0x00;

      // Step B: Put a safe "RTS" (Return from Subroutine) exit instruction right at offset 30.
      cleanDisk[30] = 0x4E; // 68000 'RTS' byte 1
      cleanDisk[31] = 0x75; // 68000 'RTS' byte 2

      // Step C: Nullify virus identifiers to avoid subsequent flag alerts
      const cleanMarker = "CLEANED DISK";
      for (let i = 0; i < cleanMarker.length; i++) {
        cleanDisk[32 + i] = cleanMarker.charCodeAt(i);
      }

      // Step D: Zero out any residual signature opcodes outside the BPB
      if (issue.offset !== undefined) {
        const sweepLen = 16;
        for (let i = 0; i < sweepLen; i++) {
          const targetOffset = issue.offset + i;
          // Protects standard entry and BPB regions (0-29). Cleans payload offsets securely.
          if (targetOffset >= 30 && targetOffset < 510) {
            cleanDisk[targetOffset] = 0x00;
          }
        }
      }

      // Step E: Wipe out the execution checksum word at the sector tail (offsets 510-511).
      cleanDisk[510] = 0x00;
      cleanDisk[511] = 0x00;
    } else if (issue.type === 'File') {
      // For file-level disinfection: delete the file by changing directory first byte to 0xE5
      const prefix = "File: \\";
      if (issue.target.startsWith(prefix)) {
        const targetName = issue.target.substring(prefix.length).toUpperCase().trim();
        const files = getAllDiskFilesRecursive(cleanDisk, geometry, 0);
        const match = files.find(f => f.name.toUpperCase().trim() === targetName);
        if (match && match.diskOffset !== null) {
          // 1. Mark directory entry as deleted (0xE5)
          cleanDisk[match.diskOffset] = 0xE5;

          // 2. Free cluster chain in FAT table copies
          const chain = getClusterChain(cleanDisk, match.cluster as number, geometry);
          for (const cluster of chain) {
            writeFAT12EntryAllCopies(cleanDisk, cluster, 0x000, geometry);
          }
        }
      }
    }
  }

  return cleanDisk;
}

// Injects file-level infected mock files into root directory
function injectFileVirusHelper(
  infectedDisk: Uint8Array,
  fileName: string,
  fileExt: string,
  virusBytes: number[]
) {
  const view = new DataView(infectedDisk.buffer);
  const bytesPerSector = view.getUint16(11, true) || 512;
  const sectorsPerCluster = view.getUint8(13) || 2;
  const reservedSectors = view.getUint16(14, true) || 1;
  const numFats = view.getUint8(16) || 2;
  const rootEntries = view.getUint16(17, true) || 112;
  const sectorsPerFat = view.getUint16(22, true) || 3;

  const fatTableStart = reservedSectors * bytesPerSector;
  const singleFatSize = sectorsPerFat * bytesPerSector;
  const rootDirStart = fatTableStart + numFats * singleFatSize;
  const rootDirSectors = Math.floor((rootEntries * 32 + (bytesPerSector - 1)) / bytesPerSector);
  const dataAreaStart = rootDirStart + rootDirSectors * bytesPerSector;
  const bytesPerCluster = sectorsPerCluster * bytesPerSector;

  // Find a free root directory slot
  let dirOffset = -1;
  for (let off = rootDirStart; off < rootDirStart + rootEntries * 32; off += 32) {
    if (infectedDisk[off] === 0x00 || infectedDisk[off] === 0xE5) {
      dirOffset = off;
      break;
    }
  }

  if (dirOffset === -1) return;

  const namePadded = fileName.padEnd(8, ' ').substring(0, 8);
  const extPadded = fileExt.padEnd(3, ' ').substring(0, 3);
  for (let i = 0; i < 8; i++) infectedDisk[dirOffset + i] = namePadded.charCodeAt(i);
  for (let i = 0; i < 3; i++) infectedDisk[dirOffset + 8 + i] = extPadded.charCodeAt(i);

  infectedDisk[dirOffset + 11] = 0x00; // Normal file

  // Use cluster 2 for our mock infected file
  const startCluster = 2;
  infectedDisk[dirOffset + 26] = startCluster & 0xFF;
  infectedDisk[dirOffset + 27] = (startCluster >> 8) & 0xFF;

  const size = virusBytes.length;
  infectedDisk[dirOffset + 28] = size & 0xFF;
  infectedDisk[dirOffset + 29] = (size >> 8) & 0xFF;
  infectedDisk[dirOffset + 30] = (size >> 16) & 0xFF;
  infectedDisk[dirOffset + 31] = (size >> 24) & 0xFF;

  const fakeGeometry = {
    numFats,
    fatTableStart,
    sectorsPerFat,
    bytesPerSector
  } as any;
  writeFAT12EntryAllCopies(infectedDisk, startCluster, 0xFFF, fakeGeometry);

  const payloadOffset = dataAreaStart + (startCluster - 2) * bytesPerCluster;
  if (payloadOffset + size <= infectedDisk.length) {
    infectedDisk.set(new Uint8Array(virusBytes), payloadOffset);
  }
}

/**
 * Injects a simulated virus vector inside Sector 0 or file directory for testing purposes.
 * Automatically recalculates the boot sector checksum to ensure it executes on startup.
 */
export function injectTestVirus(
  diskBytes: Uint8Array,
  type: 'Signum' | 'Ghost' | 'PirateTrap' | 'Kobold' | 'MAD' | 'File' | 'Medway' | 'SCA' | 'ByteBandit' | 'Saddam' | 'MedwayFile'
): Uint8Array {
  const infectedDisk = new Uint8Array(diskBytes);

  if (type === 'Signum') {
    infectedDisk[0] = 0x60;
    infectedDisk[1] = 0x1C;
    const pattern = [0x41, 0xFA, 0xFF, 0xC4, 0x22, 0x79, 0x00, 0x00, 0x04, 0xC6, 0xD3, 0xFC];
    infectedDisk.set(pattern, 32);
  } else if (type === 'Ghost') {
    infectedDisk[0] = 0x60;
    infectedDisk[1] = 0x1C;
    const pattern = [0x48, 0xE7, 0xFF, 0xFE, 0x41, 0xFA, 0x00, 0x4C, 0x20, 0x3C, 0x00, 0x00, 0x04, 0x00, 0x22, 0x4F];
    infectedDisk.set(pattern, 28);
  } else if (type === 'MAD') {
    infectedDisk[0] = 0x60;
    infectedDisk[1] = 0x1C;
    const pattern = [0x48, 0xE7, 0xFF, 0xFE, 0x41, 0xFA, 0x00, 0x5E, 0x20, 0x7C, 0x00, 0x00, 0x04, 0x00, 0x2E, 0x0F];
    infectedDisk.set(pattern, 28);
  } else if (type === 'PirateTrap') {
    infectedDisk[0] = 0x60;
    infectedDisk[1] = 0x00;
    infectedDisk[2] = 0x00;
    infectedDisk[3] = 0x1C;
    const pattern = [0x4E, 0x4E, 0x4E, 0x4E, 0x91, 0x04, 0xAB, 0x00];
    infectedDisk.set(pattern, 4);

    const warningText = "*** The Pirate Trap ***";
    for (let i = 0; i < warningText.length; i++) {
      infectedDisk[0x1B4 + i] = warningText.charCodeAt(i);
    }
  } else if (type === 'Kobold') {
    infectedDisk[0] = 0x60;
    infectedDisk[1] = 0x1C;
    const pattern = [0x4B, 0x4F, 0x42, 0x4F, 0x4C, 0x44, 0x23, 0x32, 0x20, 0x41, 0x4B, 0x54, 0x49, 0x56, 0x21];
    infectedDisk.set(pattern, 48);
  } else if (type === 'Medway') {
    infectedDisk[0] = 0x60;
    infectedDisk[1] = 0x1C;
    const pattern = [0x4D, 0x45, 0x44, 0x57, 0x41, 0x59, 0x20, 0x42, 0x4F, 0x59, 0x53];
    infectedDisk.set(pattern, 32);
  } else if (type === 'SCA') {
    infectedDisk[0] = 0x60;
    infectedDisk[1] = 0x1C;
    const pattern = [0x53, 0x43, 0x41, 0x20, 0x56, 0x49, 0x52, 0x55, 0x53];
    infectedDisk.set(pattern, 32);
  } else if (type === 'File') {
    const plutoBytes = Array.from("PLUTO VIRUS INFECTION BINARY DATA SEQUENCE.").map(c => c.charCodeAt(0));
    injectFileVirusHelper(infectedDisk, "PLUTO", "PRG", plutoBytes);
  } else if (type === 'Saddam') {
    const saddamBytes = Array.from("SADDAM HUSSEIN DESTRUCTIVE THREAT CODE SEGMENT.").map(c => c.charCodeAt(0));
    injectFileVirusHelper(infectedDisk, "SADDAM", "PRG", saddamBytes);
  } else if (type === 'MedwayFile') {
    const medwayBytes = Array.from("THE MEDWAY BOYS FILE INJECTION TEST DATA.").map(c => c.charCodeAt(0));
    injectFileVirusHelper(infectedDisk, "MEDWAY", "PRG", medwayBytes);
  } else if (type === 'ByteBandit') {
    const banditBytes = Array.from("BYTE BANDIT BINARY FOOTPRINT SIMULATOR BLOCK.").map(c => c.charCodeAt(0));
    injectFileVirusHelper(infectedDisk, "BYTE", "PRG", banditBytes);
  }

  // Recalibrate boot sector checksum bytes 510-511 to ensure word-sum matches 0x1234 (so TOS executes it)
  infectedDisk[510] = 0;
  infectedDisk[511] = 0;
  
  const currentSum = calculateBootChecksum(infectedDisk);
  const diff = (0x1234 - currentSum) & 0xFFFF;
  
  infectedDisk[510] = (diff >> 8) & 0xFF;
  infectedDisk[511] = diff & 0xFF;

  return infectedDisk;
}
