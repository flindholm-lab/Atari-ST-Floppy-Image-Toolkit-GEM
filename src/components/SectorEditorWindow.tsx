/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';
import { DiskGeometry } from '../types';

interface SectorEditorWindowProps {
  isOpen: boolean;
  onClose: () => void;
  activeId: string;
  onFocus: () => void;
  mobileMode?: boolean;
  diskBytes: Uint8Array | null;
  geometry: DiskGeometry | null;
  onDiskModified: (updatedBytes: Uint8Array) => void;
  showToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  sectorNum: number;
  onSectorChange: (val: number) => void;
  expertMode?: boolean;
}

export default function SectorEditorWindow({
  isOpen,
  onClose,
  activeId,
  onFocus,
  mobileMode,
  diskBytes,
  geometry,
  onDiskModified,
  showToast,
  sectorNum,
  onSectorChange,
  expertMode = false,
}: SectorEditorWindowProps) {
  const [sectorData, setSectorData] = useState<Uint8Array>(new Uint8Array(512));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [isModified, setIsModified] = useState(false);

  const totalSectors = geometry ? geometry.totalSectors : 1440;

  // Load sector bytes whenever sector number or disk bytes changes
  useEffect(() => {
    if (!diskBytes) {
      setSectorData(new Uint8Array(512));
      setIsModified(false);
      return;
    }
    const offset = sectorNum * 512;
    if (offset + 512 <= diskBytes.length) {
      setSectorData(diskBytes.slice(offset, offset + 512));
    } else {
      setSectorData(new Uint8Array(512));
    }
    setIsModified(false);
    setEditingIndex(null);
  }, [sectorNum, diskBytes]);

  const handleSectorChange = (val: number) => {
    if (isModified) {
      if (!window.confirm('Discard unsaved sector edits?')) return;
    }
    const num = Math.max(0, Math.min(val, totalSectors - 1));
    onSectorChange(num);
  };

  const handleCellClick = (idx: number) => {
    if (!expertMode) {
      showToast('You must enable Expert Mode in Settings to edit sectors.', 'error');
      return;
    }
    setEditingIndex(idx);
    setEditingValue(sectorData[idx].toString(16).toUpperCase().padStart(2, '0'));
  };

  const handleCellBlur = () => {
    if (editingIndex === null) return;
    
    // Parse hexadecimal
    let cleaned = editingValue.replace(/[^0-9A-Fa-f]/g, '').slice(0, 2);
    if (!cleaned) cleaned = '00';
    const val = parseInt(cleaned, 16);
    
    if (val !== sectorData[editingIndex]) {
      const copy = new Uint8Array(sectorData);
      copy[editingIndex] = val;
      setSectorData(copy);
      setIsModified(true);
    }
    setEditingIndex(null);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCellBlur();
    } else if (e.key === 'Escape') {
      setEditingIndex(null);
    }
  };

  const handleSaveSector = () => {
    if (!expertMode) {
      showToast('You must enable Expert Mode in Settings to edit sectors.', 'error');
      return;
    }
    if (!diskBytes) return;
    
    const updatedDisk = new Uint8Array(diskBytes);
    updatedDisk.set(sectorData, sectorNum * 512);
    onDiskModified(updatedDisk);
    setIsModified(false);
    showToast(`Sector ${sectorNum} committed to floppy layout.`, 'success');
  };

  // Helper arrays for layout index lists
  const rows = Array.from({ length: 32 }, (_, i) => i * 16);

  return (
    <GEMSkeletalWindow
      id="sectoreditor"
      title="SECTOR.PRG"
      isOpen={isOpen}
      onClose={onClose}
      defaultX={120}
      defaultY={100}
      width={720}
      activeId={activeId}
      onFocus={onFocus}
      mobileMode={mobileMode}
    >
      <div className="bg-white p-3 font-mono text-gem-normal no-drag flex flex-col gap-3 select-none">
        
        {!expertMode && (
          <div className="bg-amber-50 text-amber-900 border-2 border-dashed border-amber-300 p-2 text-gem-small text-center font-bold">
            🔒 READ DIRECTORY & SECTORS MODE: Altering is restricted. Enable "Expert Mode" under "Settings" to edit raw sectors.
          </div>
        )}

        {geometry?.isFallback && (
          <div className="bg-red-50 text-red-900 border-2 border-red-400 p-2 text-gem-small text-center font-bold uppercase animate-pulse">
            ⚠️ FALLBACK ACTIVE: NON-COMPLIANT OR FAKED DOUBLE-SIDED LAYOUT SCAN-CORRECTED TO PIT-REALIGNED SINGLE-SIDED STORAGE
          </div>
        )}

        {/* TOP SELECTOR BAR */}
        <div className="flex items-center justify-between border-b border-black pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-1">
            <span className="font-bold">SECTOR:</span>
            <input
              type="number"
              min={0}
              max={totalSectors - 1}
              value={sectorNum}
              onChange={(e) => handleSectorChange(parseInt(e.target.value) || 0)}
              className="border-2 border-black px-1 py-0.5 w-16 text-center text-gem-small font-bold"
            />
            <span className="text-gray-400 text-gem-tiny uppercase">/ {totalSectors - 1}</span>
          </div>

          <div className="flex gap-1">
            <button
              onClick={() => handleSectorChange(sectorNum - 1)}
              disabled={sectorNum <= 0}
              className="border border-black hover:bg-black hover:text-white px-2 py-0.5 text-gem-tiny font-bold disabled:opacity-40"
            >
              ◀ PREV
            </button>
            <button
              onClick={() => handleSectorChange(sectorNum + 1)}
              disabled={sectorNum >= totalSectors - 1}
              className="border border-black hover:bg-black hover:text-white px-2 py-0.5 text-gem-tiny font-bold disabled:opacity-40"
            >
              NEXT ▶
            </button>
            <button
              onClick={() => handleSectorChange(0)}
              className="border border-black hover:bg-black hover:text-white px-2 py-0.5 text-gem-tiny font-bold hidden sm:block"
            >
              BOOT (0)
            </button>
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={handleSaveSector}
              disabled={!expertMode || !isModified || !diskBytes}
              className={`border-2 border-black px-3 py-0.5 font-bold text-gem-small shadow-sm transition active:translate-y-0.5 ${
                expertMode && isModified 
                  ? 'bg-amber-400 hover:bg-amber-500 animate-pulse' 
                  : 'bg-gray-100 opacity-60 pointer-events-none'
              }`}
            >
              {expertMode ? '💾 SAVE SECTOR' : '🔒 READ ONLY'}
            </button>
          </div>
        </div>

        {/* HEX RENDERING VIEWPORT */}
        <div className="border-2 border-black p-2 bg-gray-50 overflow-x-auto select-text scrollbar-thin">
          <table className="w-full text-left text-gem-tiny tracking-wider">
            <thead>
              <tr className="border-b border-gray-300 text-gray-500 font-bold select-none text-[10px]">
                <th className="pr-3">OFFSET</th>
                <th colSpan={16} className="text-center pr-3">HEX VALUES (00-0F)</th>
                <th className="pl-3">ASCII</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rowOffset) => {
                const cells = Array.from({ length: 16 }, (_, i) => rowOffset + i);
                
                return (
                  <tr key={rowOffset} className="hover:bg-gray-150 leading-normal font-mono">
                    {/* Offset Block */}
                    <td className="text-gray-400 font-bold pr-3 select-none">
                      {rowOffset.toString(16).toUpperCase().padStart(3, '0')}:
                    </td>

                    {/* Hex Values cells */}
                    {cells.map((idx) => {
                      const val = sectorData[idx] || 0;
                      const hexStr = val.toString(16).toUpperCase().padStart(2, '0');
                      const isEditing = (editingIndex === idx);

                      return (
                        <td
                          key={idx}
                          onClick={() => handleCellClick(idx)}
                          className={`text-center px-0.5 cursor-pointer select-none font-bold min-w-[20px] rounded hover:bg-black hover:text-white transition-colors duration-75 ${
                            isModified && sectorData[idx] !== (diskBytes ? diskBytes[sectorNum * 512 + idx] : 0)
                              ? 'text-amber-700 bg-amber-50'
                              : 'text-gray-900'
                          }`}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value.toUpperCase())}
                              onBlur={handleCellBlur}
                              onKeyDown={handleCellKeyDown}
                              className="w-5 text-center bg-black text-white font-bold p-0 m-0 border-none outline-none"
                            />
                          ) : (
                            hexStr
                          )}
                        </td>
                      );
                    })}

                    {/* ASCII Representation block */}
                    <td className="pl-3 text-emerald-800 font-bold select-none">
                      {cells.map((idx) => {
                        const b = sectorData[idx] || 0;
                        return b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
                      }).join('')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* BOTTOM METADATA RAIL */}
        <div className="flex justify-between items-center text-[10px] text-gray-500 font-bold">
          <span className="uppercase">
            PHYSICAL DISK OFFSET: {(sectorNum * 512).toLocaleString()} BYTES
          </span>
          <span className={`${expertMode ? 'text-emerald-700' : 'text-amber-700'} uppercase`}>
            {expertMode ? (isModified ? '⚠️ Sector Dirty' : '✅ Sync OK') : '🔒 READ ONLY MAP'}
          </span>
        </div>

      </div>
    </GEMSkeletalWindow>
  );
}
