/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';
import { DiskGeometry } from '../types';
import { calculateBootChecksum } from '../utils/virusScanner';

interface BootBlockCreatorWindowProps {
  isOpen: boolean;
  onClose: () => void;
  activeId: string;
  onFocus: () => void;
  mobileMode?: boolean;
  diskBytes: Uint8Array | null;
  geometry: DiskGeometry | null;
  onDiskModified: (updatedBytes: Uint8Array) => void;
  showToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export default function BootBlockCreatorWindow({
  isOpen,
  onClose,
  activeId,
  onFocus,
  mobileMode,
  diskBytes,
  geometry,
  onDiskModified,
  showToast,
}: BootBlockCreatorWindowProps) {
  const [template, setTemplate] = useState<'standard' | 'scrolltext' | 'shield'>('standard');
  const [customText, setCustomText] = useState<string>('ATARI ST DISK SYSTEM LOADED 2026');

  const handleCreateBootBlock = () => {
    if (!diskBytes) {
      showToast('No floppy disk image inserted in Drive A: to modify.', 'error');
      return;
    }

    const newDisk = new Uint8Array(diskBytes);
    const sector0 = newDisk.subarray(0, 512);

    // 1. Clear previous executable code while preserving the basic BPB metrics (offset 11 to 29)
    for (let i = 30; i < 512; i++) {
      sector0[i] = 0;
    }

    // 2. Put branch instruction to jump to offset 30: BRA.S +$1C (Offset 30 = PC 2 + displacement 28)
    sector0[0] = 0x60;
    sector0[1] = 0x1C;

    // 3. Write 68000 program code starting at offset 30
    // pea 118(PC)          => 48 7A 00 76  (push string address at offset 30 + 2 + 118 = 150)
    // move.w #9, -(SP)     => 3F 3C 00 09  (GEMDOS Cconws)
    // trap #1              => 4E 41
    // addq.l #6, SP        => 5C 8F        (clean stack)
    // move.w #7, -(SP)     => 3F 3C 00 07  (GEMDOS Crawcin / wait key without echo)
    // trap #1              => 4E 41
    // addq.l #2, SP        => 54 8F        (clean stack)
    // rts                  => 4E 75        (return cleanly to TOS/EmuTOS)
    const code = [
      0x48, 0x7A, 0x00, 0x76,
      0x3F, 0x3C, 0x00, 0x09,
      0x4E, 0x41,
      0x5C, 0x8F,
      0x3F, 0x3C, 0x00, 0x07,
      0x4E, 0x41,
      0x54, 0x8F,
      0x4E, 0x75
    ];
    for (let i = 0; i < code.length; i++) {
      sector0[30 + i] = code[i];
    }

    // 4. Fill in formatted Boot program text starting at offset 150
    let plainText = '';
    if (template === 'standard') {
      plainText = 'SYSTEM LOADER v1.0 STATUS: READY.';
    } else if (template === 'scrolltext') {
      plainText = `SCROLLER: ${customText.toUpperCase()}`;
    } else if (template === 'shield') {
      plainText = 'AV-SHIELD RESIDENT ANTIVIRUS LOADER v4.2.';
    }

    // Beautiful retro console card layout
    const fullMessage = 
      "\r\n\r\n" +
      "================================================\r\n" +
      "          A T A R I   S T   B O O T             \r\n" +
      "================================================\r\n" +
      "\r\n" +
      "  STATUS: " + plainText + "\r\n" +
      "\r\n" +
      "------------------------------------------------\r\n" +
      "  PRESS ANY KEY TO CONTINUE SYSTEM BOOT...      \r\n" +
      "================================================\r\n" +
      "\r\n\r\n\0";

    // Place message at offset 150
    for (let i = 0; i < Math.min(fullMessage.length, 350); i++) {
      sector0[150 + i] = fullMessage.charCodeAt(i);
    }

    // Zero out old checksum word at the end (510, 511)
    sector0[510] = 0;
    sector0[511] = 0;

    // 5. Compute and apply Atari ST executable floppy checksum.
    // Sum of 16-bit words of sector 0 must equal 0x1234
    const currentSum = calculateBootChecksum(sector0);
    const diff = (0x1234 - currentSum) & 0xFFFF;
    sector0[510] = (diff >> 8) & 0xFF;
    sector0[511] = diff & 0xFFFF & 0xFF;

    onDiskModified(newDisk);
    showToast(`Compiled & injected BOOT sector. Checksum correct (0x1234)`, 'success');
  };

  return (
    <GEMSkeletalWindow
      id="bootblockcreator"
      title="BOOTGEN.PRG"
      isOpen={isOpen}
      onClose={onClose}
      defaultX={160}
      defaultY={140}
      width={480}
      activeId={activeId}
      onFocus={onFocus}
      mobileMode={mobileMode}
    >
      <div className="bg-white p-4 font-mono text-gem-normal no-drag flex flex-col gap-4 select-none">
        
        {/* HEADER SECTION */}
        <div className="flex items-center gap-3 border-b-2 border-black pb-2">
          <div className="p-1.5 bg-sky-100 border border-black text-sky-700">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-gem-medium leading-none">BOOTGEN.PRG</h2>
            <span className="text-gem-tiny text-gray-500 uppercase">Atari boot-scroller &amp; sector builder v1.1</span>
          </div>
        </div>

        {geometry?.isFallback && (
          <div className="bg-red-50 text-red-900 border-2 border-red-400 p-2 text-gem-small text-center font-bold uppercase animate-pulse">
            ⚠️ FALLBACK ACTIVE: NON-COMPLIANT OR FAKED DOUBLE-SIDED STORAGE ACTIVE. BOOT-SECTOR WRITE PRESERVES REALIGNED SINGLE-SIDED BPB FLAGS.
          </div>
        )}

        {/* WORKSPACE PREVIEW */}
        <div className="flex flex-col gap-3">
          <label className="text-gem-small font-bold block uppercase">Select Boot-Sector Template:</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setTemplate('standard')}
              className={`border-2 border-black p-2 font-bold text-gem-small transition ${
                template === 'standard' ? 'bg-black text-white' : 'bg-white hover:bg-gray-150'
              }`}
            >
              💼 STANDARD
              <span className="text-[8px] block font-normal opacity-70 mt-1">Make Disk bootable</span>
            </button>
            
            <button
              onClick={() => setTemplate('scrolltext')}
              className={`border-2 border-black p-2 font-bold text-gem-small transition ${
                template === 'scrolltext' ? 'bg-black text-white' : 'bg-white hover:bg-gray-150'
              }`}
            >
              💬 SCROLLTEXT
              <span className="text-[8px] block font-normal opacity-70 mt-1">With custom message</span>
            </button>

            <button
              onClick={() => setTemplate('shield')}
              className={`border-2 border-black p-2 font-bold text-gem-small transition ${
                template === 'shield' ? 'bg-black text-white' : 'bg-white hover:bg-gray-150'
              }`}
            >
              🛡️ AV-SHIELD
              <span className="text-[8px] block font-normal opacity-70 mt-1">Boot Antivirus Shield</span>
            </button>
          </div>
        </div>

        {/* CUSTOM MESSAGE INPUT (If scrolltext selected) */}
        {template === 'scrolltext' && (
          <div className="flex flex-col gap-1.5 border border-black p-3 bg-gray-50">
            <label className="text-gem-tiny font-bold text-gray-600 uppercase">Custom Scrolltext (Max 64 chars):</label>
            <input
              type="text"
              maxLength={64}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              className="border border-black p-1 bg-white font-mono text-gem-small w-full font-bold uppercase accent-black"
            />
          </div>
        )}

        {/* ACTION BUTTON */}
        <button
          onClick={handleCreateBootBlock}
          disabled={!diskBytes}
          className="border-2 border-black bg-white hover:bg-black hover:text-white active:translate-y-0.5 font-bold py-2 px-4 shadow-sm text-gem-small transition disabled:opacity-40"
        >
          ⚙️ COMPILE AND WRITE BOOT CODE (SECTOR 0)
        </button>

        <p className="text-[9px] text-gray-500 italic text-center">
          *Writes directly to sector 0 and updates the header word-checksum to ensure real Atari ST system execution.
        </p>

      </div>
    </GEMSkeletalWindow>
  );
}
