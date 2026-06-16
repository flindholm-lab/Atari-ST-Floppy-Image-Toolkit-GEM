/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';
import {
  computeChksum,
  computeXmodemCrc,
  findChipMatch,
  ensureInitialized,
  KNOWN_ROMS,
  MatchedChipInfo,
} from '../utils/romUtils';

interface CabinetFile {
  id: string;
  name: string;
  data: Uint8Array;
  size: number;
  checksum: number;
  crc: number;
  matchedChip: MatchedChipInfo | null;
}

interface EPROMBaseSlot {
  key: string;
  label: string;
  expectedRole: string;
}

interface ROMMergerWindowProps {
  isOpen: boolean;
  onClose: () => void;
  activeId: string | null;
  onFocus: () => void;
  onInspectFile: (name: string, bytes: Uint8Array) => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  onLoadAsActiveROM: (name: string, bytes: Uint8Array) => void;
  // Dynamic linking from splitter
  presetParts: { name: string; data: Uint8Array }[];
  onClearPresets: () => void;
}

export default function ROMMergerWindow({
  isOpen,
  onClose,
  activeId,
  onFocus,
  onInspectFile,
  showToast,
  onLoadAsActiveROM,
  presetParts,
  onClearPresets,
}: ROMMergerWindowProps) {
  // Config modes
  const [mergeMode, setMergeMode] = useState<'2' | '4' | '6'>('2');
  const [cabinetFiles, setCabinetFiles] = useState<CabinetFile[]>([]);
  const [slotsData, setSlotsData] = useState<Record<string, string>>({}); // key slot.key -> cabinet value id

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOverActive, setDragOverActive] = useState<boolean>(false);

  // Sync preset files from splitter
  useEffect(() => {
    if (presetParts && presetParts.length > 0) {
      const parsed: CabinetFile[] = presetParts.map((p) => {
        const checksum = computeChksum(p.data);
        const crc = computeXmodemCrc(p.data);
        const matchedChip = findChipMatch(checksum, crc);
        return {
          id: 'preset-' + Math.random().toString(36).substring(2, 9),
          name: p.name,
          data: p.data,
          size: p.data.length,
          checksum,
          crc,
          matchedChip,
        };
      });

      setCabinetFiles((prev) => {
        // filter duplicates by name just in case
        const kept = prev.filter((prevItem) => !parsed.some((p) => p.name === prevItem.name));
        return [...kept, ...parsed];
      });

      // Show alert & switch mode if parts count fits
      let matchedMode: '2' | '4' | '6' | null = null;
      if (presetParts.length === 2) matchedMode = '2';
      else if (presetParts.length === 4) matchedMode = '4';
      else if (presetParts.length === 6) matchedMode = '6';

      if (matchedMode) {
        setMergeMode(matchedMode);
      }

      onClearPresets(); // empty bridge
      showToast(`Imported ${presetParts.length} files from Splitter into EPROM Cabinet.`, 'success');
    }
  }, [presetParts]);

  // Clean empty slot records on mode modification
  useEffect(() => {
    setSlotsData({});
  }, [mergeMode]);

  // Derive EPROM slot schemas
  const getSlotsSchema = (): EPROMBaseSlot[] => {
    if (mergeMode === '2') {
      return [
        { key: 'hi', label: 'Even (HI) Byte Socket', expectedRole: 'hi' },
        { key: 'lo', label: 'Odd (LO) Byte Socket', expectedRole: 'lo' },
      ];
    } else if (mergeMode === '4') {
      return [
        { key: 'ee', label: 'TT Byte Socket 0 [EE]', expectedRole: 'ee' },
        { key: 'oe', label: 'TT Byte Socket 1 [OE]', expectedRole: 'oe' },
        { key: 'eo', label: 'TT Byte Socket 2 [EO]', expectedRole: 'eo' },
        { key: 'oo', label: 'TT Byte Socket 3 [OO]', expectedRole: 'oo' },
      ];
    } else {
      return [
        { key: 'hi2', label: 'Even Bank 2 [Upper Address]', expectedRole: 'hi2' },
        { key: 'hi1', label: 'Even Bank 1 [Middle Address]', expectedRole: 'hi1' },
         { key: 'hi0', label: 'Even Bank 0 [Lower Address]', expectedRole: 'hi0' },
        { key: 'lo2', label: 'Odd Bank 2 [Upper Address]', expectedRole: 'lo2' },
        { key: 'lo1', label: 'Odd Bank 1 [Middle Address]', expectedRole: 'lo1' },
        { key: 'lo0', label: 'Odd Bank 0 [Lower Address]', expectedRole: 'lo0' },
      ];
    }
  };

  const schema = getSlotsSchema();

  // Automatic signature routing aligner
  const handleAutoAlign = () => {
    const list = getSlotsSchema();
    const updated: Record<string, string> = { ...slotsData };
    let aligned = 0;

    list.forEach((slot) => {
      // Find a file matching exactly database signature info
      let match = cabinetFiles.find((file) => {
        const alreadyUsed = Object.values(updated).includes(file.id);
        if (alreadyUsed) return false;
        return file.matchedChip && file.matchedChip.chip.toLowerCase() === slot.expectedRole.toLowerCase();
      });

      // Fallback name parsing
      if (!match) {
        match = cabinetFiles.find((file) => {
          const alreadyUsed = Object.values(updated).includes(file.id);
          if (alreadyUsed) return false;
          
          const nameLower = file.name.toLowerCase();
          const dotIdx = nameLower.lastIndexOf('.');
          const ext = dotIdx !== -1 ? nameLower.substring(dotIdx + 1) : nameLower;
          return ext === slot.key || nameLower.includes(`.${slot.key}`);
        });
      }

      if (match) {
        updated[slot.key] = match.id;
        aligned++;
      }
    });

    setSlotsData(updated);
    if (aligned > 0) {
      showToast(`Routed ${aligned} files to EPROM sockets automatically based on signatures/hints.`, 'success');
    } else {
      showToast('No matching signatures found in EPROM cabinet to map automatically.', 'info');
    }
  };

  const triggerChooser = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processIncomingFiles(e.target.files);
    }
  };

  const processIncomingFiles = (filesList: FileList) => {
    let loaded = 0;
    const added: CabinetFile[] = [];

    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const bytes = new Uint8Array(evt.target.result as ArrayBuffer);
          const checksum = computeChksum(bytes);
          const crc = computeXmodemCrc(bytes);
          const matchedChip = findChipMatch(checksum, crc);

          added.push({
            id: 'file-' + Math.random().toString(36).substring(2, 9),
            name: file.name,
            data: bytes,
            size: bytes.length,
            checksum,
            crc,
            matchedChip,
          });
        }
        loaded++;
        if (loaded === filesList.length) {
          setCabinetFiles((prev) => {
            // Filter names
            const filtered = prev.filter((p) => !added.some((a) => a.name === p.name));
            return [...filtered, ...added];
          });
          showToast(`Loaded ${added.length} file pieces into Cabinet. Use Auto-Align to route them!`, 'success');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // Drag and drop handoffs
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
      processIncomingFiles(e.dataTransfer.files);
    }
  };

  const assignFileToSlot = (slotKey: string, fileId: string) => {
    setSlotsData((prev) => ({
      ...prev,
      [slotKey]: fileId,
    }));
  };

  const unlinkSlot = (slotKey: string) => {
    setSlotsData((prev) => {
      const cur = { ...prev };
      delete cur[slotKey];
      return cur;
    });
  };

  const unlinkAll = () => {
    setSlotsData({});
    showToast('Unassigned all EPROM routing sockets.', 'info');
  };

  const deleteFromCabinet = (id: string) => {
    setCabinetFiles((prev) => prev.filter((f) => f.id !== id));
    setSlotsData((prev) => {
      const next = { ...prev };
      for (const [key, val] of Object.entries(next)) {
        if (val === id) delete next[key];
      }
      return next;
    });
  };

  // Routing status compiler
  const compileAssemblySpecs = () => {
    let allAssigned = true;
    let verifiedCount = 0;
    let roleMismatch = 0;
    let firstVersion: string | null = null;
    let mixedVersion = false;

    schema.forEach((slot) => {
      const fileId = slotsData[slot.key];
      if (!fileId) {
        allAssigned = false;
      } else {
        const file = cabinetFiles.find((f) => f.id === fileId);
        if (file) {
          if (file.matchedChip) {
            verifiedCount++;
            if (file.matchedChip.chip.toLowerCase() !== slot.expectedRole.toLowerCase()) {
              roleMismatch++;
            }
            if (!firstVersion) {
              firstVersion = file.matchedChip.version;
            } else if (firstVersion !== file.matchedChip.version) {
              mixedVersion = true;
            }
          }
        }
      }
    });

    return { allAssigned, verifiedCount, roleMismatch, firstVersion, mixedVersion };
  };

  const specs = compileAssemblySpecs();

  // Joint Assembler execute callback
  const handleAssembleAndLoad = () => {
    // 1. Max length
    let chunkLength = 0;
    schema.forEach((slot) => {
      const fileId = slotsData[slot.key];
      if (fileId) {
        const f = cabinetFiles.find((file) => file.id === fileId);
        if (f && f.data.length > chunkLength) {
          chunkLength = f.data.length;
        }
      }
    });

    if (chunkLength === 0) {
      showToast('EPROM data buffers appear completely empty.', 'error');
      return;
    }

    let finalROM: Uint8Array | null = null;
    let outName = 'assembled_atari_rom.img';

    if (mergeMode === '2') {
      finalROM = new Uint8Array(chunkLength * 2);
      const hiData = cabinetFiles.find((f) => f.id === slotsData.hi)?.data || new Uint8Array(chunkLength);
      const loData = cabinetFiles.find((f) => f.id === slotsData.lo)?.data || new Uint8Array(chunkLength);

      for (let i = 0; i < chunkLength; i++) {
        finalROM[i * 2] = hiData[i] !== undefined ? hiData[i] : 0x00;
        finalROM[i * 2 + 1] = loData[i] !== undefined ? loData[i] : 0x00;
      }
      outName = 'merged_2_chip.img';
    } else if (mergeMode === '4') {
      finalROM = new Uint8Array(chunkLength * 4);
      const ee = cabinetFiles.find((f) => f.id === slotsData.ee)?.data || new Uint8Array(chunkLength);
      const oe = cabinetFiles.find((f) => f.id === slotsData.oe)?.data || new Uint8Array(chunkLength);
      const eo = cabinetFiles.find((f) => f.id === slotsData.eo)?.data || new Uint8Array(chunkLength);
      const oo = cabinetFiles.find((f) => f.id === slotsData.oo)?.data || new Uint8Array(chunkLength);

      for (let i = 0; i < chunkLength; i++) {
        finalROM[i * 4] = ee[i] !== undefined ? ee[i] : 0x00;
        finalROM[i * 4 + 1] = oe[i] !== undefined ? oe[i] : 0x00;
        finalROM[i * 4 + 2] = eo[i] !== undefined ? eo[i] : 0x00;
        finalROM[i * 4 + 3] = oo[i] !== undefined ? oo[i] : 0x00;
      }
      outName = 'merged_tt_4_chip.img';
    } else if (mergeMode === '6') {
      const bankSize = chunkLength * 2; // high and low combined
      finalROM = new Uint8Array(bankSize * 3);

      const hi0 = cabinetFiles.find((f) => f.id === slotsData.hi0)?.data || new Uint8Array(chunkLength);
      const lo0 = cabinetFiles.find((f) => f.id === slotsData.lo0)?.data || new Uint8Array(chunkLength);
      const hi1 = cabinetFiles.find((f) => f.id === slotsData.hi1)?.data || new Uint8Array(chunkLength);
      const lo1 = cabinetFiles.find((f) => f.id === slotsData.lo1)?.data || new Uint8Array(chunkLength);
      const hi2 = cabinetFiles.find((f) => f.id === slotsData.hi2)?.data || new Uint8Array(chunkLength);
      const lo2 = cabinetFiles.find((f) => f.id === slotsData.lo2)?.data || new Uint8Array(chunkLength);

      for (let i = 0; i < chunkLength; i++) {
        // Bank 0
        finalROM[i * 2] = hi0[i] !== undefined ? hi0[i] : 0x00;
        finalROM[i * 2 + 1] = lo0[i] !== undefined ? lo0[i] : 0x00;

        // Bank 1
        finalROM[bankSize + i * 2] = hi1[i] !== undefined ? hi1[i] : 0x00;
        finalROM[bankSize + i * 2 + 1] = lo1[i] !== undefined ? lo1[i] : 0x00;

        // Bank 2
        finalROM[bankSize * 2 + i * 2] = hi2[i] !== undefined ? hi2[i] : 0x00;
        finalROM[bankSize * 2 + i * 2 + 1] = lo2[i] !== undefined ? lo2[i] : 0x00;
      }
      outName = 'merged_st_6_chip.img';
    }

    if (finalROM) {
      // auto-download
      const blob = new Blob([finalROM], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = outName;
      link.click();
      URL.revokeObjectURL(url);

      // Load it as the current active ROM in the user's workspace so they can inspect it!
      onLoadAsActiveROM(outName, finalROM);
      showToast(`Contiguous ROM successfully assembled! Auto-downloaded and loaded ${outName} in workspace.`, 'success');
    }
  };

  return (
    <GEMSkeletalWindow
      id="merger"
      title="TOS_MERGE.APP"
      isOpen={isOpen}
      onClose={onClose}
      defaultX={460}
      defaultY={40}
      width={460}
      activeId={activeId}
      onFocus={onFocus}
    >
      <div className="p-3 space-y-3 no-drag select-none font-mono">
        {/* Slot configs selection */}
        <div className="flex items-center justify-between border-b border-black pb-1.5">
          <span className="text-gem-normal font-bold uppercase underline leading-none">Assemble ROM block</span>
          
          <div className="flex gap-2">
            <select
              value={mergeMode}
              onChange={(e) => setMergeMode(e.target.value as '2' | '4' | '6')}
              className="bg-white border border-black text-gem-small font-bold px-1.5 py-0.5 outline-none rounded-none"
            >
              <option value="2">2 Parts (HI/LO)</option>
              <option value="4">4 Parts (TT0-TT3)</option>
              <option value="6">6 Parts (ST 3-Bank)</option>
            </select>
            <button
              onClick={handleAutoAlign}
              className="gem-btn text-gem-tiny py-0 px-2 font-bold cursor-pointer"
            >
              🪄 AUTO-ALIGN
            </button>
          </div>
        </div>

        {/* Drag multiple files banner */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={triggerChooser}
          className={`border border-dashed border-black p-3 text-center cursor-pointer transition flex flex-col items-center justify-center bg-white ${
            dragOverActive ? 'bg-gray-100' : 'hover:bg-gray-50'
          }`}
        >
          <span className="text-gem-normal font-bold uppercase">Drag and drop EPROM segments here</span>
          <span className="text-gem-tiny text-gray-500 mt-0.5">Or click to select multiple pieces</span>
        </div>

        {/* Cabinet imported parts list */}
        <div className="border border-black p-2 bg-gray-50 space-y-1.5 rounded">
          <div className="flex items-center justify-between border-b border-gray-300 pb-1">
            <span className="text-gem-small font-bold uppercase text-gray-700">Imported Parts Bin:</span>
            <span className="text-gem-tiny font-bold bg-black text-white px-2 rounded-sm select-all">
              {cabinetFiles.length} FILES
            </span>
          </div>
          
          <div className="space-y-1 max-h-[75px] overflow-y-auto pr-0.5">
            {cabinetFiles.length === 0 ? (
              <div className="text-center py-2 text-gray-400 italic text-gem-small uppercase">
                No parts in EPROM Bin. Load segments above.
              </div>
            ) : (
              cabinetFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between border border-gray-300 bg-white p-1 hover:bg-gray-50 text-gem-tiny"
                >
                  <span className="font-bold text-black truncate max-w-[50%] select-all" title={f.name}>
                    {f.name}
                  </span>
                  
                  <div className="flex items-center gap-1.5 shrink-0">
                    {f.matchedChip ? (
                      <span className="text-[10px] bg-emerald-600 font-bold text-white px-1 uppercase tracking-tighter" title="Signature verified">
                        ✓ {f.matchedChip.version} [{f.matchedChip.chip}]
                      </span>
                    ) : (
                      <span className="text-[10px] bg-yellow-500 font-bold text-black px-1 uppercase tracking-tight">
                        CUSTOM ({Math.round(f.size / 1024)}K)
                      </span>
                    )}
                    
                    <button
                      onClick={() => onInspectFile(f.name, f.data)}
                      className="text-black underline hover:font-bold cursor-pointer font-medium text-[10px]"
                    >
                      Inspect
                    </button>
                    
                    <button
                      onClick={() => deleteFromCabinet(f.id)}
                      className="text-red-600 font-bold hover:underline cursor-pointer px-1 text-[11px]"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Dynamic Sockets Schema Placement Grid */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-gem-small font-bold uppercase underline">PCB Chip Routing Matrix:</span>
            <button
              onClick={unlinkAll}
              className="text-gem-tiny font-bold text-red-600 hover:underline cursor-pointer"
            >
              UNASSIGN ALL
            </button>
          </div>

          <div className="grid grid-cols-1 gap-1.5 max-h-[160px] overflow-y-auto pr-0.5">
            {schema.map((slot) => {
              const fileId = slotsData[slot.key];
              const assignedFile = cabinetFiles.find((f) => f.id === fileId);

              // Check if assignment role is correct
              let isMatch = false;
              let hasChip = false;
              if (assignedFile) {
                hasChip = true;
                if (assignedFile.matchedChip) {
                  isMatch = assignedFile.matchedChip.chip.toLowerCase() === slot.expectedRole.toLowerCase();
                } else {
                  // custom files are allowed as custom matches
                  isMatch = true;
                }
              }

              return (
                <div
                  key={slot.key}
                  id={`merge-slot-card-${slot.key}`}
                  className={`border border-black p-1.5 bg-white text-gem-small flex flex-col gap-1 transition-colors ${
                    assignedFile ? 'bg-[#f8f8f8]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-gray-200 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-black text-gem-small">{slot.label}</span>
                      <span className="bg-black text-white px-1 text-[9px] font-bold tracking-wider rounded-sm uppercase">
                        {slot.key.toUpperCase()}
                      </span>
                    </div>

                    <span
                      className={`text-[9px] font-bold border px-1 rounded-sm ${
                        !hasChip
                          ? 'border-gray-300 text-gray-400 bg-gray-50'
                          : isMatch
                          ? 'border-emerald-600 text-emerald-700 bg-emerald-50'
                          : 'border-rose-600 text-rose-700 bg-rose-50'
                      }`}
                    >
                      {!hasChip ? 'UNASSIGNED' : isMatch ? '✓ CHIP ROUTED' : '⚠ ALIGN ERROR'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={fileId || ''}
                      onChange={(e) => assignFileToSlot(slot.key, e.target.value)}
                      className="flex-grow bg-white border border-black text-gem-tiny p-0.5 font-mono outline-none rounded-none w-10 truncate"
                    >
                      <option value="">[ Map EPROM Cabinet Component... ]</option>
                      {cabinetFiles.map((cab) => (
                        <option key={cab.id} value={cab.id}>
                          {cab.name} ({Math.round(cab.size / 1024)}KB)
                          {cab.matchedChip ? ` [${cab.matchedChip.version} - ${cab.matchedChip.chip}]` : ' [custom]'}
                        </option>
                      ))}
                    </select>

                    {hasChip && (
                      <button
                        onClick={() => unlinkSlot(slot.key)}
                        className="text-rose-600 font-bold hover:underline cursor-pointer text-gem-tiny shrink-0"
                      >
                        Unlink
                      </button>
                    )}
                  </div>

                  {assignedFile && (
                    <div className="text-[10px] text-gray-400 leading-none flex items-center justify-between border-t border-dashed border-gray-200 pt-1 mt-0.5">
                      <span>SIZE: {assignedFile.size.toLocaleString()}B | CRC: 0x{assignedFile.crc.toString(16).toUpperCase()}</span>
                      
                      {assignedFile.matchedChip && (
                        <span className={`font-bold ${isMatch ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {isMatch
                            ? `${assignedFile.matchedChip.version} [${assignedFile.matchedChip.chip}]`
                            : `Expected HI/LO mismatch: Has ${assignedFile.matchedChip.chip}`}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Assembly state alerts and launch button */}
        <div className="pt-2 border-t border-black flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-200">
          <div className="text-left font-mono">
            <span className="text-[9px] text-gray-500 block leading-none font-bold">MONITOR ASSEMBLY:</span>
            {!specs.allAssigned ? (
              <span className="text-gem-tiny font-bold text-rose-600 block mt-0.5">PENDING SOCKET ASSIGNMENTS</span>
            ) : specs.roleMismatch > 0 ? (
              <span className="text-gem-tiny font-bold text-yellow-600 block mt-0.5 animate-pulse">
                ⚠ PCB ALIGNMENT ERROR DETECTED ({specs.roleMismatch} CHIPS)
              </span>
            ) : specs.mixedVersion ? (
              <span className="text-gem-tiny font-bold text-yellow-600 block mt-0.5">
                ⚠ WARNING: DETECTED MIXED BIOS REVISIONS
              </span>
            ) : specs.firstVersion ? (
              <span className="text-gem-tiny font-bold text-emerald-600 block mt-0.5">
                ✓ VERIFIED: ${specs.firstVersion}
              </span>
            ) : (
              <span className="text-gem-tiny font-bold text-blue-600 block mt-0.5">
                ✓ ROM READY (CUSTOM REVISION)
              </span>
            )}
          </div>

          <button
            onClick={handleAssembleAndLoad}
            disabled={!specs.allAssigned}
            className="gem-btn text-gem-small py-1 px-3 block font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
          >
            🧩 ASSEMBLE ROM
          </button>
        </div>
      </div>
    </GEMSkeletalWindow>
  );
}
