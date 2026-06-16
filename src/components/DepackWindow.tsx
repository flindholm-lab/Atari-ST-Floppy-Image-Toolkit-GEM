/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';
import { detectPackerSignature, findEmbeddedBlockSignature, readUint32BE } from '../utils/diskUtils';
import { runActiveDepackCycle } from '../utils/graphicsDecoder';

interface DepackWindowProps {
  isOpen: boolean;
  onClose: () => void;
  activeId: string | null;
  onFocus: () => void;
  mobileMode?: boolean;
  fileName?: string;
  bytes?: Uint8Array | null;
  onInspectFile?: (name: string, bytes: Uint8Array) => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  expertMode?: boolean;
}

export default function DepackWindow({
  isOpen,
  onClose,
  activeId,
  onFocus,
  mobileMode,
  fileName: propFileName,
  bytes: propBytes,
  onInspectFile,
  showToast,
  expertMode = false,
}: DepackWindowProps) {
  const [localBytes, setLocalBytes] = useState<Uint8Array | null>(null);
  const [localFileName, setLocalFileName] = useState<string>('');
  const [dragOver, setDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [outputFilename, setOutputFilename] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [depackedResult, setDepackedResult] = useState<{ data: Uint8Array; method: string; vramOffset: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const bytes = propBytes || localBytes;
  const fileName = propFileName || localFileName;

  // Initialize/Sync properties
  useEffect(() => {
    if (isOpen) {
      if (propBytes && propFileName) {
        setLocalBytes(null);
        setLocalFileName('');
        initializeFile(propFileName, propBytes);
      } else if (!bytes) {
        setLogs([
          'SYSTEM READY - ST STANDALONE DEPACKER INITIALIZED.',
          'Double-click custom files in harddrive C: or drag local files here to inspect.'
        ]);
        setDepackedResult(null);
        setOutputFilename('');
      }
    } else {
      // Clear on close
      setLocalBytes(null);
      setLocalFileName('');
      setDepackedResult(null);
      setLogs([]);
      setOutputFilename('');
    }
  }, [isOpen, propBytes, propFileName]);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${time}] ${msg}`]);
  };

  const initializeFile = (name: string, fileBytes: Uint8Array) => {
    setDepackedResult(null);
    
    // Create direct output filename suggestions, e.g. MYFILE.PRG => MYFILE.DEP
    let outName = 'UNPACKED.BIN';
    if (name) {
      const dotIdx = name.lastIndexOf('.');
      const baseName = dotIdx !== -1 ? name.substring(0, dotIdx) : name;
      const ext = dotIdx !== -1 ? name.substring(dotIdx).toUpperCase() : '';
      
      if (['.PRG', '.TOS', '.APP'].includes(ext)) {
        outName = `${baseName}_DEP${ext.toLowerCase()}`;
      } else {
        outName = `${baseName}_depacked.bin`;
      }
    }
    setOutputFilename(outName);

    const format = detectPackerSignature(fileBytes);
    setLogs([
      `SYSTEM - PRE-LOADED FILE SUCCESS: ${name} (${fileBytes.length.toLocaleString()} bytes)`,
      `DISK - Signature scan: "${format}"`,
      format !== 'None' && !format.startsWith('Atari ST Executable')
        ? '⚡ ACTIVE COMPRESSED ENVELOPE DETECTED! READY TO DECOMPRESS.'
        : 'ℹ File appears uncompressed or uses an unrecognized compressor.'
    ]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const arrBytes = new Uint8Array(evt.target.result as ArrayBuffer);
          setLocalBytes(arrBytes);
          setLocalFileName(file.name);
          initializeFile(file.name, arrBytes);
          showToast(`Successfully opened: ${file.name}`, 'success');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const arrBytes = new Uint8Array(evt.target.result as ArrayBuffer);
          setLocalBytes(arrBytes);
          setLocalFileName(file.name);
          initializeFile(file.name, arrBytes);
          showToast(`Successfully opened: ${file.name}`, 'success');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleClear = () => {
    setLocalBytes(null);
    setLocalFileName('');
    setDepackedResult(null);
    setOutputFilename('');
    setLogs([
      'SYSTEM - Work memory cleared.',
      'Awaiting input file stream...'
    ]);
  };

  const executeDepack = () => {
    if (!bytes) return;

    setIsProcessing(true);
    addLog(`Loading executable packet byte arrays...`);
    
    // Tiny delay to allow state and UI to render decompression steps nicely!
    setTimeout(() => {
      try {
        const packerSig = detectPackerSignature(bytes);
        addLog(`Analyzing file markers against signatures... [Found: "${packerSig}"]`);
        
        const result = runActiveDepackCycle(bytes, fileName);
        
        if (result) {
          setDepackedResult(result);
          addLog(`SUCCESS - File unpacked successfully using "${result.method}"!`);
          addLog(`Original packed size: ${bytes.length.toLocaleString()} bytes`);
          addLog(`Decompressed size: ${result.data.length.toLocaleString()} bytes`);
          addLog(`Decompression ratio: ${Math.round(((result.data.length - bytes.length) / result.data.length) * 100)}% expansion`);
          if (result.vramOffset > 0) {
            addLog(`Atari ST low-res screen boundaries located at offset: 0x${result.vramOffset.toString(16).toUpperCase()}`);
          }
          showToast(`File decompressed successfully using ${result.method}!`, 'success');
        } else {
          addLog('ERROR - Decompress failed.');
          if (packerSig !== 'None' && !packerSig.startsWith('Atari ST Executable')) {
            addLog('The packer signature matches a known format, but internal decompression check sums failed or stream is incomplete.');
          } else {
            addLog('No supported packed / crunched block structure found in this file header.');
          }

          if (expertMode) {
            addLog('---------------- EXPERT DIAGNOSTIC REPORT ----------------');
            const isExe = bytes.length >= 28 && bytes[0] === 0x60 && (bytes[1] === 0x1A || bytes[1] === 0x1C || bytes[1] === 0x00);
            addLog(`[DIAG] Atari executable standard header: ${isExe ? 'VALID BRA DIRECTIVE' : 'NO STANDARD PRG SIGN'}`);
            if (isExe) {
              const ts = readUint32BE(bytes, 2);
              const ds = readUint32BE(bytes, 6);
              const ss = readUint32BE(bytes, 14);
              addLog(`[DIAG] Executable structure -> TEXT: ${ts} B | DATA: ${ds} B | SYMBOLS: ${ss} B`);
            }

            // Pack-Ice Check
            const idxIce1 = findEmbeddedBlockSignature(bytes, [0x49, 0x43, 0x45, 0x21]); // ICE!
            const idxIce2 = findEmbeddedBlockSignature(bytes, [0x49, 0x63, 0x65, 0x21]); // Ice!
            const idxIce = idxIce1 >= 0 ? idxIce1 : idxIce2;
            if (idxIce >= 0) {
              addLog(`[DIAG] ICE signature found at offset: 0x${idxIce.toString(16).toUpperCase()}`);
              if (idxIce + 12 <= bytes.length) {
                const pSz = readUint32BE(bytes, idxIce + 4);
                const oSz = readUint32BE(bytes, idxIce + 8);
                addLog(`[DIAG] ICE declared parameters -> Packed: ${pSz} B | Original: ${oSz} B`);
                if (idxIce + pSz > bytes.length) {
                  addLog(`[DIAG] FAIL CAUSE: ICE stream is truncated (missing ${((idxIce + pSz) - bytes.length).toLocaleString()} B)`);
                } else if (oSz > 16 * 1024 * 1024) {
                  addLog(`[DIAG] FAIL CAUSE: Unpacked size exceeds safety threshold.`);
                } else {
                  addLog(`[DIAG] FAIL CAUSE: Bitstream data contains checksum error or invalid Huffman dictionary.`);
                }
              }
            }

            // Atomik Check
            const idxAtom5 = findEmbeddedBlockSignature(bytes, [0x41, 0x54, 0x4D, 0x35]); // ATM5
            const idxAtom3 = findEmbeddedBlockSignature(bytes, [0x41, 0x54, 0x4D, 0x33]); // ATM3
            const idxAtomik = idxAtom5 >= 0 ? idxAtom5 : idxAtom3;
            if (idxAtomik >= 0) {
              addLog(`[DIAG] ATM (Atomik) signature found at offset: 0x${idxAtomik.toString(16).toUpperCase()}`);
              if (idxAtomik + 12 <= bytes.length) {
                const oSz = readUint32BE(bytes, idxAtomik + 4);
                const pSz = readUint32BE(bytes, idxAtomik + 8);
                addLog(`[DIAG] ATM declared parameters -> Packed: ${pSz} B | Original: ${oSz} B`);
                if (idxAtomik + 12 + pSz > bytes.length) {
                  addLog(`[DIAG] FAIL CAUSE: ATM stream truncated (missing ${((idxAtomik + 12 + pSz) - bytes.length).toLocaleString()} B)`);
                } else {
                  addLog(`[DIAG] FAIL CAUSE: Huffman codebook decoding error or stream is corrupted.`);
                }
              }
            }

            // RNC Check
            const idxRnc1 = findEmbeddedBlockSignature(bytes, [0x52, 0x4E, 0x43, 0x01]); // RNC\x01
            const idxRnc2 = findEmbeddedBlockSignature(bytes, [0x52, 0x4E, 0x43, 0x02]); // RNC\x02
            const idxRnc = idxRnc1 >= 0 ? idxRnc1 : idxRnc2;
            if (idxRnc >= 0) {
              const rncMethod = idxRnc1 >= 0 ? 1 : 2;
              addLog(`[DIAG] RNC (Method ${rncMethod}) signature found at offset: 0x${idxRnc.toString(16).toUpperCase()}`);
              if (idxRnc + 18 <= bytes.length) {
                const oSz = readUint32BE(bytes, idxRnc + 4);
                const pSz = readUint32BE(bytes, idxRnc + 8);
                addLog(`[DIAG] RNC declared parameters -> Packed: ${pSz} B | Original: ${oSz} B`);
                if (idxRnc + pSz > bytes.length) {
                  addLog(`[DIAG] FAIL CAUSE: RNC payload truncated (missing ${((idxRnc + pSz) - bytes.length).toLocaleString()} B)`);
                } else {
                  addLog(`[DIAG] FAIL CAUSE: RNC bitstream decoding or CRC check failed.`);
                }
              }
            }

            if (idxIce < 0 && idxAtomik < 0 && idxRnc < 0) {
              addLog(`[DIAG] No recognizable embedded compression signatures (ICE, ATM, RNC) detected.`);
              addLog(`[DIAG] Suggestion: If this is an uncompressed image/binary, use Sector Editor or load a supported PRG/PI1/NEO file.`);
            }
            addLog('----------------------------------------------------------');
          }

          showToast('Decompression failed. Unrecognized format or corrupted payload.', 'error');
        }
      } catch (err: any) {
        addLog(`RUNTIME ERROR: ${err.message}`);
        showToast(`Error during decompression: ${err.message}`, 'error');
      } finally {
        setIsProcessing(false);
      }
    }, 400);
  };

  const downloadUnpacked = () => {
    if (!depackedResult) return;
    
    const blob = new Blob([depackedResult.data], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = outputFilename.trim() || 'UNPACKED.BIN';
    link.click();
    URL.revokeObjectURL(link.href);
    addLog(`Saving de-crunched binary stream: "${outputFilename}"`);
    showToast(`Successfully downloaded decompressed file!`, 'success');
  };

  return (
    <GEMSkeletalWindow
      id="depacker"
      title="DEPACK.PRG"
      isOpen={isOpen}
      onClose={onClose}
      defaultX={200}
      defaultY={110}
      width={500}
      activeId={activeId}
      onFocus={onFocus}
      mobileMode={mobileMode}
    >
      <div className="bg-white p-4 font-mono text-gem-normal no-drag flex flex-col gap-4 select-none">
        
        {/* HEADER */}
        <div className="flex items-center gap-3 border-b-2 border-black pb-2 select-none">
          <div className="p-1.5 bg-emerald-100 border border-black text-emerald-800 font-bold text-center flex items-center justify-center rounded">
            🎁
          </div>
          <div>
            <h2 className="font-bold text-gem-medium leading-none uppercase">DEPACK.PRG</h2>
            <span className="text-gem-tiny text-gray-500 uppercase font-bold mt-0.5">Atari ST Decompiler &amp; Decompressor v1.5</span>
          </div>
        </div>

        {/* DRAG ZONE OPLOAD / ACTIVE ZONE */}
        {!bytes ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border border-dashed border-black p-8 text-center cursor-pointer flex flex-col items-center justify-center transition-colors h-[180px] select-none ${
              dragOver ? 'bg-emerald-50 animate-pulse' : 'hover:bg-gray-50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
            />
            <span className="text-gem-normal font-bold block uppercase text-emerald-800">Drag packed file here or click to open</span>
            <span className="text-gem-tiny text-gray-400 mt-1 block uppercase font-bold">Supports Pack-Ice (ICE!), Atomik Cruncher (ATM5/ATM3), RNC (Propack Method 1&amp;2), Medway Boys LZ77, and RLE formats</span>
            <button className="gem-btn text-gem-tiny mt-3 font-bold px-3 py-1 cursor-pointer">
              LOAD PACKED FILE
            </button>
          </div>
        ) : (
          <div className="border border-black p-3 bg-gray-50 flex flex-col gap-2.5 rounded shadow-sm">
            <div className="flex justify-between items-start border-b border-gray-300 pb-1.5">
              <div>
                <span className="font-bold text-emerald-950 uppercase text-[10px] block">Loaded file:</span>
                <span className="font-bold text-gem-normal text-black block text-sm truncate max-w-[280px]">
                  {fileName}
                </span>
                <span className="text-[10px] text-gray-400 uppercase font-bold block mt-0.5">
                  Size: {bytes.length.toLocaleString()} bytes
                </span>
              </div>
              <button
                onClick={handleClear}
                className="gem-btn text-[9px] font-bold py-0.5 px-2 bg-red-50 text-red-800 border-red-300 hover:bg-red-100"
              >
                CLOSE FILE
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-gem-tiny select-text font-semibold">
              <div className="bg-white p-2 border border-gray-200 rounded">
                <span className="text-gray-400 block text-[9px] font-bold">DETECTED TYPE:</span>
                <span className="text-emerald-700 font-extrabold uppercase mt-0.5 block truncate">
                  {detectPackerSignature(bytes)}
                </span>
              </div>
              <div className="bg-white p-2 border border-gray-200 rounded">
                <span className="text-gray-400 block text-[9px] font-bold">STATUS:</span>
                <span className={`font-extrabold uppercase mt-0.5 block ${depackedResult ? 'text-blue-700' : 'text-amber-700'}`}>
                  {depackedResult ? 'DEPACK SUCCESSFUL' : 'READY TO DECOMPRESS'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 select-none border-t border-gray-200 pt-2.5 mt-0.5">
              <button
                onClick={executeDepack}
                disabled={isProcessing || depackedResult !== null}
                className={`gem-btn text-gem-small font-extrabold py-1 px-4 flex-grow cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  depackedResult ? 'bg-gray-100' : 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700 shadow-sm'
                }`}
              >
                {isProcessing ? 'DECOMPRESSING...' : depackedResult ? 'DEPACKED' : 'DEPACK FILE'}
              </button>
            </div>
          </div>
        )}

        {/* CHIP INSIDE RESULTS PANEL */}
        {depackedResult && (
          <div className="border border-indigo-200 p-3 bg-indigo-50/50 flex flex-col gap-2.5 rounded">
            <span className="font-extrabold text-indigo-950 text-[10px] uppercase block tracking-wider">📦 Decompressed Payload:</span>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 font-sans">
                <label className="text-[10px] text-gray-600 font-bold uppercase">Decompressed Output Filename:</label>
                <input
                  type="text"
                  value={outputFilename}
                  onChange={(e) => setOutputFilename(e.target.value)}
                  className="bg-white border border-black text-gem-tiny font-mono font-bold w-full select-text py-0.5 px-2 text-indigo-950 rounded shadow-inner"
                />
              </div>

              <div className="flex flex-col gap-1.5 justify-end">
                <div className="flex gap-1.5">
                  <button
                    onClick={downloadUnpacked}
                    className="gem-btn font-sans text-gem-tiny font-bold py-1 flex-grow cursor-pointer bg-black text-white hover:bg-indigo-950 shadow-sm"
                  >
                    💾 SAVE PAYLOAD
                  </button>
                  {onInspectFile && (
                    <button
                      onClick={() => {
                        onInspectFile(outputFilename, depackedResult.data);
                        showToast(`Transferred decompressed payload into Viewer!`, 'success');
                      }}
                      className="gem-btn font-sans text-gem-tiny font-bold py-1 flex-grow cursor-pointer border-indigo-500 text-indigo-800 hover:bg-indigo-100 shadow-sm"
                    >
                      🔍 VIEW FILE
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* EMULATOR LOG OUTPUTS */}
        <div className="flex flex-col gap-1 select-text">
          <span className="font-bold text-gem-tiny text-gray-500 uppercase select-none">Console Log Output:</span>
          <div className="bg-black text-emerald-400 p-3 h-28 overflow-y-auto font-mono text-[9.5px] rounded border border-gray-800 shadow-inner flex flex-col gap-1 leading-normal">
            {logs.map((log, l) => (
              <div key={l} className="break-all whitespace-pre-wrap select-text font-medium">➔ {log}</div>
            ))}
            {logs.length === 0 && <div className="text-gray-500 italic select-none">No active logs generated...</div>}
          </div>
        </div>

      </div>
    </GEMSkeletalWindow>
  );
}
