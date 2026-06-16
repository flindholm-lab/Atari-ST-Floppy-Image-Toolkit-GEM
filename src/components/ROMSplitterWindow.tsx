/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';
import {
  identifyROM,
  computeCRC32,
  get2ChipParts,
  get4ChipParts,
  get6ChipParts,
  computeXmodemCrc,
} from '../utils/romUtils';

interface ROMSplitterWindowProps {
  isOpen: boolean;
  onClose: () => void;
  activeId: string | null;
  onFocus: () => void;
  onInspectFile: (name: string, bytes: Uint8Array) => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  // External triggers to default load merger's slots with auto alignment
  onRegisterGeneratedParts: (parts: { name: string; data: Uint8Array }[]) => void;
  initialRom?: { name: string; bytes: Uint8Array } | null;
}

interface SplitPart {
  name: string;
  data: Uint8Array;
  type: string;
}

export default function ROMSplitterWindow({
  isOpen,
  onClose,
  activeId,
  onFocus,
  onInspectFile,
  showToast,
  onRegisterGeneratedParts,
  initialRom,
}: ROMSplitterWindowProps) {
  const [loadedROMName, setLoadedROMName] = useState<string>('');
  const [loadedROMBytes, setLoadedROMBytes] = useState<Uint8Array | null>(null);
  const [romIdentity, setRomIdentity] = useState<string>('');
  const [crc32Str, setCrc32Str] = useState<string>('');
  const [splitParts, setSplitParts] = useState<SplitPart[]>([]);

  useEffect(() => {
    if (initialRom) {
      setLoadedROMBytes(initialRom.bytes);
      setLoadedROMName(initialRom.name);

      const ident = identifyROM(initialRom.bytes);
      setRomIdentity(ident);

      const crc = computeCRC32(initialRom.bytes);
      setCrc32Str("0x" + crc.toString(16).toUpperCase().padStart(8, '0'));
      setSplitParts([]); // reset previous split views
    }
  }, [initialRom]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOverActive, setDragOverActive] = useState<boolean>(false);

  // Trigger input selection
  const triggerChooser = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processROMFile(e.target.files[0]);
    }
  };

  const processROMFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) {
        const bytes = new Uint8Array(evt.target.result as ArrayBuffer);
        setLoadedROMBytes(bytes);
        setLoadedROMName(file.name);
        
        // Calculate identity
        const ident = identifyROM(bytes);
        setRomIdentity(ident);

        // Calculate CRC32
        const crc = computeCRC32(bytes);
        setCrc32Str("0x" + crc.toString(16).toUpperCase().padStart(8, '0'));

        showToast(`Successfully processed ROM: ${file.name} (${Math.round(bytes.length / 1024)}KB)`, 'success');
        setSplitParts([]); // reset any previous splits
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Splitting control loop
  const executeSplit = (partCount: number) => {
    if (!loadedROMBytes) {
      showToast('Please load a valid Atari ROM image block first.', 'error');
      return;
    }

    const cleanName = loadedROMName.substring(0, loadedROMName.lastIndexOf('.')) || loadedROMName;
    const parts: SplitPart[] = [];

    if (partCount === 2) {
      const partsObj = get2ChipParts(loadedROMBytes);
      parts.push({ name: `${cleanName}.HI`, data: partsObj.hi, type: 'Even Byte (HI EPROM / Chip 0)' });
      parts.push({ name: `${cleanName}.LO`, data: partsObj.lo, type: 'Odd Byte (LO EPROM / Chip 1)' });
    } else if (partCount === 4) {
      const partsObj = get4ChipParts(loadedROMBytes);
      parts.push({ name: `${cleanName}.EE`, data: partsObj.ee, type: 'TT 32-bit segment [EE]' });
      parts.push({ name: `${cleanName}.OE`, data: partsObj.oe, type: 'TT 32-bit segment [OE]' });
      parts.push({ name: `${cleanName}.EO`, data: partsObj.eo, type: 'TT 32-bit segment [EO]' });
      parts.push({ name: `${cleanName}.OO`, data: partsObj.oo, type: 'TT 32-bit segment [OO]' });
    } else if (partCount === 6) {
      const partsObj = get6ChipParts(loadedROMBytes);
      parts.push({ name: `${cleanName}.HI2`, data: partsObj.hi2, type: 'Even Bank 2 [Upper Address]' });
      parts.push({ name: `${cleanName}.HI1`, data: partsObj.hi1, type: 'Even Bank 1 [Middle Address]' });
      parts.push({ name: `${cleanName}.HI0`, data: partsObj.hi0, type: 'Even Bank 0 [Lower Address]' });
      parts.push({ name: `${cleanName}.LO2`, data: partsObj.lo2, type: 'Odd Bank 2 [Upper Address]' });
      parts.push({ name: `${cleanName}.LO1`, data: partsObj.lo1, type: 'Odd Bank 1 [Middle Address]' });
      parts.push({ name: `${cleanName}.LO0`, data: partsObj.lo0, type: 'Odd Bank 0 [Lower Address]' });
    }

    setSplitParts(parts);
    showToast(`Compiled ROM successfully partitioned into ${parts.length} memory bank segments.`, 'success');

    // Automatically align these generated parts inside our ROM merger's pool if needed!
    onRegisterGeneratedParts(parts);
  };

  const downloadPart = (p: SplitPart) => {
    const blob = new Blob([p.data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = p.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    splitParts.forEach((p, idx) => {
      setTimeout(() => {
        downloadPart(p);
      }, idx * 150);
    });
  };

  // Drag and drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverActive(true);
  };

  const handleDragLeave = () => {
    setDragOverActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processROMFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <GEMSkeletalWindow
      id="splitter"
      title="TOS_SPLIT.APP"
      isOpen={isOpen}
      onClose={onClose}
      defaultX={40}
      defaultY={40}
      width={400}
      activeId={activeId}
      onFocus={onFocus}
    >
      <div className="p-3 space-y-3 no-drag select-none font-mono">
        
        {/* Step 1: Load Image Zone */}
        <div className="border border-black p-2.5 space-y-2 bg-white relative">
          <h3 className="text-gem-normal font-bold text-black uppercase underline">
            1. Load ROM Image Block
          </h3>

          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
          />

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={triggerChooser}
            className={`border border-dashed border-black p-3 text-center cursor-pointer transition flex flex-col items-center justify-center ${
              dragOverActive ? 'bg-gray-100 animate-pulse' : 'hover:bg-gray-50'
            }`}
          >
            <span className="text-gem-normal font-bold">DRAG ROM IMAGE HERE</span>
            <span className="text-gem-tiny text-gray-500 mt-1">Or click to browse storage files</span>
          </div>

          {/* ROM Metadata visual specs */}
          {loadedROMBytes && (
            <div className="pt-2 border-t border-dashed border-black space-y-1 text-gem-small">
              <div className="truncate">NAME: <span className="font-bold">{loadedROMName}</span></div>
              <div>SIZE: <span className="font-bold">{loadedROMBytes.length.toLocaleString()} BYTES</span></div>
              <div>CRC32: <span className="font-bold">{crc32Str}</span></div>
              <div className="bg-black text-white px-2 py-0.5 mt-1.5 text-gem-tiny font-bold text-center uppercase tracking-wider">
                {romIdentity}
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Split Controls */}
        <div className="border border-black p-2.5 space-y-2 relative bg-white">
          {!loadedROMBytes && (
            <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center text-center z-10 p-4 border border-black">
              <span className="text-gem-normal font-bold border border-black p-1.5 bg-gray-50 uppercase shadow-sm">
                Unlock with custom ROM block!
              </span>
            </div>
          )}

          <h3 className="text-gem-normal font-bold text-black uppercase underline">
            2. Partition/Split Target
          </h3>

          <div className="grid grid-cols-1 gap-1.5 pt-0.5">
            <button
              onClick={() => executeSplit(2)}
              className="text-left border border-black p-1.5 text-gem-small flex justify-between items-center hover:bg-black hover:text-white group cursor-pointer"
            >
              <div>
                <span className="font-bold block">Split into 2 parts (HI/LO)</span>
                <span className="text-gem-tiny text-gray-400 group-hover:text-gray-300">Atari STe / Falcon 16-bit bus</span>
              </div>
              <span className="border border-black px-1 text-gem-tiny font-bold bg-white text-black text-[9px]">.HI/.LO</span>
            </button>

            <button
              onClick={() => executeSplit(4)}
              className="text-left border border-black p-1.5 text-gem-small flex justify-between items-center hover:bg-black hover:text-white group cursor-pointer"
            >
              <div>
                <span className="font-bold block">Split into 4 parts (TT0-TT3)</span>
                <span className="text-gem-tiny text-gray-400 group-hover:text-gray-300">Atari TT 32-bit interleave</span>
              </div>
              <span className="border border-black px-1 text-gem-tiny font-bold bg-white text-black text-[9px]">4 CHIPS</span>
            </button>

            <button
              onClick={() => executeSplit(6)}
              className="text-left border border-black p-1.5 text-gem-small flex justify-between items-center hover:bg-black hover:text-white group cursor-pointer"
            >
              <div>
                <span className="font-bold block">Split into 6 parts (Early ST)</span>
                <span className="text-gem-tiny text-gray-400 group-hover:text-gray-300">ST 6-chip matrix layout</span>
              </div>
              <span className="border border-black px-1 text-gem-tiny font-bold bg-white text-black text-[9px]">6 CHIPS</span>
            </button>
          </div>
        </div>

        {/* Step 3: Split download panel */}
        {splitParts.length > 0 && (
          <div className="border border-black p-2.5 space-y-2 bg-white">
            <div className="flex items-center justify-between border-b border-black pb-1">
              <h3 className="text-gem-normal font-bold uppercase underline">Generated Parts</h3>
              <button
                onClick={downloadAll}
                className="gem-btn text-gem-small py-0.5 px-2 cursor-pointer font-bold"
              >
                DOWNLOAD ALL
              </button>
            </div>
            
            <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-0.5">
              {splitParts.map((p, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between border border-black p-1 bg-white text-gem-tiny select-none"
                >
                  <div className="flex-grow truncate pr-2">
                    <span className="font-bold text-black block truncate">{p.name}</span>
                    <span className="text-gray-500 block leading-none mt-0.5 truncate uppercase">
                      {p.type} | {p.data.length.toLocaleString()}B
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => onInspectFile(p.name, p.data)}
                      className="gem-btn py-0 px-1 font-bold cursor-pointer whitespace-nowrap bg-gray-50 text-[10px]"
                      title="Inspect in Hex Viewer"
                    >
                      HEX VIEW
                    </button>
                    <button
                      onClick={() => downloadPart(p)}
                      className="gem-btn py-0 px-1.5 font-bold cursor-pointer whitespace-nowrap text-[10px]"
                    >
                      DL
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </GEMSkeletalWindow>
  );
}
