/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';
import { detectPackerSignature } from '../utils/diskUtils';
import { tryRenderAtariSTImage, runActiveDepackCycle, resolveVRAMOffset, decodePlanarVRAM, parseSTPaletteAt, getDefaultSTPalette, stPixelFont } from '../utils/graphicsDecoder';
import { parseAtariFont, parseNeoAnimStrips, DecodedFont, NeoAnimFrame } from '../utils/expandedGraphicsDecoder';

interface ScrolltextCandidate {
  id: number;
  offset: number;
  offsetHex: string;
  length: number;
  text: string;
  terminator: string;
  hasCommonKeywords: boolean;
  isFontIndexed?: boolean;
}

interface FileViewerWindowProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  bytes: Uint8Array | null;
  activeId: string | null;
  onFocus: () => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  onOpenInDepack?: (fileName: string, bytes: Uint8Array) => void;
  manualDepack?: boolean;
}

export default function FileViewerWindow({
  isOpen,
  onClose,
  fileName: propFileName,
  bytes: propBytes,
  activeId,
  onFocus,
  showToast,
  onOpenInDepack,
  manualDepack = false,
}: FileViewerWindowProps) {
  const [localBytes, setLocalBytes] = useState<Uint8Array | null>(null);
  const [localFileName, setLocalFileName] = useState<string>('');
  const [dragOverLocal, setDragOverLocal] = useState<boolean>(false);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setLocalBytes(null);
      setLocalFileName('');
    }
  }, [isOpen]);

  const bytes = propBytes || localBytes;
  const fileName = propFileName || localFileName;

  const handleLocalDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverLocal(true);
  };

  const handleLocalDragLeave = () => {
    setDragOverLocal(false);
  };

  const handleLocalDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverLocal(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const arrBytes = new Uint8Array(evt.target.result as ArrayBuffer);
          setLocalBytes(arrBytes);
          setLocalFileName(file.name);
          showToast(`Successfully opened local file: ${file.name} (${arrBytes.length.toLocaleString()} bytes)`, 'success');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const arrBytes = new Uint8Array(evt.target.result as ArrayBuffer);
          setLocalBytes(arrBytes);
          setLocalFileName(file.name);
          showToast(`Successfully opened local file: ${file.name} (${arrBytes.length.toLocaleString()} bytes)`, 'success');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };
  const [viewMode, setViewMode] = useState<'image' | 'text' | 'hex' | 'scrolltext' | 'font'>('text');
  const [decodedFont, setDecodedFont] = useState<DecodedFont | null>(null);
  const [animFrames, setAnimFrames] = useState<NeoAnimFrame[]>([]);
  const [activeFrameIdx, setActiveFrameIdx] = useState<number>(0);
  const [isPlayingAnim, setIsPlayingAnim] = useState<boolean>(true);
  const [selectedFontChar, setSelectedFontChar] = useState<number | null>(65);
  const [textFilter, setTextFilter] = useState<'raw' | 'ascii' | 'strings'>('raw');
  const [extractFrom, setExtractFrom] = useState('0');
  const [extractTo, setExtractTo] = useState('256');
  const [extractFilename, setExtractFilename] = useState('');

  const [hasImage, setHasImage] = useState(false);
  const [signatureInfo, setSignatureInfo] = useState('');
  const [textPreview, setTextPreview] = useState('');
  const [hexPreview, setHexPreview] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [depackedResult, setDepackedResult] = useState<{ data: Uint8Array; method: string; vramOffset: number } | null>(null);
  const [candidates, setCandidates] = useState<ScrolltextCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [scrollShift, setScrollShift] = useState<number>(0);
  const [customStart, setCustomStart] = useState<string>('0');
  const [customEnd, setCustomEnd] = useState<string>('1000');
  const [scrollTextContent, setScrollTextContent] = useState<string>('');
  const [cleanWhitespace, setCleanWhitespace] = useState<boolean>(true);
  const [stopAtTerminator, setStopAtTerminator] = useState<boolean>(true);
  const [selectedTerminator, setSelectedTerminator] = useState<string>('auto');
  const [tickerSpeed, setTickerSpeed] = useState<number>(2);
  const [useCopperbar, setUseCopperbar] = useState<boolean>(true);

  // Custom alphabet and relative-pattern decoding states
  const [alphabetMode, setAlphabetMode] = useState<'ascii' | 'custom'>('ascii');
  const [alphabetPreset, setAlphabetPreset] = useState<string>('space-az');
  const [customAlphabet, setCustomAlphabet] = useState<string>(' ABCDEFGHIJKLMNOPQRSTUVWXYZ.,!?\'-+=/*()[]":0123456789');
  const [patternInput, setPatternInput] = useState<string>('STAY TUNED');
  const [patternMatches, setPatternMatches] = useState<{ offset: number; hexOffset: string; sample: string; detectedAlphabet: string; shift: number }[]>([]);
  const [searchStatus, setSearchStatus] = useState<string>('');

  // Demogroup/Crew text translation states
  const [applySubstitution, setApplySubstitution] = useState<boolean>(false);
  const [substitutionPreset, setSubstitutionPreset] = useState<string>('none');
  const [customSubstitutions, setCustomSubstitutions] = useState<string>('');

  // Automated sliding graphics scanner states
  const [imageSubMode, setImageSubMode] = useState<'native' | 'scan'>('scan');
  const [imgOffset, setImgOffset] = useState<number>(0);
  const [imgWidth, setImgWidth] = useState<number>(320);
  const [imgHeight, setImgHeight] = useState<number>(200);
  const [imgColors, setImgColors] = useState<number>(16);
  const [paletteSource, setPaletteSource] = useState<'default' | 'offset'>('default');
  const [customPaletteOffset, setCustomPaletteOffset] = useState<string>('');
  // Auto-initialize image scanner offset on file load
  useEffect(() => {
    if (!bytes || !isOpen) return;
    if (manualDepack) {
      setImgOffset(0);
      return;
    }
    const depackedLocal = runActiveDepackCycle(bytes, fileName);
    if (depackedLocal) {
      setImgOffset(depackedLocal.vramOffset);
    } else {
      setImgOffset(0);
    }
  }, [bytes, isOpen, fileName, manualDepack]);



  useEffect(() => {
    // Clear old previews immediately so they don't linger between views
    setTextPreview('');
    setHexPreview('');
    setHasImage(false);
    setSignatureInfo('');
    setTextFilter('raw');
    setExtractFrom('0');
    setExtractTo(bytes ? Math.min(bytes.length, 256).toString() : '256');
    if (fileName) {
      const dotIdx = fileName.lastIndexOf('.');
      const base = dotIdx !== -1 ? fileName.substring(0, dotIdx) : fileName;
      const ext = dotIdx !== -1 ? fileName.substring(dotIdx) : '.bin';
      setExtractFilename(`${base}_segment${ext}`);
    }

    if (!bytes || !isOpen) {
      setDepackedResult(null);
      return;
    }

    // Detect signatures and formats
    const ext = fileName.split('.').pop()?.toUpperCase() || '';
    const packerSignature = detectPackerSignature(bytes);
    let signatureDisplay = 'Signature: ' + packerSignature;

    const depackedLocal = manualDepack ? null : runActiveDepackCycle(bytes, fileName);
    setDepackedResult(depackedLocal);

    const supportedImageExts = ['NEO', 'PI1', 'PI2', 'PI3', 'ART', 'MUR', 'DOO', 'PC1', 'PC2', 'PC3', 'SPU', 'SPC', 'SPS', 'PBX', 'IMG', 'TN1', 'TN2', 'TN3', 'TNY'];
    const packedBinaryExts = ['PRG', 'TOS', 'APP'];
    let imgParsed = false;

    // A. Native Image Formats
    if (supportedImageExts.includes(ext)) {
      // Create a mock canvas to check decoding
      const dummyCanvas = document.createElement('canvas');
      const res = tryRenderAtariSTImage(ext, bytes, dummyCanvas);
      if (res) {
        imgParsed = true;
        signatureDisplay = res.detail;
      }
    }

    if (manualDepack && packerSignature !== 'None') {
      signatureDisplay = `${packerSignature} (Manual Depack active - Run Depacker to extract)`;
    } else {
      // B. Packed Executable Screens (Medway, Thunder, Pack-Ice, etc.)
      if (!imgParsed && (packedBinaryExts.includes(ext) || packerSignature !== 'None')) {
        if (depackedLocal && depackedLocal.data.length >= 32000) {
          const workBytes = depackedLocal.data;
          const vramOffset = depackedLocal.vramOffset;
          if (vramOffset + 32000 <= workBytes.length) {
            imgParsed = true;
            signatureDisplay = `${packerSignature} Depacked → ${depackedLocal.method} | Atari Planar Screen Memory @ 0x${vramOffset.toString(16).toUpperCase()} (Offset ${vramOffset} bytes)`;
          }
        }
      }
    }

    // Parse Font
    const parsedFont = parseAtariFont(bytes, fileName);
    setDecodedFont(parsedFont);

    // Parse ANM frames
    if (ext === 'ANM') {
      const strips = parseNeoAnimStrips(bytes);
      setAnimFrames(strips);
      setActiveFrameIdx(0);
    } else {
      setAnimFrames([]);
    }

    setSignatureInfo(signatureDisplay);
    setHasImage(imgParsed || ext === 'ANM');

    const isKnownImage = supportedImageExts.includes(ext) || ext === 'ANM';

    // Initial default mode: Default to font mode if font detected, otherwise image, otherwise hex
    if (parsedFont) {
      setViewMode('font');
    } else if (isKnownImage && (imgParsed || ext === 'ANM')) {
      setViewMode('image');
      setImageSubMode('native');
    } else {
      setViewMode('hex');
      setImageSubMode('scan');
    }
  }, [bytes, isOpen, fileName, manualDepack]);

  // Neochrome Animation Looping Effect
  useEffect(() => {
    if (!isOpen || viewMode !== 'image' || animFrames.length <= 1 || !isPlayingAnim) return;

    const timer = setInterval(() => {
      setActiveFrameIdx(idx => (idx + 1) % animFrames.length);
    }, 150);

    return () => clearInterval(timer);
  }, [isOpen, viewMode, animFrames, isPlayingAnim]);

  // Update Hex Preview when bytes or depackedResult updates
  useEffect(() => {
    if (!bytes || !isOpen) {
      setHexPreview('');
      return;
    }
    const targetBytes = depackedResult ? depackedResult.data : bytes;
    const hexPreviewLimit = 262144;
    const hexSlice = targetBytes.length > hexPreviewLimit ? targetBytes.subarray(0, hexPreviewLimit) : targetBytes;
    let hexString = formatHexDump(hexSlice);
    if (targetBytes.length > hexPreviewLimit) {
      hexString += `\n\n... Hex dump truncated (${hexPreviewLimit.toLocaleString()} of ${targetBytes.length.toLocaleString()} bytes shown) ...`;
    }
    setHexPreview(hexString);
  }, [bytes, isOpen, depackedResult]);

  // Scan for candidates whenever bytes or depackedResult updates
  useEffect(() => {
    if (!bytes || !isOpen) {
      setCandidates([]);
      return;
    }
    const targetBytes = depackedResult ? depackedResult.data : bytes;
    const list = scanForScrolltexts(targetBytes);
    setCandidates(list);
    
    if (list.length > 0) {
      setSelectedCandidateId(list[0].id);
      setCustomStart(list[0].offset.toString());
      setCustomEnd((list[0].offset + list[0].length).toString());
      if (list[0].isFontIndexed) {
        setAlphabetMode('custom');
      } else {
        setAlphabetMode('ascii');
      }
    } else {
      setSelectedCandidateId(null);
      setCustomStart('0');
      setCustomEnd(Math.min(targetBytes.length, 1000).toString());
      setAlphabetMode('ascii');
    }
    setScrollShift(0);
  }, [bytes, depackedResult, isOpen]);

  // Sync scrollTextContent based on offset, shifts, terminators, and formatting options
  useEffect(() => {
    if (!bytes || !isOpen) {
      setScrollTextContent('');
      return;
    }
    const targetBytes = depackedResult ? depackedResult.data : bytes;
    const start = parseOffset(customStart);
    const end = parseOffset(customEnd);

    if (isNaN(start) || start < 0 || start >= targetBytes.length || isNaN(end) || end <= start) {
      setScrollTextContent('');
      return;
    }

    let endLimit = Math.min(end, targetBytes.length);
    if (endLimit - start > 32768) {
      endLimit = start + 32768; // Cap the preview slice to 32KB to prevent heavy CPU shifting & rendering loops
    }
    const rawSlice = targetBytes.slice(start, endLimit);
    
    // 1. Shift charcodes
    const shiftedBytes = new Uint8Array(rawSlice.length);
    for (let i = 0; i < rawSlice.length; i++) {
      shiftedBytes[i] = (rawSlice[i] + scrollShift + 256) % 256;
    }

    // 2. Scan terminator limits
    let limitIdx = shiftedBytes.length;
    if (stopAtTerminator) {
      for (let i = 0; i < shiftedBytes.length; i++) {
        const b = shiftedBytes[i];
        let termMatch = false;
        if (selectedTerminator === 'auto') {
          termMatch = (b === 0 || b === 0x40 || b === 0x5D || b === 0xFF);
        } else if (selectedTerminator === '0x00') {
          termMatch = (b === 0);
        } else if (selectedTerminator === '0x40') {
          termMatch = (b === 0x40);
        } else if (selectedTerminator === '0x5D') {
          termMatch = (b === 0x5D);
        } else if (selectedTerminator === '0xFF') {
          termMatch = (b === 0xFF);
        }
        
        if (termMatch) {
          limitIdx = i;
          break;
        }
      }
    }

    const finalBytes = shiftedBytes.subarray(0, limitIdx);

    // 3. Convert to string
    const textChars: string[] = [];
    if (alphabetMode === 'ascii') {
      for (let i = 0; i < finalBytes.length; i++) {
        const b = finalBytes[i];
        if (b >= 32 && b <= 255) {
          textChars.push(String.fromCharCode(b));
        } else if (b === 10 || b === 13) {
          textChars.push(String.fromCharCode(b));
        } else {
          textChars.push(' ');
        }
      }
    } else {
      for (let i = 0; i < finalBytes.length; i++) {
        const b = finalBytes[i];
        if (b >= 0 && b < customAlphabet.length) {
          textChars.push(customAlphabet[b]);
        } else {
          textChars.push(' ');
        }
      }
    }
    let textOut = textChars.join('');

    // 4. Case/Character substitutions (commonly used by demo crews like Evil Force)
    if (applySubstitution && customSubstitutions) {
      const mapping: Record<string, string> = {};
      const lines = customSubstitutions.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const from = trimmed.substring(0, eqIdx).trim();
          const to = trimmed.substring(eqIdx + 1);
          if (from) {
            mapping[from] = to;
            // Also map lowercase/uppercase automatically to make it easy for single chars
            if (from.length === 1) {
              mapping[from.toLowerCase()] = to;
              mapping[from.toUpperCase()] = to;
            }
          }
        }
      }

      let substituted = '';
      for (let i = 0; i < textOut.length; i++) {
        const char = textOut[i];
        if (mapping[char] !== undefined) {
          substituted += mapping[char];
        } else {
          substituted += char;
        }
      }
      textOut = substituted;
    }

    // 5. Clean extra spaces
    if (cleanWhitespace) {
      textOut = textOut.replace(/ {4,}/g, '   ');
    }

    setScrollTextContent(textOut);
  }, [bytes, depackedResult, customStart, customEnd, scrollShift, cleanWhitespace, stopAtTerminator, selectedTerminator, isOpen, alphabetMode, customAlphabet, applySubstitution, customSubstitutions]);

  // Live Atari ticker tape scroller animation render loop
  const tickerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollOffsetRef = useRef<number>(0);
  const animationFrameIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (viewMode !== 'scrolltext' || !tickerCanvasRef.current || !isOpen) {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      return;
    }

    const canvas = tickerCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    scrollOffsetRef.current = canvas.width;

    const render = () => {
      frame++;
      
      const width = canvas.width;
      const height = canvas.height;

      // 1. Draw Copper background or Solid black
      if (useCopperbar) {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        const mid = height / 2 + Math.sin(frame * 0.04) * (height * 0.25);
        gradient.addColorStop(0, '#040404');
        gradient.addColorStop(Math.max(0, (mid - 25) / height), '#100000');
        gradient.addColorStop(Math.max(0, (mid - 15) / height), '#880000');
        gradient.addColorStop(Math.max(0, (mid - 6) / height), '#d86400');
        gradient.addColorStop(mid / height, '#fff0dd');
        gradient.addColorStop(Math.min(1, (mid + 6) / height), '#d86400');
        gradient.addColorStop(Math.min(1, (mid + 15) / height), '#880000');
        gradient.addColorStop(Math.min(1, (mid + 25) / height), '#100000');
        gradient.addColorStop(1, '#040404');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
      }

      // Scanner CRT line layers
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      for (let y = 0; y < height; y += 2) {
        ctx.fillRect(0, y, width, 1);
      }

      // 2. Ticker character render string logic
      const cleanScrollerText = scrollTextContent || '--- NO SCROLLTEXT EXTRACTED ---';
      const scale = 2; // Pixel font ratio scale
      const charWidth = 8 * scale;
      const totalWidth = cleanScrollerText.length * charWidth;

      // Update offsets
      const currentScrollX = scrollOffsetRef.current;
      scrollOffsetRef.current -= tickerSpeed;
      if (scrollOffsetRef.current + totalWidth < 0) {
        scrollOffsetRef.current = width;
      }

      // Range filtering inside canvas borders
      const startCharIdx = Math.max(0, Math.floor(-currentScrollX / charWidth));
      const endCharIdx = Math.min(cleanScrollerText.length, Math.ceil((width - currentScrollX) / charWidth));

      const fontColor = useCopperbar ? '#ffffff' : '#00ff00';
      const textY = Math.floor((height - (8 * scale)) / 2);

      for (let i = startCharIdx; i < endCharIdx; i++) {
        const char = cleanScrollerText[i];
        const px = Math.floor(currentScrollX + i * charWidth);
        
        // Direct pixel shadow
        drawCharToCanvas(ctx, char, px + 2, textY + 2, '#000000', scale);
        // Foreground pixels
        drawCharToCanvas(ctx, char, px, textY, fontColor, scale);
      }

      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
    };
  }, [viewMode, scrollTextContent, tickerSpeed, useCopperbar, isOpen]);

  const handlePatternSearch = () => {
    if (!bytes) {
      setSearchStatus('No file loaded');
      return;
    }
    const targetBytes = depackedResult ? depackedResult.data : bytes;

    // Filter pattern input to uppercase alphanumeric
    let cleanPat = patternInput.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleanPat.length < 3) {
      setSearchStatus('Keyword too short (needs >= 3 alphanumeric letters)');
      return;
    }

    setSearchStatus('Scanning for relative pattern differences...');
    
    // Relative shift differences array
    const diffs: number[] = [];
    for (let j = 0; j < cleanPat.length - 1; j++) {
      diffs.push(cleanPat.charCodeAt(j + 1) - cleanPat.charCodeAt(j));
    }

    const matchesList: typeof patternMatches = [];
    const len = cleanPat.length;

    // Scan bytes of targetBytes
    for (let i = 0; i <= targetBytes.length - len; i++) {
      let isMatch = true;
      for (let j = 0; j < len - 1; j++) {
        // Difference between successive bytes modulo 256
        const byteDiff = (targetBytes[i + j + 1] - targetBytes[i + j] + 256) % 256;
        const targetDiff = (diffs[j] + 256) % 256;
        if (byteDiff !== targetDiff) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        // MATCH found! Output this offset
        const offset = i;
        const hex = '0x' + offset.toString(16).toUpperCase().padStart(6, '0');

        // Let's deduce what shift/preset is needed
        // If Preset alphabet is standard Space + A-Z:
        // ' ABCDEFGHIJKLMNOPQRSTUVWXYZ.,!?\'-+=/*()[]"0123456789'
        const presetGuess = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ.,!?\'-+=/*()[]":0123456789';
        // Match cleanPat[0]
        const firstLetter = cleanPat[0];
        const idxInPreset = presetGuess.indexOf(firstLetter);
        
        // Custom font index maps to targetBytes[offset]. 
        // Shift equation: (targetBytes[offset] + shift) % 256 = idxInPreset
        // => shift = (idxInPreset - targetBytes[offset] + 256) % 256
        const shift = idxInPreset !== -1 ? (idxInPreset - targetBytes[offset] + 256) % 256 : 0;

        // Create preview sample using this shift guess
        const previewChars: string[] = [];
        for (let k = 0; k < Math.min(80, targetBytes.length - offset); k++) {
          const rawB = targetBytes[offset + k];
          const shiftedB = (rawB + shift + 256) % 256;
          if (shiftedB >= 0 && shiftedB < presetGuess.length) {
            previewChars.push(presetGuess[shiftedB]);
          } else {
            previewChars.push('.');
          }
        }
        const previewStr = previewChars.join('');

        matchesList.push({
          offset,
          hexOffset: hex,
          sample: previewStr,
          detectedAlphabet: `Shift determined as +${shift}`,
          shift
        });

        // Limit to top 20 matches to avoid bogging down React UI
        if (matchesList.length >= 20) break;
      }
    }

    setPatternMatches(matchesList);
    if (matchesList.length > 0) {
      setSearchStatus(`Found ${matchesList.length} matching offset(s)! Click one below to apply shifts.`);
    } else {
      setSearchStatus(`No matches for relative character changes of "${cleanPat}".`);
    }
  };

  const handlePresetChange = (preset: string) => {
    setAlphabetPreset(preset);
    if (preset === 'std-az') {
      setCustomAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ ');
    } else if (preset === 'space-az') {
      setCustomAlphabet(' ABCDEFGHIJKLMNOPQRSTUVWXYZ.,!?\'-+=/*()[]":0123456789');
    } else if (preset === 'az-space') {
      setCustomAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ.,!?\'-+=/*()[]":0123456789 ');
    } else if (preset === 'full-alphanumeric') {
      setCustomAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?\'-+=/*()[]": ');
    }
  };

  // Handle mode switches
  const handleModeSwitch = (mode: 'image' | 'text' | 'hex' | 'scrolltext' | 'font') => {
    setViewMode(mode);
  };

  // Dedicated, unified image rendering effect
  useEffect(() => {
    if (!bytes || !isOpen || viewMode !== 'image') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let canvasW = 320;
    let canvasH = 200;
    let rgbaData: Uint8ClampedArray | null = null;

    if (imageSubMode === 'native') {
      const ext = fileName.split('.').pop()?.toUpperCase() || '';
      if (ext === 'ANM' && animFrames.length > 0) {
        const frame = animFrames[activeFrameIdx] || animFrames[0];
        rgbaData = decodePlanarVRAM(frame.pixels, frame.palette, 16, 320, 200);
        canvasW = 320;
        canvasH = 200;
      } else {
        const dummyCanvas = document.createElement('canvas');
        const res = tryRenderAtariSTImage(ext, bytes, dummyCanvas);
        if (res) {
          rgbaData = res.rgba;
          canvasW = dummyCanvas.width;
          canvasH = dummyCanvas.height;
        } else {
          const depacked = depackedResult;
          if (depacked && depacked.data.length >= 32000) {
            const workBytes = depacked.data;
            const vramOffset = depackedLocalVramOffset(workBytes);
            let palette = getDefaultSTPalette();
            const customPal = parseSTPaletteAt(workBytes, vramOffset);
            if (customPal) palette = customPal;
            const vram = workBytes.subarray(vramOffset, vramOffset + 32000);
            rgbaData = decodePlanarVRAM(vram, palette);
            canvasW = 320;
            canvasH = 200;
          }
        }
      }
    } else {
      // Manual Planar Scanner
      const targetBytes = depackedResult ? depackedResult.data : bytes;
      canvasW = imgWidth;
      canvasH = imgHeight;

      let palette = getDefaultSTPalette();
      if (paletteSource === 'offset') {
        let palOffset = imgOffset - 32;
        if (customPaletteOffset.trim()) {
          const parsed = parseOffset(customPaletteOffset);
          if (!isNaN(parsed) && parsed >= 0 && parsed < targetBytes.length) {
            palOffset = parsed;
          }
        }
        if (palOffset >= 0 && palOffset + (imgColors * 2) <= targetBytes.length) {
          palette = parsePaletteFromBytes(targetBytes, palOffset, imgColors);
        }
      }

      const vram = targetBytes.subarray(imgOffset);
      rgbaData = decodePlanarVRAM(vram, palette, imgColors, imgWidth, imgHeight);
    }

    if (rgbaData) {
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.createImageData(canvasW, canvasH);
        imgData.data.set(rgbaData);
        ctx.putImageData(imgData, 0, 0);
      }
    }
  }, [
    bytes,
    isOpen,
    viewMode,
    imageSubMode,
    imgOffset,
    imgWidth,
    imgHeight,
    imgColors,
    paletteSource,
    customPaletteOffset,
    depackedResult,
    fileName,
    animFrames,
    activeFrameIdx
  ]);

  // Small helper to resolve vram offset safely during native fallback
  function depackedLocalVramOffset(workBytes: Uint8Array): number {
    if (workBytes.length === 32000) return 0;
    if (workBytes.length >= 32034) return 34;
    if (workBytes.length >= 32128) return 128;
    return 0;
  }

  const handleHexSelection = (e: React.MouseEvent<HTMLPreElement> | React.KeyboardEvent<HTMLPreElement>) => {
    const element = e.currentTarget;
    const { start, end } = getSelectionCharacterOffsetsWithin(element);
    if (start === end) return;
    
    let minByte: number | null = null;
    let maxByte: number | null = null;

    for (let idx = start; idx < end; idx++) {
      const byteIdx = charIndexToByteIndex(idx);
      if (byteIdx !== null) {
        if (minByte === null || byteIdx < minByte) {
          minByte = byteIdx;
        }
        if (maxByte === null || byteIdx > maxByte) {
          maxByte = byteIdx;
        }
      }
    }

    if (minByte !== null && maxByte !== null) {
      setExtractFrom(`0x${minByte.toString(16).toUpperCase()}`);
      setExtractTo(`0x${(maxByte + 1).toString(16).toUpperCase()}`);
    }
  };

  const getDisplayedText = (): string => {
    if (!bytes) return '';
    if (textFilter === 'strings') {
      const lines: string[] = [];
      let currentString: string[] = [];
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b >= 32 && b <= 126) {
          currentString.push(String.fromCharCode(b));
        } else {
          if (currentString.length >= 4) {
            lines.push(currentString.join(''));
          }
          currentString = [];
        }
      }
      if (currentString.length >= 4) {
        lines.push(currentString.join(''));
      }
      return lines.length > 0 ? lines.join('\n') : '[NO ASCII STRINGS FOUND (LENGTH >= 4)]';
    }

    if (textFilter === 'ascii') {
      const chars: string[] = [];
      let consecDots = 0;
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
          chars.push(String.fromCharCode(b));
          consecDots = 0;
        } else {
          if (consecDots < 1) {
            chars.push(' ');
            consecDots++;
          }
        }
      }
      return chars.join('');
    }

    // Default 'raw'
    let isBinary = false;
    for (let i = 0; i < Math.min(bytes.length, 500); i++) {
      if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
        isBinary = true;
        break;
      }
    }

    if (isBinary) {
      return '[BINARY EXE/DATA BLOCK — CHOOSE "ASCII CLEANED" OR "FIND STRINGS (length >= 4)" IN TEXT VIEWER OPTIONS TO EXTRACT EMBEDDED TEXT PLAIN]';
    }

    try {
      return new TextDecoder().decode(bytes);
    } catch {
      return '[Failed to decode raw stream as UTF-8]';
    }
  };

  const liveFrom = parseOffset(extractFrom);
  const liveTo = parseOffset(extractTo);
  const totalLength = bytes ? bytes.length : 0;
  const isValidFrom = !isNaN(liveFrom) && liveFrom >= 0 && liveFrom < totalLength;
  const isValidTo = !isNaN(liveTo) && liveTo > (isValidFrom ? liveFrom : -1) && liveTo <= totalLength;
  const segmentSize = (isValidFrom && isValidTo) ? (liveTo - liveFrom) : 0;

  const handleExtractSegment = () => {
    if (!bytes) return;

    const fromVal = parseOffset(extractFrom);
    const toVal = parseOffset(extractTo);

    if (isNaN(fromVal) || fromVal < 0 || fromVal >= bytes.length) {
      showToast('Invalid segment start offset.', 'error');
      return;
    }
    if (isNaN(toVal) || toVal <= fromVal || toVal > bytes.length) {
      showToast('Invalid segment end offset.', 'error');
      return;
    }

    const segmented = bytes.slice(fromVal, toVal);
    const blob = new Blob([segmented], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = extractFilename.trim() || 'segment.bin';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`Successfully saved segment of ${segmented.length.toLocaleString()} bytes.`, 'success');
  };

  const copyViewerContents = () => {
    if (viewMode === 'image') {
      showToast('Images cannot be parsed as text streams.', 'info');
      return;
    }
    const textToCopy = viewMode === 'text' ? getDisplayedText() : hexPreview;
    navigator.clipboard.writeText(textToCopy)
      .then(() => showToast('Copied content to clipboard.', 'success'))
      .catch(() => showToast('Failed to copy content.', 'error'));
  };

  if (!isOpen) return null;

  return (
    <GEMSkeletalWindow
      id="viewer"
      title={(fileName || "VIEWER.PRG").toUpperCase()}
      isOpen={isOpen}
      onClose={onClose}
      defaultX={180}
      defaultY={80}
      width={680}
      activeId={activeId}
      onFocus={onFocus}
    >
      {!bytes ? (
        <div className="p-4 flex flex-col items-center justify-center bg-white h-[350px] no-drag select-none font-mono">
          <input
            ref={localFileInputRef}
            type="file"
            onChange={handleLocalFileChange}
            className="hidden"
          />
          <div
            onDragOver={handleLocalDragOver}
            onDragLeave={handleLocalDragLeave}
            onDrop={handleLocalDrop}
            onClick={() => localFileInputRef.current?.click()}
            className={`border border-dashed border-black p-10 text-center cursor-pointer w-full h-[280px] flex flex-col items-center justify-center transition-colors ${
              dragOverLocal ? 'bg-gray-100 animate-pulse' : 'hover:bg-gray-50'
            }`}
          >
            <div className="w-16 h-16 border border-black flex items-center justify-center text-3xl bg-white shadow-sm mb-4 animate-bounce">
              🔍
            </div>
            <span className="text-gem-normal font-bold block uppercase">Drag local file here to decode/inspect</span>
            <span className="text-gem-tiny text-gray-500 mt-1 block uppercase">Supports Atari screens, MSA/ST disks, and RAW files</span>
            <button className="gem-btn text-gem-small mt-4 font-bold px-4 py-1.5 cursor-pointer">
              LOAD LOCAL FILE
            </button>
          </div>
        </div>
      ) : (
        <>
      {/* File Stats Banner */}
      <div className="bg-white border-b border-black px-2 py-1 flex items-center justify-between no-drag font-sans">
        <div className="flex items-center gap-2">
          <div className="flex flex-col">
            <span className="text-gem-tiny text-gray-500 font-bold">
              Size: {bytes.length.toLocaleString()} Bytes
            </span>
            <span className="text-gem-tiny text-emerald-600 font-bold mt-0.5">
              {signatureInfo}
            </span>
          </div>
          {onOpenInDepack && detectPackerSignature(bytes) !== 'None' && !detectPackerSignature(bytes).startsWith('Atari ST Executable') && (manualDepack || !depackedResult) && (
            <button
              onClick={() => onOpenInDepack(fileName, bytes)}
              className="gem-btn text-gem-tiny py-0 px-2 ml-2 cursor-pointer font-bold shrink-0 uppercase"
              title="Open in DEPACK.PRG to extract this file"
            >
              🎁 OPEN IN DEPACK.PRG
            </button>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => handleModeSwitch('image')}
            className={`gem-btn text-gem-tiny py-0 px-2 relative ${
              viewMode === 'image' ? 'gem-selected' : ''
            }`}
          >
            IMAGE MODE
            {hasImage && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
          </button>
          <button
            onClick={() => handleModeSwitch('text')}
            className={`gem-btn text-gem-tiny py-0 px-2 ${
              viewMode === 'text' ? 'gem-selected' : ''
            }`}
          >
            TEXT MODE
          </button>
          <button
            onClick={() => handleModeSwitch('hex')}
            className={`gem-btn text-gem-tiny py-0 px-2 ${
              viewMode === 'hex' ? 'gem-selected' : ''
            }`}
          >
            HEX DUMP
          </button>
          <button
            onClick={() => handleModeSwitch('scrolltext')}
            className={`gem-btn text-gem-tiny py-0 px-2 relative ${
              viewMode === 'scrolltext' ? 'gem-selected' : ''
            }`}
          >
            SCROLLTEXT
            {depackedResult && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
          </button>
          {decodedFont && (
            <button
              onClick={() => handleModeSwitch('font')}
              className={`gem-btn text-gem-tiny py-0 px-2 relative ${
                viewMode === 'font' ? 'gem-selected' : ''
              }`}
            >
              FONT VIEWER
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Dynamic Text Mode Filter Toolbar */}
      {viewMode === 'text' && (
        <div className="bg-gray-100 border-b border-black px-2 py-1 flex items-center gap-1.5 text-gem-tiny select-none no-drag">
          <span className="font-bold mr-1 text-gray-600">TEXT VIEW FORMAT:</span>
          <button
            onClick={() => setTextFilter('raw')}
            className={`gem-btn py-0 px-1.5 ${textFilter === 'raw' ? 'gem-selected' : ''}`}
          >
            RAW TEXT
          </button>
          <button
            onClick={() => setTextFilter('ascii')}
            className={`gem-btn py-0 px-1.5 ${textFilter === 'ascii' ? 'gem-selected' : ''}`}
          >
            ASCII CLEANED
          </button>
          <button
            onClick={() => setTextFilter('strings')}
            className={`gem-btn py-0 px-1.5 ${textFilter === 'strings' ? 'gem-selected' : ''}`}
          >
            FIND STRINGS (strings &gt;= 4ch)
          </button>
        </div>
      )}

      {/* Dynamic Hex Mode Filter Toolbar */}
      {/* Main Container Workspace */}
      <div className="p-2 bg-white flex-grow overflow-auto h-[400px] flex items-stretch justify-stretch no-drag">
        {/* Canvas preview with advanced scanner controls */}
        <div
          className={`${
            viewMode === 'image' ? 'flex' : 'hidden'
          } w-full h-full flex-col gap-2 items-stretch justify-start bg-white`}
        >
          {/* Main Controls Panel */}
          <div className="border border-black bg-gray-50 p-2 text-gem-tiny flex flex-col gap-2 select-none shrink-0 rounded no-drag">
            <div className="flex flex-wrap items-center justify-between gap-1 border-b border-gray-200 pb-1.5 matches-box">
              <div className="flex items-center gap-1.5 shadow-sm p-0.5 bg-white border border-gray-200 rounded">
                <span className="font-bold text-gray-700 ml-1">RENDER MODE:</span>
                <button
                  onClick={() => setImageSubMode('native')}
                  disabled={!hasImage}
                  className={`gem-btn py-0 px-2 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed ${
                    imageSubMode === 'native' ? 'gem-selected' : ''
                  }`}
                >
                  NATIVE DECODER
                </button>
                <button
                  onClick={() => setImageSubMode('scan')}
                  className={`gem-btn py-0 px-2 text-[10px] ${
                    imageSubMode === 'scan' ? 'gem-selected' : ''
                  }`}
                >
                  MANUAL PLANAR SCANNER
                </button>
              </div>
            </div>

            {/* Config panel when in Scan Mode */}
            {imageSubMode === 'scan' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-1.5 bg-white border border-gray-200 rounded">
                {/* Left side: Offset parameters and Slider */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center bg-gray-50 p-1 border border-gray-100 rounded">
                    <span className="font-bold text-gray-700">VRAM BYTE OFFSET:</span>
                    <div className="flex items-center gap-1.5 font-mono">
                      <input
                        type="text"
                        value={imgOffset.toString()}
                        onChange={(e) => {
                          const val = parseOffset(e.target.value);
                          if (!isNaN(val)) {
                            const targetBytes = depackedResult ? depackedResult.data : bytes;
                            setImgOffset(Math.max(0, Math.min(targetBytes.length - 1, val)));
                          }
                        }}
                        className="border border-black bg-white px-1 py-0.5 w-20 text-center font-bold"
                      />
                      <span className="text-gray-400 text-[10px] font-bold">
                        (0x{imgOffset.toString(16).toUpperCase()})
                      </span>
                    </div>
                  </div>

                  {/* Step Buttons */}
                  <div className="flex gap-1">
                    <button
                      onClick={() => setImgOffset((prev) => Math.max(0, prev - 32000))}
                      className="gem-btn py-0.5 px-0.5 flex-grow font-bold text-[9px]"
                      title="Back 32000 Bytes (Full Screen Page)"
                    >
                      -32k
                    </button>
                    <button
                      onClick={() => setImgOffset((prev) => Math.max(0, prev - 160))}
                      className="gem-btn py-0.5 px-0.5 flex-grow font-bold text-[9px]"
                      title="Back 160 Bytes (One Planar Low-res line)"
                    >
                      -160
                    </button>
                    <button
                      onClick={() => setImgOffset((prev) => Math.max(0, prev - 2))}
                      className="gem-btn py-0.5 px-0.5 flex-grow font-bold text-[9px]"
                      title="Back 2 Bytes (One Word align)"
                    >
                      -2
                    </button>
                    <button
                      onClick={() => {
                        const targetBytes = depackedResult ? depackedResult.data : bytes;
                        setImgOffset((prev) => Math.min(targetBytes.length - 1, prev + 2));
                      }}
                      className="gem-btn py-0.5 px-0.5 flex-grow font-bold text-[9px]"
                      title="Forward 2 Bytes (One Word align)"
                    >
                      +2
                    </button>
                    <button
                      onClick={() => {
                        const targetBytes = depackedResult ? depackedResult.data : bytes;
                        setImgOffset((prev) => Math.min(targetBytes.length - 1, prev + 160));
                      }}
                      className="gem-btn py-0.5 px-0.5 flex-grow font-bold text-[9px]"
                      title="Forward 160 Bytes (One Planar Low-res line)"
                    >
                      +160
                    </button>
                    <button
                      onClick={() => {
                        const targetBytes = depackedResult ? depackedResult.data : bytes;
                        setImgOffset((prev) => Math.min(targetBytes.length - 1, prev + 32000));
                      }}
                      className="gem-btn py-0.5 px-0.5 flex-grow font-bold text-[9px]"
                      title="Forward 32000 Bytes (Full Screen Page)"
                    >
                      +32k
                    </button>
                  </div>

                  {/* Range slider bar */}
                  <div className="flex items-center mt-1">
                    <input
                      type="range"
                      min="0"
                      max={Math.max(1, (depackedResult ? depackedResult.data.length : bytes.length) - 1)}
                      step="2"
                      value={imgOffset}
                      onChange={(e) => setImgOffset(parseInt(e.target.value, 10))}
                      className="w-full accent-black h-2.5 bg-gray-200 cursor-pointer rounded-sm"
                    />
                  </div>
                </div>

                {/* Right side: Res options & palette */}
                <div className="flex flex-col gap-1.5 border-l border-gray-100 pl-3">
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-gray-700 uppercase text-[9px]">Planar Resolution:</label>
                    <select
                      value={`${imgWidth}x${imgHeight}x${imgColors}`}
                      onChange={(e) => {
                        const [w, h, c] = e.target.value.split('x').map(Number);
                        setImgWidth(w);
                        setImgHeight(h);
                        setImgColors(c);
                      }}
                      className="border border-black bg-white py-0.5 px-1 font-sans rounded-none outline-none text-gem-tiny font-medium shadow-sm"
                    >
                      <option value="320x200x16">Atari ST Low Res (320x200, 16 Colors, 4 planes)</option>
                      <option value="640x200x4">Atari ST Medium Res (640x200, 4 Colors, 2 planes)</option>
                      <option value="640x400x2">Atari ST High Res (640x400, Mono, 1 plane)</option>
                      <option value="16x16x16">16x16 Sprite (16 Colors, 4 planes)</option>
                      <option value="32x32x16">32x32 Sprite (16 Colors, 4 planes)</option>
                      <option value="48x48x16">48x48 Sprite (16 Colors, 4 planes)</option>
                      <option value="64x64x16">64x64 Sprite (16 Colors, 4 planes)</option>
                      <option value="128x128x16">128x128 Asset (16 Colors, 4 planes)</option>
                      <option value="160x100x16">Quarter Screen (16 Colors, 4 planes)</option>
                      <option value="160x200x16">Half Width Screen (16 Colors, 4 planes)</option>
                      <option value="320x100x16">Half Height Screen (16 Colors, 4 planes)</option>
                      <option value="256x256x16">256x256 Texture Grid (16 Colors, 4 planes)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1 mt-1 border-y border-dashed border-gray-200 py-1.5">
                    <span className="font-bold text-gray-700 uppercase text-[9px] mb-0.5">Custom Sizing (w × h):</span>
                    <div className="flex gap-2 items-center">
                      {/* Width Control */}
                      <div className="flex-1 flex flex-col gap-0.5">
                        <span className="text-[8px] font-bold text-gray-500 uppercase">Width:</span>
                        <div className="flex items-center border border-black bg-white overflow-hidden">
                          <button
                            onClick={() => setImgWidth((w) => Math.max(1, w - 16))}
                            className="bg-gray-100 px-1 hover:bg-gray-200 border-r border-gray-300 font-mono text-[9px] py-0.5"
                            title="Sub 16 Width"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            max="2000"
                            value={imgWidth}
                            onChange={(e) => setImgWidth(Math.max(1, parseInt(e.target.value, 10) || 16))}
                            className="w-10 text-center font-bold font-mono text-gem-tiny focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none py-0.5"
                          />
                          <button
                            onClick={() => setImgWidth((w) => Math.min(2000, w + 16))}
                            className="bg-gray-100 px-1 hover:bg-gray-200 border-l border-gray-300 font-mono text-[9px] py-0.5"
                            title="Add 16 Width"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Height Control */}
                      <div className="flex-1 flex flex-col gap-0.5">
                        <span className="text-[8px] font-bold text-gray-500 uppercase">Height:</span>
                        <div className="flex items-center border border-black bg-white overflow-hidden">
                          <button
                            onClick={() => setImgHeight((h) => Math.max(1, h - 8))}
                            className="bg-gray-100 px-1 hover:bg-gray-200 border-r border-gray-300 font-mono text-[9px] py-0.5"
                            title="Sub 8 Height"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            max="2000"
                            value={imgHeight}
                            onChange={(e) => setImgHeight(Math.max(1, parseInt(e.target.value, 10) || 8))}
                            className="w-10 text-center font-bold font-mono text-gem-tiny focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none py-0.5"
                          />
                          <button
                            onClick={() => setImgHeight((h) => Math.min(2000, h + 8))}
                            className="bg-gray-100 px-1 hover:bg-gray-200 border-l border-gray-300 font-mono text-[9px] py-0.5"
                            title="Add 8 Height"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Depth / Planes */}
                      <div className="flex flex-col gap-0.5 justify-end">
                        <span className="text-[8px] font-bold text-gray-500 uppercase">Colors:</span>
                        <div className="flex border border-black overflow-hidden bg-white">
                          {[16, 4, 2].map((col) => (
                            <button
                              key={col}
                              onClick={() => setImgColors(col)}
                              type="button"
                              className={`px-1 py-0.5 font-bold font-mono text-[9px] hover:bg-gray-100 hover:text-black ${
                                imgColors === col ? 'bg-black text-white hover:bg-black hover:text-white' : ''
                              }`}
                            >
                              {col}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-gray-700 uppercase text-[9px]">Palette Decoding Method:</label>
                    <select
                      value={paletteSource}
                      onChange={(e) => setPaletteSource(e.target.value as 'default' | 'offset')}
                      className="border border-black bg-white py-0.5 px-1 font-sans rounded-none outline-none text-gem-tiny font-medium shadow-sm"
                    >
                      <option value="default">(Preset) Atari ST Default Low-Res Palette</option>
                      <option value="offset">(Dynamic) Decode Palette Near VRAM Offset</option>
                    </select>
                  </div>

                  {paletteSource === 'offset' && (
                    <div className="flex items-center justify-between gap-2 border-t border-dashed border-gray-200 pt-1.5 mt-0.5">
                      <span className="font-bold text-gray-600 text-[9px]">PALETTE OFFSET:</span>
                      <input
                        type="text"
                        value={customPaletteOffset}
                        onChange={(e) => setCustomPaletteOffset(e.target.value)}
                        placeholder="Auto (ImgOffset - 32)"
                        className="bg-white border border-black font-mono font-bold text-center w-36 px-1.5 py-0.5 placeholder:font-sans placeholder:italic placeholder:text-[9px] placeholder:text-gray-400"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-teal-50 border border-teal-200 text-teal-800 p-2 font-bold select-text rounded">
                ✔ Displaying utilizing native '{fileName.split('.').pop()?.toUpperCase()}' file constraints and palette values.
              </div>
            )}
          </div>

          {/* Active Canvas Stage */}
          <div className="flex-grow flex items-center justify-center bg-gray-100 border border-black p-1.5 overflow-hidden max-h-[340px] rounded shadow-inner">
            <canvas
              ref={canvasRef}
              style={{
                imageRendering: 'pixelated',
                width: '100%',
                maxWidth: imageSubMode === 'native' ? '640px' : `${imgWidth * 2}px`,
                height: 'auto',
                maxHeight: '100%',
                backgroundColor: '#000'
              }}
            />
          </div>
        </div>

        {/* Text preview */}
        <pre
          className={`${
            viewMode === 'text' ? 'block' : 'hidden'
          } text-gem-small font-mono text-black whitespace-pre-wrap break-all w-full select-text max-h-full overflow-y-auto`}
        >
          {getDisplayedText()}
        </pre>

        {/* Hex Preview */}
        <pre
          onMouseUp={handleHexSelection}
          onKeyUp={handleHexSelection}
          className={`${
            viewMode === 'hex' ? 'block' : 'hidden'
          } text-gem-tiny font-mono text-black whitespace-pre w-full select-text max-h-full overflow-y-auto`}
        >
          {hexPreview}
        </pre>

        {/* Scrolltext Analyzer Mode */}
        {viewMode === 'scrolltext' && (
          <div className="flex flex-col w-full h-full gap-2 overflow-hidden">
            
            {/* Split Top Panel: Left list, Right tools/inspector */}
            <div className="flex flex-grow h-[460px] md:h-[480px] gap-2 overflow-hidden">
              
              {/* Left Candidate List Panel */}
              <div className="w-[185px] border border-black flex flex-col bg-gray-50 text-gem-tiny select-none shrink-0">
                <div className="bg-black text-white px-2 py-1 font-bold font-sans uppercase text-center">
                  🔍 Detected Streams
                </div>
                <div className="flex-grow overflow-y-auto p-1 font-mono flex flex-col gap-1">
                  {candidates.map((cand) => (
                    <button
                      key={cand.id}
                      onClick={() => {
                        setSelectedCandidateId(cand.id);
                        setCustomStart(cand.offset.toString());
                        setCustomEnd((cand.offset + cand.length).toString());
                        if (cand.isFontIndexed) {
                          setAlphabetMode('custom');
                        } else {
                          setAlphabetMode('ascii');
                        }
                      }}
                      className={`w-full text-left p-1 border border-transparent rounded cursor-pointer leading-tight ${
                        selectedCandidateId === cand.id
                          ? 'bg-black text-white font-bold border-black'
                          : 'hover:bg-gray-200 text-gray-800'
                      }`}
                    >
                      <div className="flex justify-between font-bold">
                        <span>{cand.offsetHex}</span>
                        {cand.hasCommonKeywords && (
                          <span className="text-emerald-700 font-sans font-bold">[DEMO]</span>
                        )}
                        {cand.isFontIndexed && (
                          <span className="text-[10px] text-amber-700 font-sans font-bold bg-amber-50 border border-amber-200 px-1 rounded">[FONT]</span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 truncate mt-0.5">
                        Len: {cand.length} | Term: {cand.terminator.split(' ')[0]}
                      </div>
                    </button>
                  ))}
                  
                  {candidates.length === 0 && (
                    <div className="text-gray-500 italic text-center p-3 text-[10px]">
                      No obvious scrolltext ASCII blocks detected. Use manual offset entry!
                    </div>
                  )}

                  {/* Manual trigger spacer */}
                  <button
                    onClick={() => {
                      setSelectedCandidateId(null);
                      setCustomStart('0');
                      setCustomEnd(bytes.length.toString());
                    }}
                    className={`w-full text-left p-1 border font-bold text-center mt-auto cursor-pointer text-[10px] ${
                      selectedCandidateId === null
                        ? 'bg-black text-white border-black'
                        : 'border-black hover:bg-gray-200'
                    }`}
                  >
                    CUSTOM SELECTION
                  </button>
                </div>
              </div>

              {/* Right Settings & Extracted Stream Inspector Panel */}
              <div className="flex-grow border border-black flex flex-col bg-white text-gem-tiny overflow-hidden min-w-0">
                <div className="bg-black text-white px-2 py-1 font-bold font-sans uppercase flex justify-between items-center shrink-0">
                  <span>🛠️ Extraction & Tuning Controls</span>
                  <span className="text-[10px] font-mono text-gray-300">
                    Source: {depackedResult ? 'Depacked Stream' : 'Raw File'}
                  </span>
                </div>
                
                {/* Scrollable tuning content area */}
                <div className="flex-grow overflow-y-auto flex flex-col gap-2.5 p-2 bg-gray-50 select-none">
                  
                  {/* Scrolltext Settings grid */}
                  <div className="p-2 border border-gray-300 bg-white grid grid-cols-2 gap-2 shadow-sm rounded">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-gray-700">Offset (From {"➔"} To):</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={customStart}
                          onChange={(e) => setCustomStart(e.target.value)}
                          placeholder="0"
                          className="border border-black bg-white px-1 py-0.5 w-16 text-center font-mono font-bold"
                        />
                        <span>→</span>
                        <input
                          type="text"
                          value={customEnd}
                          onChange={(e) => setCustomEnd(e.target.value)}
                          placeholder="1000"
                          className="border border-black bg-white px-1 py-0.5 w-16 text-center font-mono font-bold"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-gray-700">Atari Font Shift:</label>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setScrollShift(prev => prev - 1)}
                          className="gem-btn font-mono font-bold py-0 px-1.5 focus:outline-none"
                        >
                          -
                        </button>
                        <span className="font-mono font-bold bg-white border border-black px-1 py-0.5 text-center w-12 block">
                          {scrollShift > 0 ? `+${scrollShift}` : scrollShift}
                        </span>
                        <button
                          onClick={() => setScrollShift(prev => prev + 1)}
                          className="gem-btn font-mono font-bold py-0 px-1.5 focus:outline-none"
                        >
                          +
                        </button>
                        <button
                          onClick={() => setScrollShift(0)}
                          className="text-gray-500 font-sans hover:text-black font-bold p-0.5 text-[10px]"
                          title="Reset Shift"
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-gray-700">Terminator Stop:</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={stopAtTerminator}
                          onChange={(e) => setStopAtTerminator(e.target.checked)}
                          className="accent-black h-3.5 w-3.5"
                        />
                        <select
                          disabled={!stopAtTerminator}
                          value={selectedTerminator}
                          onChange={(e) => setSelectedTerminator(e.target.value)}
                          className="border border-black bg-white text-gem-tiny py-0.5 font-mono px-1 rounded-none outline-none disabled:opacity-50"
                        >
                          <option value="auto">Auto-detect (@,\0,])</option>
                          <option value="0x00">0x00 (NUL)</option>
                          <option value="0x40">0x40 ('@' Loop)</option>
                          <option value="0x5D">0x5D (']')</option>
                          <option value="0xFF">0xFF (End)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-gray-700">Formatting:</label>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <input
                          type="checkbox"
                          id="collapseSpaces"
                          checked={cleanWhitespace}
                          onChange={(e) => setCleanWhitespace(e.target.checked)}
                          className="accent-black h-3.5 w-3.5"
                        />
                        <label htmlFor="collapseSpaces" className="cursor-pointer font-medium">
                          Collapse spacer series
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Character Decoding Alphabet Card */}
                  <div className="p-2 border border-gray-300 bg-white shadow-sm flex flex-col gap-1.5 rounded">
                    <div className="font-bold text-gray-700 flex justify-between items-center border-b border-gray-200 pb-1 text-[10px]">
                      <span>🔠 CHARACTER DECODING ALPHABET</span>
                      <span className="text-[9px] text-indigo-700 font-bold bg-indigo-50 border border-indigo-200 px-1.5 rounded uppercase">
                        Mode: {alphabetMode === 'ascii' ? 'Direct ASCII' : 'Font Index'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-gray-600 text-[8.5px]">DECODER MODE:</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setAlphabetMode('ascii')}
                            className={`flex-grow font-sans py-0.5 px-1.5 text-[9px] text-center border cursor-pointer font-bold ${
                              alphabetMode === 'ascii'
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white hover:bg-gray-100 text-gray-700 border-gray-400'
                            }`}
                          >
                            ASCII Standard
                          </button>
                          <button
                            onClick={() => setAlphabetMode('custom')}
                            className={`flex-grow font-sans py-0.5 px-1.5 text-[9px] text-center border cursor-pointer font-bold ${
                              alphabetMode === 'custom'
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white hover:bg-gray-100 text-gray-700 border-gray-400'
                            }`}
                          >
                            Font Byte Index
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-gray-600 text-[8.5px]">ALPHABET PRESETS:</span>
                        <select
                          disabled={alphabetMode !== 'custom'}
                          value={alphabetPreset}
                          onChange={(e) => handlePresetChange(e.target.value)}
                          className="border border-gray-400 bg-white text-[10px] py-0.5 font-mono px-1 rounded-none outline-none disabled:opacity-50"
                        >
                          <option value="space-az">Space + A-Z + Symbols</option>
                          <option value="std-az">A-Z + Space</option>
                          <option value="az-space">A-Z + Symbols + Space</option>
                          <option value="full-alphanumeric">Mix Lower/Upper/Numbers</option>
                          <option value="custom">Custom (Type below)</option>
                        </select>
                      </div>
                    </div>

                    {alphabetMode === 'custom' && (
                      <div className="flex flex-col gap-1 mt-1 font-sans">
                        <div className="flex justify-between items-center text-[9px] text-gray-500">
                          <span className="font-mono font-bold">Alphabet Characters ({customAlphabet.length}):</span>
                          <span className="text-gray-400 italic">Font index 0 maps to first char</span>
                        </div>
                        <input
                          type="text"
                          value={customAlphabet}
                          onChange={(e) => {
                            setCustomAlphabet(e.target.value);
                            setAlphabetPreset('custom');
                          }}
                          className="border border-gray-400 bg-white px-1.5 py-0.5 text-gem-tiny font-mono font-bold w-full select-text text-indigo-700 tracking-wider"
                          placeholder="Alphabet character sequence map..."
                        />
                      </div>
                    )}
                  </div>

                  {/* Demo Crew Character Substitutions Card */}
                  <div className="p-2 border border-gray-300 bg-white shadow-sm flex flex-col gap-1.5 rounded">
                    <div className="font-bold text-gray-700 flex justify-between items-center border-b border-gray-200 pb-1 text-[10px]">
                      <span>🛠️ DEMO CREW TEXT TRANSLATION</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          id="applySubCheckbox"
                          checked={applySubstitution}
                          onChange={(e) => setApplySubstitution(e.target.checked)}
                          className="accent-black h-3 w-3 cursor-pointer"
                        />
                        <label htmlFor="applySubCheckbox" className="text-[9px] text-gray-600 font-bold cursor-pointer select-none">
                          Enabled
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <div className="flex flex-col gap-0.5 col-span-2">
                        <span className="font-bold text-gray-600 text-[8.5px]">REPLACEMENT PRESETS:</span>
                        <select
                          value={substitutionPreset}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSubstitutionPreset(val);
                            if (val === 'evilforce') {
                              setCustomSubstitutions('h=9\ng=8\nf=7\ne=6\nd=5\n9=4\n8=3\n7=2\n6=1\n5=0\n4=?\n3=,\n2=!\n1=.');
                              setApplySubstitution(true);
                              showToast('Loaded Evil Force Digi-Swap!');
                            } else if (val === 'reverse') {
                              setCustomSubstitutions('a=A\nb=B\nc=C\nd=D\ne=E\nf=F\ng=G\nh=H\ni=I\nj=J\nk=K\nl=L\nm=M\nn=N\no=O\np=P\nq=Q\nr=R\ns=S\nt=T\nu=U\nv=V\nw=W\nx=X\ny=Y\nz=Z\nA=a\nB=b\nC=c\nD=d\nE=e\nF=f\nG=g\nH=h\nI=i\nJ=j\nK=k\nL=l\nM=m\nN=n\nO=o\nP=p\nQ=q\nR=r\nS=s\nT=t\nU=u\nV=v\nW=w\nX=x\nY=y\nZ=z');
                              setApplySubstitution(true);
                              showToast('Loaded Case Inversion!');
                            } else if (val === 'custom') {
                              setApplySubstitution(true);
                            } else if (val === 'none') {
                              setCustomSubstitutions('');
                              setApplySubstitution(false);
                            }
                          }}
                          className="border border-gray-400 bg-white text-[10px] py-0.5 font-mono px-1 rounded-none outline-none cursor-pointer"
                        >
                          <option value="none">None (No Substitution)</option>
                          <option value="evilforce">Evil Force Digi-Swap (h=9, 1=.)</option>
                          <option value="reverse">Case Inversion (a ⟷ A)</option>
                          <option value="custom">Custom (Edit mappings below)</option>
                        </select>
                      </div>
                    </div>

                    {applySubstitution && (
                      <div className="flex flex-col gap-1 mt-1 font-sans">
                        <div className="flex justify-between items-center text-[9px] text-gray-500">
                          <span className="font-bold text-gray-600">Active Mappings (from=to per line):</span>
                          <span className="text-gray-400 italic">e.g. h=9</span>
                        </div>
                        <textarea
                          rows={4}
                          value={customSubstitutions}
                          onChange={(e) => {
                            setCustomSubstitutions(e.target.value);
                            setSubstitutionPreset('custom');
                          }}
                          className="border border-gray-400 bg-white px-1.5 py-1 text-gem-tiny font-mono font-bold w-full select-text text-amber-800 leading-tight focus:outline-none focus:border-amber-600"
                          placeholder="from=to&#10;e.g.&#10;h=9&#10;1=."
                        />
                        <div className="text-[8.5px] text-amber-900 bg-amber-50 p-1 border border-amber-200 mt-1 leading-normal rounded select-none">
                          <span className="font-bold text-amber-950 block mb-0.5">💡 Crew Replacement Map:</span>
                          <strong>Evil Force:</strong> Letters h-d map to digits 9-5. Digits 9-5 map to 4-0. Digits 4-1 map to symbols (?, ,, !, .).
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Relative Alphabet Match Locator */}
                  <div className="p-2 border border-gray-300 bg-white shadow-sm flex flex-col gap-1.5 rounded">
                    <div className="font-bold text-gray-700 border-b border-gray-200 pb-1 text-[10px]">
                      <span>🔍 PATTERN SEARCH (A-Z RELATIVE DIFF LOCATOR)</span>
                    </div>

                    <div className="flex gap-1.5 mt-1 font-sans">
                      <div className="flex-grow flex flex-col gap-0.5">
                        <input
                          type="text"
                          value={patternInput}
                          onChange={(e) => setPatternInput(e.target.value)}
                          placeholder="Type expected text (e.g. STAY TUNED)..."
                          className="border border-gray-400 bg-white px-1.5 py-0.5 text-gem-tiny font-bold w-full select-text inline-block"
                        />
                      </div>
                      <button
                        onClick={handlePatternSearch}
                        className="bg-black text-white hover:bg-gray-800 border border-black font-sans font-bold px-3 py-0.5 text-[9px] cursor-pointer shrink-0"
                      >
                        Scan File
                      </button>
                    </div>

                    {searchStatus && (
                      <div className="text-[10px] font-sans font-medium text-gray-600 bg-gray-50 p-1 border border-gray-200 leading-tight">
                        {searchStatus}
                      </div>
                    )}

                    {patternMatches.length > 0 && (
                      <div className="flex flex-col gap-1 max-h-[85px] overflow-y-auto border border-gray-200 rounded p-1 bg-gray-50 divide-y divide-gray-200">
                        {patternMatches.map((m, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setCustomStart(m.offset.toString());
                              setCustomEnd((m.offset + 1000).toString());
                              setScrollShift(m.shift);
                              setAlphabetMode('custom');
                              setSelectedCandidateId(null);
                              showToast(`Loaded pattern at ${m.hexOffset} with shift +${m.shift}!`);
                            }}
                            className="w-full text-left p-1 text-[9px] hover:bg-indigo-50 flex flex-col rounded cursor-pointer leading-tight transition-colors duration-150"
                          >
                            <div className="flex justify-between items-center font-bold text-indigo-950 font-sans">
                              <span>Offset: {m.hexOffset}</span>
                              <span className="text-[8px] font-mono font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 px-1 rounded">{m.detectedAlphabet}</span>
                            </div>
                            <div className="text-[9px] text-gray-700 truncate font-mono mt-0.5 bg-white border border-gray-200 px-1 py-0.5 rounded font-medium select-none">
                              {m.sample}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                </div>

                {/* Extracted preview text box */}
                <div className="h-[95px] p-1.5 flex flex-col bg-gray-50 border-t border-gray-200 shrink-0">
                  <div className="text-[10px] text-gray-500 uppercase font-sans font-bold flex justify-between select-none mb-1">
                    <span>Cleaned Stream Text Preview:</span>
                    <span className="text-gray-400">{scrollTextContent.length} chars</span>
                  </div>
                  <textarea
                    readOnly
                    value={scrollTextContent}
                    className="w-full flex-grow p-1 select-text bg-white border border-gray-300 font-mono text-[11px] text-black resize-none focus:outline-none overflow-y-auto"
                    placeholder="[No string extracted in current range]"
                  />
                </div>
              </div>

            </div>

            {/* Bottom Panel: Interactive Screen Motion Scrolling Simulator */}
            <div className="border border-black p-1 bg-black flex flex-col select-none relative h-[92px] shrink-0">
              {/* Ticker HUD Overlay */}
              <div className="absolute top-1 left-2 z-50 flex items-center gap-2 select-none">
                <span className="bg-emerald-600 text-white font-bold text-[9px] px-1 py-0.2 uppercase leading-none rounded">
                  {useCopperbar ? 'ATARI ST COPPERBAR ACT.' : 'GREEN PHOSPHOR MONITOR'}
                </span>
                
                <span className="text-white text-[9px] font-mono opacity-80">
                  Speed: {tickerSpeed}x
                </span>
              </div>
              
              <div className="absolute top-1 right-2 z-50 flex gap-2 select-none">
                <button
                  onClick={() => setUseCopperbar(!useCopperbar)}
                  className="bg-gray-800 hover:bg-gray-700 text-white border border-gray-600 px-1 py-0.2 rounded text-[9px] font-sans"
                >
                  {useCopperbar ? 'MONO SCREEN' : 'COPPERBARS'}
                </button>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => setTickerSpeed(0)}
                    className={`px-1 py-0.2 text-[9px] rounded font-mono ${tickerSpeed === 0 ? 'bg-red-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                  >
                    PAUSE
                  </button>
                  <button
                    onClick={() => setTickerSpeed(1)}
                    className={`px-1 py-0.2 text-[9px] rounded font-mono ${tickerSpeed === 1 ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                  >
                    1X
                  </button>
                  <button
                    onClick={() => setTickerSpeed(2)}
                    className={`px-1 py-0.2 text-[9px] rounded font-mono ${tickerSpeed === 2 ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                  >
                    2X
                  </button>
                  <button
                    onClick={() => setTickerSpeed(4)}
                    className={`px-1 py-0.2 text-[9px] rounded font-mono ${tickerSpeed === 4 ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                  >
                    4X
                  </button>
                </div>
              </div>

              {/* Scrolling Canvas */}
              <canvas
                ref={tickerCanvasRef}
                width={530}
                height={80}
                className="w-full h-full flex-grow block"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>

          </div>
        )}

        {/* FONT VIEWER SYSTEM MODE */}
        {viewMode === 'font' && decodedFont && (
          <div className="flex flex-col md:flex-row w-full h-[520px] gap-3 select-none no-drag text-black overflow-hidden bg-gray-50 p-2 rounded">
            
            {/* Left side: Grid of characters */}
            <div className="flex-grow flex flex-col h-full gap-1.5 md:w-2/3 min-w-0">
              <div className="bg-black text-white px-2.5 py-1 font-sans font-bold flex justify-between items-center text-gem-tiny rounded-sm">
                <span>🔤 GLYPH CHARACTER MAP (0-255)</span>
                <span className="text-[9px] text-gray-300 font-mono font-normal">FONT: {decodedFont.name.toUpperCase()}</span>
              </div>
              
              {/* Character Bento Map Grid */}
              <div className="flex-grow overflow-y-auto bg-white border border-black p-1.5 grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 gap-1 min-h-[220px]">
                {Array.from({ length: 256 }).map((_, c) => {
                  const isSelected = selectedFontChar === c;
                  const glyph = decodedFont.glyphs[c];
                  return (
                    <button
                      key={c}
                      onClick={() => setSelectedFontChar(c)}
                      className={`flex flex-col items-center justify-center border p-0.5 rounded transition h-14 ${
                        isSelected 
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-950 font-bold' 
                          : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50 text-gray-600'
                      }`}
                      title={`Char ${c} / 0x${c.toString(16).toUpperCase()}`}
                    >
                      <div className="text-[7.5px] font-mono leading-none font-bold text-gray-400">{c}</div>
                      <div className="flex-grow flex items-center justify-center scale-75">
                        <GlyphRenderer 
                          glyph={glyph} 
                          cellH={decodedFont.cellH} 
                          width={8}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right side: Character inspector/zoomer */}
            <div className="md:w-[220px] w-full flex flex-col h-full bg-white border border-black p-2.5 gap-2.5 overflow-y-auto shrink-0 select-none">
              <div className="border-b border-black pb-1.5 text-center text-gem-tiny font-sans font-bold text-gray-800">
                🔍 INSPECTOR PANEL
              </div>

              {selectedFontChar !== null ? (
                <>
                  <div className="flex flex-col items-center gap-1.5">
                    {/* Visual Zoom Big Render */}
                    <div className="text-[9px] text-gray-500 font-bold font-sans uppercase">Magnifier (4x zoom):</div>
                    <div className="border border-black p-1.5 bg-gray-55 flex items-center justify-center w-20 h-28 bg-gray-50">
                      <GlyphRenderer 
                        glyph={decodedFont.glyphs[selectedFontChar]} 
                        cellH={decodedFont.cellH} 
                        width={8}
                        scale={3}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 font-mono text-[9px] bg-gray-50 border border-gray-200 p-2 rounded">
                    <div className="flex justify-between border-b border-gray-100 pb-0.5">
                      <span className="font-bold text-gray-500">ASCII DEC:</span>
                      <span className="text-black font-extrabold">{selectedFontChar}</span>
                    </div>
                    <div className="flex justify-between border-b border-gray-100 pb-0.5">
                      <span className="font-bold text-gray-500">HEX:</span>
                      <span className="text-black font-extrabold">0x{selectedFontChar.toString(16).toUpperCase().padStart(2, '0')}</span>
                    </div>
                    <div className="flex justify-between border-b border-gray-100 pb-0.5">
                      <span className="font-bold text-gray-500">GLYPH:</span>
                      <span className="text-indigo-700 font-extrabold">
                        {selectedFontChar >= 32 && selectedFontChar <= 126 ? `'${String.fromCharCode(selectedFontChar)}'` : 'BIOS'}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-gray-100 pb-0.5">
                      <span className="font-bold text-gray-500">CELL H:</span>
                      <span className="text-black font-bold">{decodedFont.cellH} px</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-bold text-gray-500">POINTS:</span>
                      <span className="text-black font-bold">{decodedFont.points} pt</span>
                    </div>
                  </div>

                  {/* Byte Matrix Code Copy Block */}
                  <div className="flex flex-col gap-1 flex-grow min-h-0">
                    <span className="text-[9px] text-gray-400 font-bold uppercase">Atari Register Code:</span>
                    <textarea
                      readOnly
                      className="w-full font-mono text-[9px] bg-gray-105 border border-gray-200 p-1 rounded h-20 focus:outline-none resize-none flex-grow"
                      value={getGlyphByteArrayString(decodedFont.glyphs[selectedFontChar], decodedFont.cellH)}
                    />
                    <button
                      onClick={() => {
                        const val = getGlyphByteArrayString(decodedFont.glyphs[selectedFontChar], decodedFont.cellH);
                        navigator.clipboard.writeText(val);
                        showToast('Copied byte matrix code to clipboard!', 'success');
                      }}
                      className="gem-btn font-sans text-gem-tiny font-bold py-1 w-full hover:bg-gray-100 cursor-pointer"
                    >
                      COPY REGISTER CODE
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-grow flex items-center justify-center text-center text-gray-400 font-mono text-gem-tiny">
                  SELECT GLYPH TO EXAMINE REGISTER CODE
                </div>
              )}
            </div>
            
          </div>
        )}
      </div>

      {/* Binary Segment Extraction Panel */}
      <div className="bg-gray-100 border-t border-black px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-gem-tiny select-none no-drag">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-gray-700">EXTRACT BINARY CHUNK:</span>
          
          <div className="flex items-center gap-1">
            <span>From:</span>
            <input
              type="text"
              value={extractFrom}
              onChange={(e) => setExtractFrom(e.target.value)}
              placeholder="0x0"
              className="border border-black bg-white px-1 py-0.5 w-16 text-center font-mono font-bold text-gem-tiny"
            />
          </div>

          <div className="flex items-center gap-1">
            <span>To:</span>
            <input
              type="text"
              value={extractTo}
              onChange={(e) => setExtractTo(e.target.value)}
              placeholder="256"
              className="border border-black bg-white px-1 py-0.5 w-16 text-center font-mono font-bold text-gem-tiny"
            />
          </div>

          <div className="flex items-center gap-1">
            <span>Name:</span>
            <input
              type="text"
              value={extractFilename}
              onChange={(e) => setExtractFilename(e.target.value)}
              className="border border-black bg-white px-1.5 py-0.5 w-32 font-mono text-gem-tiny"
            />
          </div>

          {/* Dynamic feedback indicator */}
          <div className="text-gray-600 font-mono font-bold text-[10px] uppercase">
            {isValidFrom && isValidTo ? (
              <span className="text-emerald-700">
                Parsed: 0x{liveFrom.toString(16).toUpperCase()} ({liveFrom}) → 0x{liveTo.toString(16).toUpperCase()} ({liveTo}) | Size: {segmentSize.toLocaleString()} bytes
              </span>
            ) : (
              <span className="text-rose-700">
                {!isValidFrom ? "Invalid 'From'" : "Invalid 'To' (must be > 'From' and <= total)"}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={handleExtractSegment}
          className="gem-btn font-bold py-0.5 px-3 cursor-pointer"
        >
          SAVE CHUNK
        </button>
      </div>

      {/* Action Footer */}
      <div className="bg-white border-t border-black p-2 flex justify-end gap-2 no-drag">
        <button onClick={copyViewerContents} className="gem-btn text-gem-small py-0.5">
          COPY CONTENT
        </button>
        <button onClick={onClose} className="gem-btn text-gem-small py-0.5 px-4">
          CLOSE
        </button>
      </div>
      </>)}
    </GEMSkeletalWindow>
  );
}

function formatHexDump(bytes: Uint8Array): string {
  const rows: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const chunk = bytes.slice(off, off + 16);
    const hexRow: string[] = [];
    const asciiRow: string[] = [];
    for (let i = 0; i < 16; i++) {
      if (i < chunk.length) {
        hexRow.push(chunk[i].toString(16).toUpperCase().padStart(2, '0'));
        asciiRow.push(chunk[i] >= 32 && chunk[i] <= 126 ? String.fromCharCode(chunk[i]) : '.');
      } else {
        hexRow.push('  ');
      }
    }
    rows.push(
      `${off.toString(16).toUpperCase().padStart(6, '0')}  ${hexRow
        .slice(0, 8)
        .join(' ')}  ${hexRow.slice(8).join(' ')}  |${asciiRow.join('')}|`
    );
  }
  return rows.join('\n');
}

function parsePaletteFromBytes(bytes: Uint8Array, offset: number, count: number = 16): number[][] {
  const palette: number[][] = [];
  for (let i = 0; i < count; i++) {
    const idx = offset + (i * 2);
    if (idx + 1 >= bytes.length) {
      palette.push([0, 0, 0]);
      continue;
    }
    const word = (bytes[idx] << 8) | bytes[idx + 1];
    const b = (word & 0x007);
    const g = ((word & 0x070) >> 4);
    const r = ((word & 0x700) >> 8);
    palette.push([r << 5, g << 5, b << 5]);
  }
  return palette;
}

function parseOffset(val: string): number {
  const trimmed = val.trim();
  if (!trimmed) return 0;
  
  if (trimmed.toLowerCase().startsWith('0x')) {
    return parseInt(trimmed, 16);
  }
  
  if (/[a-fA-F]/.test(trimmed)) {
    return parseInt(trimmed, 16);
  }
  
  if (trimmed !== '0' && (/^0\d+/.test(trimmed) || trimmed.length >= 5)) {
    const hexParsed = parseInt(trimmed, 16);
    if (!isNaN(hexParsed)) return hexParsed;
  }
  
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const hexVal = parseInt(trimmed, 16);
  return isNaN(hexVal) ? NaN : hexVal;
}

const scrolltextsCache = new WeakMap<Uint8Array, ScrolltextCandidate[]>();

function scanForScrolltexts(bytes: Uint8Array): ScrolltextCandidate[] {
  if (!bytes || bytes.length === 0) return [];
  const cached = scrolltextsCache.get(bytes);
  if (cached !== undefined) return cached;

  const result = scanForScrolltextsInternal(bytes);
  scrolltextsCache.set(bytes, result);
  return result;
}

function scanForScrolltextsInternal(bytes: Uint8Array): ScrolltextCandidate[] {
  const candidates: ScrolltextCandidate[] = [];
  
  // Set sanity search limits to protect the browser from hanging on huge files
  // 1MB max range is more than enough to fully cover any standard Atari ST floppy disk
  const maxSearchLength = Math.min(bytes.length, 1048576);
  
  // Pass 1: Scan for standard ASCII printable scrolltexts
  let currentStart = -1;
  const minLength = 24;

  for (let i = 0; i < maxSearchLength; i++) {
    const b = bytes[i];
    const isPrintable = (b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13;

    if (isPrintable) {
      if (currentStart === -1) {
        currentStart = i;
      }
    } else {
      if (currentStart !== -1) {
        const length = i - currentStart;
        if (length >= minLength) {
          analyzeSegment(currentStart, i);
        }
        currentStart = -1;
      }
    }
  }

  if (currentStart !== -1) {
    const length = maxSearchLength - currentStart;
    if (length >= minLength) {
      analyzeSegment(currentStart, maxSearchLength);
    }
  }

  function analyzeSegment(start: number, end: number) {
    const rawSlice = bytes.subarray(start, end);
    let text = "";
    try {
      text = new TextDecoder("ascii").decode(rawSlice);
    } catch {
      const chars: string[] = [];
      for (let i = 0; i < rawSlice.length; i++) {
        const b = rawSlice[i];
        chars.push(b >= 32 && b <= 255 ? String.fromCharCode(b) : ' ');
      }
      text = chars.join('');
    }

    const trimmed = text.trim();
    if (trimmed.length < 12) return;
    
    // Eliminate highly redundant strings of repeating bytes
    const uniqueChars = new Set(trimmed);
    if (uniqueChars.size < 4) return;

    // Fast global regex match utilizing native V8 engine instead of individual character loops
    const matched = trimmed.match(/[a-zA-Z0-9\s.,!?'"()\-+=*/@:[\]]/g);
    const lettersSpaces = matched ? matched.length : 0;
    const ratio = lettersSpaces / trimmed.length;
    if (ratio < 0.85) return;

    // Grab suffix terminator representation
    let terminator = "None";
    if (end < bytes.length) {
      const tb = bytes[end];
      if (tb === 0) terminator = "0x00 (NUL)";
      else if (tb === 0x40) terminator = "0x40 ('@')";
      else if (tb === 0x5D) terminator = "0x5D (']')";
      else if (tb === 0xFF) terminator = "0xFF (End)";
      else terminator = `0x${tb.toString(16).toUpperCase().padStart(2, '0')}`;
    }

    const keywords = ['SCROLL', 'GREET', 'MUG', 'LEGEND', 'CRACK', 'DEMO', 'INTRO', 'UNION', 'MUSIC', 'HAPPY', 'THANKS', 'BEAT', 'ATARI', 'AMIGA', 'STE', 'ST'];
    const uppercaseText = text.toUpperCase();
    const hasCommonKeywords = keywords.some(k => uppercaseText.includes(k));

    candidates.push({
      id: candidates.length + 1,
      offset: start,
      offsetHex: `0x${start.toString(16).toUpperCase().padStart(6, '0')}`,
      length: rawSlice.length,
      text,
      terminator,
      hasCommonKeywords
    });
  }

  // Pass 2: Scan for custom font-indexed/small-byte scrolltexts (common in cracktros like Flame of Finland)
  let customStartIdx = -1;
  const minCustomLength = 40;

  for (let i = 0; i < maxSearchLength; i++) {
    const b = bytes[i];
    // Check if byte value fits within a typicial custom alphabet limit (typically under 64 characters)
    const isFontIndexValue = b >= 0 && b < 64;

    if (isFontIndexValue) {
      if (customStartIdx === -1) {
        customStartIdx = i;
      }
    } else {
      if (customStartIdx !== -1) {
        const length = i - customStartIdx;
        if (length >= minCustomLength) {
          analyzeCustomSegment(customStartIdx, i);
        }
        customStartIdx = -1;
      }
    }
  }

  if (customStartIdx !== -1) {
    const length = maxSearchLength - customStartIdx;
    if (length >= minCustomLength) {
      analyzeCustomSegment(customStartIdx, maxSearchLength);
    }
  }

  function analyzeCustomSegment(start: number, end: number) {
    const rawSlice = bytes.subarray(start, end);
    const len = rawSlice.length;

    // Reject uniform/uninteresting padding blocks (like large runs of zeroes or solid repeating values) 
    // within 256 bytes to prevent distribution scan overhead
    const checkLen = Math.min(len, 256);
    const initialSet = new Set<number>();
    for (let i = 0; i < checkLen; i++) {
      initialSet.add(rawSlice[i]);
    }
    if (initialSet.size < 4 && checkLen >= 30) return;

    // Reject segments with low uniqueness or wrong byte distributions
    const freqMap: Record<number, number> = {};
    const uniqueSet = new Set<number>();
    for (let i = 0; i < len; i++) {
      const b = rawSlice[i];
      freqMap[b] = (freqMap[b] || 0) + 1;
      uniqueSet.add(b);
    }

    const uniqueCount = uniqueSet.size;
    // Real scrolltexts use 8 to 55 different characters/font indexes
    if (uniqueCount < 8 || uniqueCount > 55) return;

    // Find the most frequent index (which is usually SPACE, mapped to 0, 1, or some index)
    let maxFreq = 0;
    let maxFreqByte = 0;
    for (const bStr in freqMap) {
      const freq = freqMap[bStr];
      if (freq > maxFreq) {
        maxFreq = freq;
        maxFreqByte = parseInt(bStr, 10);
      }
    }

    const maxRatio = maxFreq / len;
    // Normal written word spacing ratio (spaces make up 6% to 35% of an english text block)
    if (maxRatio < 0.06 || maxRatio > 0.35) return;

    // Assemble text preview using space-az standard preset alphabet mapping guess
    const presetGuess = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ.,!?\'-+=/*()[]":0123456789';
    // Shift so that the most frequent byte (usually Space) maps to index 0 (Space represented as first character in standard preset)
    const guessedShift = (256 - maxFreqByte) % 256;

    const chars: string[] = [];
    for (let i = 0; i < Math.min(80, len); i++) {
      const val = (rawSlice[i] + guessedShift) % 256;
      if (val >= 0 && val < presetGuess.length) {
        chars.push(presetGuess[val]);
      } else {
        chars.push('.');
      }
    }
    const textPreview = chars.join('');

    // Determine terminator representation
    let terminator = "None";
    if (end < bytes.length) {
      const tb = bytes[end];
      // Often, a byte greater than 64 represents terminator or custom control code (like 0xFF, 0x00 etc.)
      terminator = `0x${tb.toString(16).toUpperCase().padStart(2, '0')}`;
    }

    candidates.push({
      id: candidates.length + 1,
      offset: start,
      offsetHex: `0x${start.toString(16).toUpperCase().padStart(6, '0')}`,
      length: len,
      text: textPreview,
      terminator,
      hasCommonKeywords: false,
      isFontIndexed: true
    });
  }

  return candidates.sort((a, b) => {
    // Keep common keywords first
    if (a.hasCommonKeywords && !b.hasCommonKeywords) return -1;
    if (!a.hasCommonKeywords && b.hasCommonKeywords) return 1;
    // Show font-indexed next
    if (a.isFontIndexed && !b.isFontIndexed) return -1;
    if (!a.isFontIndexed && b.isFontIndexed) return 1;
    return b.length - a.length;
  });
}

function drawCharToCanvas(ctx: CanvasRenderingContext2D, char: string, px: number, py: number, color: string, scale: number = 2) {
  const font = stPixelFont[char.toUpperCase()] || stPixelFont[' '];
  ctx.fillStyle = color;
  for (let row = 0; row < 8; row++) {
    const byte = font[row];
    for (let col = 0; col < 8; col++) {
      if ((byte >> (7 - col)) & 1) {
        ctx.fillRect(px + col * scale, py + row * scale, scale, scale);
      }
    }
  }
}

function getSelectionCharacterOffsetsWithin(element: HTMLElement) {
  let start = 0;
  let end = 0;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(element);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    start = preSelectionRange.toString().length;
    end = start + range.toString().length;
  }
  return { start, end };
}

function charIndexToByteIndex(charIndex: number): number | null {
  const row = Math.floor(charIndex / 77);
  const col = charIndex % 77;
  
  let byteInRow = -1;
  if (col >= 8 && col <= 30) {
    byteInRow = Math.floor((col - 8) / 3);
  } else if (col >= 33 && col <= 55) {
    byteInRow = 8 + Math.floor((col - 33) / 3);
  } else if (col >= 59 && col < 75) {
    byteInRow = col - 59;
  }
  
  if (byteInRow >= 0 && byteInRow < 16) {
    return row * 16 + byteInRow;
  }
  return null;
}

function GlyphRenderer({ glyph, cellH, width = 8, scale = 2 }: { glyph: Uint8Array; cellH: number; width: number; scale?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = width * scale;
    canvas.height = cellH * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#312e81';
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < width; x++) {
        const val = glyph[y * width + x];
        if (val === 1) {
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
  }, [glyph, cellH, width, scale]);

  return <canvas ref={canvasRef} style={{ imageRendering: 'pixelated' }} className="block border border-gray-250 bg-white" />;
}

function getGlyphByteArrayString(glyph: Uint8Array, cellH: number): string {
  const byteStrings: string[] = [];
  for (let y = 0; y < cellH; y++) {
    let byteVal = 0;
    for (let x = 0; x < 8; x++) {
      const bit = glyph[y * 8 + x] || 0;
      byteVal |= (bit << (7 - x));
    }
    byteStrings.push(`0x${byteVal.toString(16).toUpperCase().padStart(2, '0')}`);
  }
  return `// Character Matrix Code (${cellH} bytes)\ndc.b ${byteStrings.join(', ')}`;
}

