/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';
import { DiskGeometry } from '../types';
import {
  scanLoadedDisk,
  disinfectDisk,
  injectTestVirus,
  VirusScanResult,
  specificVirusSignatures,
  fileVirusSignatures
} from '../utils/virusScanner';

interface VirusScannerWindowProps {
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

export default function VirusScannerWindow({
  isOpen,
  onClose,
  activeId,
  onFocus,
  mobileMode,
  diskBytes,
  geometry,
  onDiskModified,
  showToast,
}: VirusScannerWindowProps) {
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [scannedSector, setScannedSector] = useState(0);
  const [discoveredIssues, setDiscoveredIssues] = useState<VirusScanResult[]>([]);
  const [logMsgs, setLogMsgs] = useState<string[]>([]);
  const [showVirusList, setShowVirusList] = useState(false);
  
  const totalSectorsToScan = geometry ? Math.min(geometry.totalSectors, 720) : 720;

  // Run the actual scanning routine with a cool retro tick animation
  const handleStartScan = () => {
    if (!diskBytes) {
      showToast('No floppy disk inserted in Drive A: to scan.', 'error');
      return;
    }
    
    setScanStatus('scanning');
    setScannedSector(0);
    setDiscoveredIssues([]);
    setLogMsgs([
      'VIRUSCAN.PRG v2.4 (c) 1989-1991 System Armor Ltd.',
      'Initializing system vectors...',
      'Ready to scan floppy drive A:...',
    ]);
  };

  useEffect(() => {
    if (scanStatus !== 'scanning') return;

    const interval = setInterval(() => {
      setScannedSector((prev) => {
        const next = Math.min(prev + 36, totalSectorsToScan);
        
        // Add log messages periodically during the scan simulation
        if (next === 36) {
          setLogMsgs(l => [...l, 'Scanning boot sector 0... Checksum active.']);
        } else if (next === 180) {
          setLogMsgs(l => [...l, 'Scanning FAT copy #1 and copy #2...']);
        } else if (next === 360) {
          setLogMsgs(l => [...l, 'Scanning subdirectories & executable headers...']);
        } else if (next === 540) {
          setLogMsgs(l => [...l, 'Decompressing and examining file buffers...']);
        }

        if (next >= totalSectorsToScan) {
          clearInterval(interval);
          setScanStatus('done');
          
          // Perform the true scan
          const realIssues = scanLoadedDisk(diskBytes, geometry);
          setDiscoveredIssues(realIssues);

          if (realIssues.length > 0) {
            setLogMsgs(l => [
              ...l,
              `Scan complete: FOUND ${realIssues.length} INFECTIONS!`,
              ...realIssues.map(iss => `⚠️ ${iss.name} found in ${iss.target}`),
              'Recommend immediate disinfection to prevent system failure.'
            ]);
            const uniqueNames = Array.from(new Set(realIssues.map(iss => iss.name)));
            showToast(`Threat detected! Found: ${uniqueNames.join(', ')}`, 'error');
          } else {
            setLogMsgs(l => [
              ...l,
              'Scan complete: No viruses detected.',
              'Your floppy disk boot record and executable program sectors are sterile.'
            ]);
            showToast('Floppy scan finished. Clean!', 'success');
          }
          return totalSectorsToScan;
        }
        return next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [scanStatus, diskBytes, geometry, totalSectorsToScan, showToast]);

  const handleDisinfect = () => {
    if (!diskBytes || !geometry || discoveredIssues.length === 0) return;
    
    const cured = disinfectDisk(diskBytes, geometry, discoveredIssues);
    onDiskModified(cured);
    setDiscoveredIssues([]);
    setLogMsgs(l => [
      ...l,
      '----------------------------------------',
      'Running virus eradication protocol...',
      'Disinfecting Boot Sector 0... Done.',
      'Neutralizing file signature sequences... Done.',
      'Atari floppy image is now CLEAN.',
    ]);
    showToast('Virus eradicated successfully. Workspace updated!', 'success');
  };

  const handleInject = (
    type: 'Signum' | 'Ghost' | 'PirateTrap' | 'Kobold' | 'MAD' | 'File' | 'Medway' | 'SCA' | 'ByteBandit' | 'Saddam' | 'MedwayFile'
  ) => {
    if (!diskBytes) {
      showToast('No floppy disk inserted in Drive A: to infect.', 'error');
      return;
    }
    const infected = injectTestVirus(diskBytes, type);
    onDiskModified(infected);
    setScanStatus('idle');
    setDiscoveredIssues([]);
    setScannedSector(0);
    
    let label = 'Unknown';
    if (type === 'Signum') label = 'Signum Boot Virus';
    else if (type === 'Ghost') label = 'Ghost Boot Virus';
    else if (type === 'File') label = 'Pluto File Virus';
    else if (type === 'Medway') label = 'Medway Boys Boot Virus';
    else if (type === 'SCA') label = 'SCA Amiga Boot Virus';
    else if (type === 'ByteBandit') label = 'Byte Bandit File Infector';
    else if (type === 'Saddam') label = 'Saddam File Virus';
    else if (type === 'MedwayFile') label = 'Medway Boys File Infector';
    else if (type === 'PirateTrap') label = 'Pirate Trap Virus';
    else if (type === 'Kobold') label = 'Kobold #2 Virus';
    else if (type === 'MAD') label = 'MAD Virus';

    setLogMsgs(l => [
      ...l,
      `[SIMULATION] Suspicious ${label} payload injected into the floppy memory layout.`,
      'Ready to test-scan again. Click "⚡ SCAN DRIVE A:" to detect.'
    ]);
    showToast(`Simulated ${label} injected to Floppy A:`, 'info');
  };

  const handleRandomSimulate = () => {
    if (!diskBytes) {
      showToast('No floppy disk inserted in Drive A: to infect.', 'error');
      return;
    }
    const types: ('Signum' | 'Ghost' | 'PirateTrap' | 'Kobold' | 'MAD' | 'File' | 'Medway' | 'SCA' | 'ByteBandit' | 'Saddam' | 'MedwayFile')[] = [
      'Signum', 'Ghost', 'PirateTrap', 'Kobold', 'MAD', 'File', 'Medway', 'SCA', 'ByteBandit', 'Saddam', 'MedwayFile'
    ];
    const randomType = types[Math.floor(Math.random() * types.length)];
    handleInject(randomType);
  };

  return (
    <GEMSkeletalWindow
      id="virusscanner"
      title="VIRUSCAN.PRG"
      isOpen={isOpen}
      onClose={onClose}
      defaultX={80}
      defaultY={80}
      width={500}
      activeId={activeId}
      onFocus={onFocus}
      mobileMode={mobileMode}
    >
      <div className="relative bg-white p-4 font-mono text-gem-normal no-drag flex flex-col gap-4 select-none h-full max-h-[550px] overflow-y-auto">
        
        {/* RECOGNIZED VIRUSES DATABASE MODAL PANELS */}
        {showVirusList && (
          <div className="absolute inset-0 bg-white z-50 flex flex-col p-4 border border-black font-mono">
            <div className="flex justify-between items-center border-b-2 border-black pb-2 mb-3">
              <span className="font-bold text-gem-medium">📋 RECOGNIZED VIRUSES ({specificVirusSignatures.length + fileVirusSignatures.length})</span>
              <button
                onClick={() => setShowVirusList(false)}
                className="border-2 border-black px-2 hover:bg-black hover:text-white font-bold"
              >
                [X] CLOSE
              </button>
            </div>
            
            <div className="flex-grow overflow-y-auto pr-1 select-text">
              <div className="text-gem-tiny text-gray-500 mb-3 leading-tight border-b border-dashed border-gray-300 pb-2">
                Atari ST System Armor signature database v2.4. Below are all verified retro virus strains, Trojans, and file-level threats our engine is calibrated to detect and safely disinfect.
              </div>
              <div className="flex flex-col gap-3">
                <div className="font-bold text-gem-small text-black border-l-4 border-black pl-1.5 uppercase">Boot Sector Strains ({specificVirusSignatures.length})</div>
                {specificVirusSignatures.map((v, i) => (
                  <div key={i} className="text-gem-tiny border border-gray-300 p-2 bg-gray-50">
                    <div className="font-bold text-black">{v.name}</div>
                    <div className="text-gray-600 mt-0.5">{v.description}</div>
                    <div className="text-[9px] text-gray-400 mt-1 uppercase font-semibold">Signature: {v.bytes.slice(0, 8).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}...</div>
                  </div>
                ))}
                
                <div className="font-bold text-gem-small text-black border-l-4 border-black pl-1.5 uppercase mt-2">File-Level Infectors ({fileVirusSignatures.length})</div>
                {fileVirusSignatures.map((v, i) => (
                  <div key={i} className="text-gem-tiny border border-gray-300 p-2 bg-gray-50">
                    <div className="font-bold text-black">{v.name}</div>
                    <div className="text-gray-600 mt-0.5">{v.description}</div>
                    <div className="text-[9px] text-gray-400 mt-1 uppercase font-semibold">Signature: {v.bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* APP HEADER */}
        <div className="flex items-center gap-3 border-b-2 border-black pb-2">
          <div className="p-1 bg-red-100 border border-black text-red-600">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-gem-medium leading-none">VIRUSCAN.PRG</h2>
            <span className="text-gem-tiny text-gray-500 uppercase">Atari Anti-Virus Sentinel v2.4</span>
          </div>
        </div>

        {/* STATUS BAR */}
        <div className="border-2 border-black p-3 bg-gray-50 flex flex-col gap-2">
          <div className="flex justify-between items-center text-gem-small font-bold">
            <span>TARGET DRIVE: DRIVE A:\</span>
            <span>
              {scanStatus === 'idle' && 'READY'}
              {scanStatus === 'scanning' && 'SCANNING...'}
              {scanStatus === 'done' && 'FINISHED'}
            </span>
          </div>

          {/* RETRO PROGRESS BAR */}
          <div className="relative h-6 border-2 border-black bg-white flex items-center overflow-hidden">
            <div
              className="h-full bg-black transition-all duration-75"
              style={{ width: `${(scannedSector / totalSectorsToScan) * 100}%` }}
            />
            <span className="absolute inset-0 flex items-center justify-center font-bold text-gem-small mix-blend-difference text-white">
              Sectors {scannedSector} / {totalSectorsToScan} ({Math.round((scannedSector / totalSectorsToScan) * 100)}%)
            </span>
          </div>
        </div>

        {/* SCAN / DISINFECT ACTIONS */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={handleStartScan}
              disabled={scanStatus === 'scanning'}
              className="flex-grow bg-white border-2 border-black hover:bg-black hover:text-white active:translate-x-0.5 active:translate-y-0.5 px-3 py-2 font-bold transition select-none disabled:opacity-50"
            >
              {scanStatus === 'scanning' ? 'RUNNING...' : '⚡ SCAN DRIVE A:'}
            </button>
            
            {discoveredIssues.length > 0 && (
              <button
                onClick={handleDisinfect}
                className="flex-grow bg-rose-600 text-white border-2 border-black hover:bg-rose-700 active:translate-x-0.5 active:translate-y-0.5 px-3 py-2 font-bold transition select-none animate-pulse"
              >
                🏥 DISINFECT DISK
              </button>
            )}
          </div>

          <div className="flex gap-2 text-gem-small shadow-sm">
            <button
              onClick={handleRandomSimulate}
              disabled={scanStatus === 'scanning'}
              className="flex-grow bg-white border border-black hover:bg-gray-100 active:translate-x-0.5 active:translate-y-0.5 px-2 py-1.5 font-bold transition select-none"
            >
              🎲 RANDOM INJECTION
            </button>
            <button
              onClick={() => setShowVirusList(true)}
              className="flex-grow bg-white border border-black hover:bg-gray-100 active:translate-x-0.5 active:translate-y-0.5 px-2 py-1.5 font-bold transition select-none"
            >
              📋 LIST VIRUSES
            </button>
          </div>
        </div>

        {/* THREAT REPORT TABLE */}
        {discoveredIssues.length > 0 && (
          <div className="border-2 border-black p-2 bg-rose-50 flex flex-col gap-1.5 max-h-[120px] overflow-y-auto">
            <div className="font-bold text-rose-800 text-gem-small uppercase">
              ⚠️ {discoveredIssues.length} Infections Detected!
            </div>
            {discoveredIssues.map((issue, idx) => (
              <div key={idx} className="text-gem-tiny border-t border-rose-200 pt-1 flex flex-col">
                <span className="font-bold text-rose-700">{issue.name}</span>
                <span className="text-gray-600">Location: {issue.target}</span>
              </div>
            ))}
          </div>
        )}

        {/* SYSTEM LOG PANEL */}
        <div className="border border-black bg-black text-emerald-400 p-2 text-[10px] h-60 overflow-y-auto font-mono scrollbar-thin">
          {logMsgs.map((msg, i) => (
            <div key={i} className="leading-tight">
              &gt; {msg}
            </div>
          ))}
        </div>
      </div>
    </GEMSkeletalWindow>
  );
}
