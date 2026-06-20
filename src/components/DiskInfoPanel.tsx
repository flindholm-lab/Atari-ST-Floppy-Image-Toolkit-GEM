/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';
import { DiskGeometry } from '../types';
import { readFAT12Entry } from '../utils/diskUtils';

interface DiskInfoPanelProps {
  isOpen: boolean;
  onClose: () => void;
  geometry: DiskGeometry;
  bytes: Uint8Array | null;
  fileName: string;
  activeId: string | null;
  onFocus: () => void;
  onSetOemId: (oem: string) => void;
  makeDiskBootable: () => void;
  viewBootSector: () => void;
  hoveredCluster: number | null;
  onHoverCluster: (c: number | null) => void;
  highlightedClusters: number[];
  onClusterClick?: (c: number) => void;
  onBootDisk: () => void;
}

export default function DiskInfoPanel({
  isOpen,
  onClose,
  geometry,
  bytes,
  fileName,
  activeId,
  onFocus,
  onSetOemId,
  makeDiskBootable,
  viewBootSector,
  hoveredCluster,
  onHoverCluster,
  highlightedClusters,
  onClusterClick,
  onBootDisk,
}: DiskInfoPanelProps) {
  const [oemInput, setOemInput] = useState('');
  const [bootInfo, setBootInfo] = useState('');
  const [freeClusters, setFreeClusters] = useState(0);
  const [usedClusters, setUsedClusters] = useState(0);
  const [hoverStatusText, setHoverStatusText] = useState('Hover cell');

  // Parse OEM Name and Boot metadata
  useEffect(() => {
    if (!bytes) return;

    // Get OEM ID string
    let oemStr = '';
    for (let i = 2; i < 10; i++) {
      if (bytes[i] >= 32 && bytes[i] <= 126) {
        oemStr += String.fromCharCode(bytes[i]);
      } else {
        oemStr += ' ';
      }
    }
    setOemInput(oemStr.trim());

    // Evaluate Boot block checksums
    let codeFound = false;
    let isBootable = false;
    let codeType = 'Data Only';

    if (bytes.length >= 512) {
      let accumulatedSum = 0;
      for (let i = 0; i < 512; i += 2) {
        const wordValue = (bytes[i] << 8) | bytes[i + 1];
        accumulatedSum = (accumulatedSum + wordValue) & 0xFFFF;
      }

      if (accumulatedSum === 0x1234) {
        isBootable = true;
        codeType = 'Standard Atari Boot';
      } else if (bytes[0] === 0x60) {
        let sectorStr = '';
        for (let i = 0; i < 512; i++) {
          if (bytes[i] >= 32 && bytes[i] <= 126) {
            sectorStr += String.fromCharCode(bytes[i]);
          } else {
            sectorStr += ' ';
          }
        }
        const upperStr = sectorStr.toUpperCase();
        const matchesSignatureText =
          upperStr.includes('CRACKED') ||
          upperStr.includes('PRESENTS') ||
          upperStr.includes('PRESENT:') ||
          upperStr.includes('***');

        if (matchesSignatureText) {
          isBootable = true;
          codeType = 'Custom Demo/Crack Loader';
        }
      }

      if (accumulatedSum === 0x1234 || codeType === 'Custom Demo/Crack Loader') {
        codeFound = true;
      } else {
        let hasPayloadBytes = false;
        for (let i = 30; i < 510; i++) {
          if (bytes[i] !== 0x00) {
            hasPayloadBytes = true;
            break;
          }
        }
        codeFound = hasPayloadBytes;
      }
    }

    setBootInfo(`CODE FOUND: ${codeFound ? 'YES' : 'NO'}, BOOTABLE: ${isBootable ? 'YES' : 'NO'} (${codeType})`);

    // Calculate free / used using logical sector limits
    const totalSectorsCount = geometry.totalSectors;
    const dataSectorsCount = totalSectorsCount - Math.floor(geometry.dataAreaStart / geometry.bytesPerSector);
    const totalC = Math.max(0, Math.floor(dataSectorsCount / geometry.sectorsPerCluster));
    let freeC = 0;
    for (let c = 2; c <= totalC + 1; c++) {
      if (readFAT12Entry(bytes, c, geometry) === 0x000) {
        freeC++;
      }
    }
    setFreeClusters(freeC);
    setUsedClusters(totalC - freeC);
  }, [bytes, geometry]);

  if (!bytes) return null;

  const totalSectorsCount = geometry.totalSectors;
  const dataSectorsCount = totalSectorsCount - Math.floor(geometry.dataAreaStart / geometry.bytesPerSector);
  const totalC = Math.max(0, Math.floor(dataSectorsCount / geometry.sectorsPerCluster));
  const percent = totalC > 0 ? ((usedClusters / totalC) * 100).toFixed(1) : '0.0';

  const handleOemSetClick = () => {
    onSetOemId(oemInput);
  };

  // Render Allocation Map cells
  const clusterCells: React.ReactNode[] = [];
  for (let c = 2; c <= totalC + 1; c++) {
    const val = readFAT12Entry(bytes, c, geometry);
    const isUsed = val !== 0;
    const isHighlighted = highlightedClusters.includes(c);

    let cellColorClass = isUsed ? 'bg-black border-black text-white' : 'bg-white border-black text-black';
    if (isHighlighted) {
      cellColorClass = isUsed ? 'bg-emerald-500 border-black' : 'bg-emerald-200 border-black';
    }

    clusterCells.push(
      <div
        key={c}
        title={`Cluster ${c} (Click to open in SECTOR.PRG)`}
        onMouseEnter={() => {
          onHoverCluster(c);
          setHoverStatusText(`C:${c} (${isUsed ? 'Used' : 'Free'}) - Click to inspect`);
        }}
        onMouseLeave={() => {
          onHoverCluster(null);
          setHoverStatusText('Hover cell');
        }}
        onClick={() => {
          if (onClusterClick) {
            onClusterClick(c);
          }
        }}
        className={`h-2.5 w-2.5 border shrink-0 transition-transform hover:scale-150 hover:relative hover:z-50 hover:ring-1 hover:ring-black cursor-pointer ${cellColorClass}`}
      />
    );
  }

  return (
    <GEMSkeletalWindow
      id="diskinfo"
      title="Physical Layout Info"
      isOpen={isOpen}
      onClose={onClose}
      defaultX={860}
      defaultY={40}
      width={440}
      activeId={activeId}
      onFocus={onFocus}
    >
      <div className="p-3 bg-white space-y-3 text-gem-small no-drag flex-grow overflow-y-auto">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono">
          <div className="col-span-2 flex items-center gap-1">
            OEM ID:{' '}
            <input
              type="text"
              value={oemInput}
              onChange={(e) => setOemInput(e.target.value)}
              maxLength={8}
              className="border border-black px-1.5 py-0.5 text-gem-small w-24 uppercase font-mono outline-none"
            />{' '}
            <button onClick={handleOemSetClick} className="gem-btn text-gem-tiny py-0.5 px-1.5 cursor-pointer">
              SET
            </button>
          </div>
          <div className="col-span-2">
            IMAGE: <span className="font-bold truncate block">{fileName}</span>
          </div>
          {geometry.isFallback && (
            <div className="col-span-2 bg-red-100 border border-red-700 text-red-900 px-2 py-1 font-bold text-gem-tiny text-center font-mono my-1 uppercase">
              [!] FALLBACK ACTIVE: NON-COMPLIANT BPB BYPASSED
            </div>
          )}
          <div>
            BPB LOGICAL CAP: <span className="font-bold block">{(geometry.totalSectors * geometry.bytesPerSector).toLocaleString()} B</span>
          </div>
          <div>
            PHYSICAL BUFFER: <span className="font-bold block">{bytes.length.toLocaleString()} B</span>
          </div>
          <div>
            SECT/CLUS: <span className="font-bold block">{geometry.sectorsPerCluster}</span>
          </div>
          <div>
            BYTES/SECT: <span className="font-bold block">{geometry.bytesPerSector}</span>
          </div>
          <div>
            SECT/FAT: <span className="font-bold block">{geometry.sectorsPerFat}</span>
          </div>
          <div className="col-span-2">
            FAT COPIES: <span className="font-bold">{geometry.numFats}</span>
          </div>
          <div className="col-span-2 mt-1 border-t border-dashed border-black pt-1">
            <div className="text-gem-tiny font-bold">{bootInfo}</div>
            <div className="mt-1 flex justify-end gap-1">
              <button onClick={makeDiskBootable} className="gem-btn text-gem-tiny py-0.5 px-2 cursor-pointer">
                MAKE BOOTABLE
              </button>
              <button onClick={viewBootSector} className="gem-btn text-gem-tiny py-0.5 px-2 cursor-pointer">
                VIEW BOOT SECTOR
              </button>
              <button onClick={onBootDisk} className="gem-btn text-gem-tiny py-0.5 px-2 cursor-pointer font-bold bg-amber-50 text-amber-900 border-amber-600 hover:bg-amber-100" title="Boot current disk in emulator">
                BOOT DISK
              </button>
            </div>
          </div>
        </div>

        {/* Progress statistics bar */}
        <div className="border-t border-black pt-2">
          <div className="flex justify-between font-bold mb-1">
            <span>Floppy Space Utilized:</span>
            <span className="font-bold">{percent}%</span>
          </div>
          <div className="w-full bg-white border-2 border-black h-4 overflow-hidden p-0.5">
            <div className="gem-hatch h-full" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex justify-between text-gem-tiny mt-1 text-gray-600">
            <span>
              {usedClusters} / {totalC} used
            </span>
            <span>{freeClusters} free</span>
          </div>
        </div>

        {/* Allocation grid */}
        <div className="border-t border-black pt-2 flex flex-col h-[360px]">
          <div className="flex justify-between items-center mb-1 text-gem-tiny font-bold">
            <span>CLUSTER ALLOCATION MAP</span>
            <span className="text-gray-500 font-mono">{hoverStatusText}</span>
          </div>
          <div className="bg-white p-1 border border-black overflow-y-auto flex-grow flex flex-wrap gap-0.5 content-start select-none">
            {clusterCells}
          </div>
        </div>
      </div>
    </GEMSkeletalWindow>
  );
}
