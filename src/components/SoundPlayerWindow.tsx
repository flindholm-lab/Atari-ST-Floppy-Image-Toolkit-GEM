/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';

interface SoundPlayerWindowProps {
  isOpen: boolean;
  onClose: () => void;
  activeId: string;
  onFocus: () => void;
  mobileMode?: boolean;
  importedFileBytes: Uint8Array | null;
  importedFileName: string;
  onLoadLocalFile?: (name: string, bytes: Uint8Array) => void;
  showToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

// Retro Atari soundtrack presets
interface PresetTrack {
  title: string;
  composer: string;
  comment: string;
  dataLength: string;
  speedHz: number;
  patterns: Array<{
    notes: string[]; // 3-channel notes
    noise?: number;  // noise trigger level
    mixer?: number;  // register 7 mixer value
  }>;
}

interface ModInstrument {
  name: string;
  length: number;
  finetune: number;
  volume: number;
  loopStart: number;
  loopLength: number;
  audioBuffer: AudioBuffer | null;
}

interface ModPatternRow {
  sampleNum: number;
  period: number;
  effectCmd: number;
  effectParam: number;
}

interface ModTrack {
  title: string;
  instruments: ModInstrument[];
  songLength: number;
  patternOrder: number[];
  patterns: ModPatternRow[][][]; // [patternNum][rowNum 0-63][channelNum 0-3]
}

interface YMRecord {
  numFrames: number;
  masterClock: number;
  frameRate: number;
  loopFrame: number;
  songTitle: string;
  composer: string;
  comments: string;
  registers: Uint8Array;
  registerStride: number;
}

// Interleaved YM file parser (Leonard YM5/YM6 uncompressed format)
function parseYM(bytes: Uint8Array): YMRecord | null {
  if (bytes.length < 34) return null;
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  if (signature !== 'YM5!' && signature !== 'YM6!') {
    return null;
  }
  
  // Header bytes
  const numFrames = (bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15];
  const numDigidrums = (bytes[20] << 8) | bytes[21];
  const masterClock = (bytes[22] << 24) | (bytes[23] << 16) | (bytes[24] << 8) | bytes[25];
  const frameRate = (bytes[26] << 8) | bytes[27];
  const loopFrame = (bytes[28] << 24) | (bytes[29] << 16) | (bytes[30] << 8) | bytes[31];
  
  let offset = 34;
  
  // Skip digidrums if any
  for (let i = 0; i < numDigidrums; i++) {
    if (offset + 4 > bytes.length) break;
    const size = (bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3];
    offset += 4 + size;
  }
  
  // Read string helper
  const readString = () => {
    let str = "";
    while (offset < bytes.length) {
      const char = bytes[offset++];
      if (char === 0) break;
      if (char >= 32 && char <= 126) {
        str += String.fromCharCode(char);
      } else {
        str += " ";
      }
    }
    return str.replace(/\s+/g, ' ').trim();
  };
  
  const songTitle = readString() || "Atari PSG Tune";
  const composer = readString() || "Unknown Composer";
  const comments = readString() || "Uncompressed YM Register Capture";
  
  // Interleaved register block of size (16 * numFrames) or (14 * numFrames) starts here
  let registerStride = 16;
  let registerDataSize = 16 * numFrames;
  if (offset + registerDataSize > bytes.length) {
    registerStride = 14;
    registerDataSize = 14 * numFrames;
  }
  if (offset + registerDataSize > bytes.length) {
    return null;
  }
  const registers = bytes.subarray(offset, offset + registerDataSize);
  
  return {
    numFrames,
    masterClock: masterClock || 2000000,
    frameRate: frameRate || 50,
    loopFrame,
    songTitle,
    composer,
    comments,
    registers: new Uint8Array(registers),
    registerStride
  };
}

// Protracker AMIGA .MOD format parser
function parseMOD(bytes: Uint8Array, audioCtx: AudioContext): ModTrack | null {
  if (bytes.length < 1084) return null;
  
  const sig = String.fromCharCode(...bytes.subarray(1080, 1084));
  const validSigs = ["M.K.", "M!K!", "4CHN", "FLT4", "M.K"];
  const isValidSig = validSigs.some(s => sig.startsWith(s));
  if (!isValidSig) {
    // If the signature is missing but size is large, try processing as fallback MOD
    if (bytes.length < 50000) return null;
  }

  // Song Title (first 20 bytes)
  let title = "";
  for (let i = 0; i < 20; i++) {
    const charCode = bytes[i];
    if (charCode === 0) break;
    if (charCode >= 32 && charCode <= 126) {
      title += String.fromCharCode(charCode);
    } else {
      title += " ";
    }
  }
  title = title.replace(/\s+/g, ' ').trim();
  if (!title.trim()) title = "Tracker Module";
  
  // Parse 31 instruments starting at offset 20
  const instruments: ModInstrument[] = [];
  let insOffset = 20;
  for (let i = 0; i < 31; i++) {
    let name = "";
    for (let charIdx = 0; charIdx < 22; charIdx++) {
      const charCode = bytes[insOffset + charIdx];
      if (charCode === 0) continue;
      if (charCode >= 32 && charCode <= 126) {
        name += String.fromCharCode(charCode);
      } else {
        name += " ";
      }
    }
    name = name.replace(/\s+/g, ' ').trim();
    const sampleLength = ((bytes[insOffset + 22] << 8) | bytes[insOffset + 23]) * 2;
    const finetuneByte = bytes[insOffset + 24] & 0x0F;
    const finetune = finetuneByte >= 8 ? finetuneByte - 16 : finetuneByte;
    const volume = bytes[insOffset + 25];
    const loopStart = ((bytes[insOffset + 26] << 8) | bytes[insOffset + 27]) * 2;
    const loopLength = ((bytes[insOffset + 28] << 8) | bytes[insOffset + 29]) * 2;
    
    instruments.push({
      name: name.trim() || `Instrument ${i + 1}`,
      length: sampleLength,
      finetune,
      volume,
      loopStart,
      loopLength,
      audioBuffer: null
    });
    
    insOffset += 30;
  }
  
  const songLength = bytes[950];
  const patternOrder: number[] = [];
  for (let i = 0; i < 128; i++) {
    patternOrder.push(bytes[952 + i]);
  }
  
  // Find highest pattern number to determine memory layout size
  let numPatterns = 0;
  for (let i = 0; i < songLength; i++) {
    if (patternOrder[i] > numPatterns) {
      numPatterns = patternOrder[i];
    }
  }
  numPatterns += 1;
  
  // Decode Pattern stream from offset 1084
  const patterns: ModPatternRow[][][] = [];
  let patOffset = 1084;
  for (let p = 0; p < numPatterns; p++) {
    const patternRows: ModPatternRow[][] = [];
    for (let r = 0; r < 64; r++) {
      const rowChannels: ModPatternRow[] = [];
      for (let c = 0; c < 4; c++) {
        if (patOffset + 4 > bytes.length) break;
        const b0 = bytes[patOffset];
        const b1 = bytes[patOffset + 1];
        const b2 = bytes[patOffset + 2];
        const b3 = bytes[patOffset + 3];
        patOffset += 4;
        
        const sampleNum = (b0 & 0xF0) | ((b2 & 0xF0) >> 4);
        const period = ((b0 & 0x0F) << 8) | b1;
        const effectCmd = b2 & 0x0F;
        const effectParam = b3;
        
        rowChannels.push({ sampleNum, period, effectCmd, effectParam });
      }
      patternRows.push(rowChannels);
    }
    patterns.push(patternRows);
  }
  
  // Extract signed 8-bit PCM sample buffers
  let sampleOffset = patOffset;
  for (let i = 0; i < 31; i++) {
    const inst = instruments[i];
    if (inst.length > 0 && sampleOffset < bytes.length) {
      const L = Math.min(inst.length, bytes.length - sampleOffset);
      const audioBuffer = audioCtx.createBuffer(1, L, 22050); // Standard PAL playrate
      const channelData = audioBuffer.getChannelData(0);
      for (let idx = 0; idx < L; idx++) {
        let b = bytes[sampleOffset + idx];
        if (b > 127) b -= 256;
        channelData[idx] = b / 128.0;
      }
      inst.audioBuffer = audioBuffer;
      sampleOffset += inst.length;
    }
  }
  
  return {
    title,
    instruments,
    songLength,
    patternOrder,
    patterns
  };
}

export default function SoundPlayerWindow({
  isOpen,
  onClose,
  activeId,
  onFocus,
  mobileMode,
  importedFileBytes,
  importedFileName,
  onLoadLocalFile,
  showToast,
}: SoundPlayerWindowProps) {
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  const [isAudioLocked, setIsAudioLocked] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playerMode, setPlayerMode] = useState<'preset' | 'ym' | 'mod'>('preset');

  // Track naming layout states
  const [activeTrackName, setActiveTrackName] = useState<string>('Mad Max - Cuddly Demos');
  const [activeComposer, setActiveComposer] = useState<string>('Jochen Hippel');
  const [activeComment, setActiveComment] = useState<string>('Synth YM2149 Emulation');
  const [totalTicks, setTotalTicks] = useState<number>(360);
  const [currentTick, setCurrentTick] = useState<number>(0);
  
  // Audio state values
  const [volA, setVolA] = useState<number>(10);
  const [volB, setVolB] = useState<number>(10);
  const [volC, setVolC] = useState<number>(10);
  const [freqA, setFreqA] = useState<number>(440);
  const [freqB, setFreqB] = useState<number>(554);
  const [freqC, setFreqC] = useState<number>(659);

  // Mute channels triggers
  const [muteA, setMuteA] = useState<boolean>(false);
  const [muteB, setMuteB] = useState<boolean>(false);
  const [muteC, setMuteC] = useState<boolean>(false);
  const [muteNoise, setMuteNoise] = useState<boolean>(false);

  // Oscilloscope ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);

  // Web Audio Nodes references
  const synthNodes = useRef<{
    oscA: OscillatorNode | null;
    oscB: OscillatorNode | null;
    oscC: OscillatorNode | null;
    gainA: GainNode | null;
    gainB: GainNode | null;
    gainC: GainNode | null;
    noiseBufferSource: AudioBufferSourceNode | null;
    noiseGain: GainNode | null;
    analyzer: AnalyserNode | null;
    masterGain: GainNode | null;
  }>({
    oscA: null, oscB: null, oscC: null,
    gainA: null, gainB: null, gainC: null,
    noiseBufferSource: null, noiseGain: null,
    analyzer: null, masterGain: null
  });

  const channelGains = useRef<GainNode[]>([]);
  const activeSources = useRef<(AudioBufferSourceNode | null)[]>([null, null, null, null]);

  // Timers
  const trackerIntervalRef = useRef<any>(null);

  // Sequences registers pointers for trackers
  const currentYmRecord = useRef<YMRecord | null>(null);
  const ymFrame = useRef<number>(0);

  const currentModTrack = useRef<ModTrack | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAndPlayTrack = (name: string, bytes: Uint8Array) => {
    if (!bytes || bytes.length === 0) return;
    try {
      const ctx = initAudio() || audioCtx;
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      if (trackerIntervalRef.current) clearInterval(trackerIntervalRef.current);
      stopAllActiveSources();

      const headerSignature = String.fromCharCode(...bytes.subarray(0, 4));
      if (headerSignature.startsWith('YM')) {
        const ymRec = parseYM(bytes);
        if (ymRec) {
          currentYmRecord.current = ymRec;
          ymFrame.current = 0;
          
          let trackTitle = ymRec.songTitle;
          if ((!trackTitle || trackTitle === "Atari PSG Tune" || trackTitle === "Atari ST Tune") && name) {
            trackTitle = name.replace(/\.[^/.]+$/, "");
          }
          
          setActiveTrackName(trackTitle);
          setActiveComposer(ymRec.composer);
          setActiveComment(ymRec.comments);
          setTotalTicks(ymRec.numFrames);
          setCurrentTick(0);
          setPlayerMode('ym');
          
          showToast(`👾 Decoded uncompressed PSG YM track: ${trackTitle}!`, 'success');
          
          setIsPlaying(true);
          
          // Let's call runYmSequence directly but with updated reference since setPlayerMode is state-based
          // We can call runYmSequence() immediately
          setTimeout(() => {
            runYmSequence();
          }, 10);
        } else {
          showToast(`Invalid or unsupported compressed YM signature: ${headerSignature}. (Requires uncompressed YM5/YM6)`, 'error');
        }
      } else {
        const lowercaseName = name.toLowerCase();
        const isModExtension = lowercaseName.endsWith('.mod');
        const sig = String.fromCharCode(...bytes.subarray(1080, 1084));
        const validSigs = ["M.K.", "M!K!", "4CHN", "FLT4", "M.K"];
        const hasValidModSig = validSigs.some(s => sig.startsWith(s));

        if (isModExtension || hasValidModSig) {
          const modTrack = parseMOD(bytes, ctx);
          if (modTrack) {
            currentModTrack.current = modTrack;
            modRow.current = 0;
            modTick.current = 0;
            modPatternOrderIdx.current = 0;
            modSpeed.current = 6;
            modBpm.current = 125;
            activeInstrumentIndices.current = [0,0,0,0];
            activeChannelPeriods.current = [0,0,0,0];

            let trackTitle = modTrack.title;
            if ((!trackTitle || trackTitle === "Tracker Module" || trackTitle === "Amiga Module") && name) {
              trackTitle = name.replace(/\.[^/.]+$/, "");
            }

            setActiveTrackName(trackTitle);
            setActiveComposer('Amiga Modules');
            setActiveComment(`Protracker ${modTrack.instruments.filter(i=>i.length>0).length} channels sampler`);
            setTotalTicks(modTrack.songLength * 64);
            setCurrentTick(0);
            setPlayerMode('mod');

            showToast(`🎵 Decoded PAL Amiga Protracker MOD: ${trackTitle}!`, 'success');
            
            setIsPlaying(true);
            setTimeout(() => {
              runModSequence();
            }, 10);
          } else {
            showToast('Failed to parse tracker module of type MOD.', 'error');
          }
        } else {
          if (lowercaseName.endsWith('.ym') || lowercaseName.endsWith('.mym') || lowercaseName.endsWith('.snd')) {
            showToast(`Compressed or unsupported YM format (${name}). Emulation expects uncompressed YM5/YM6 format.`, 'error');
          } else {
            showToast('Unknown sound tracker or chiptune format. File is unrecognized.', 'error');
          }
        }
      }
    } catch (e) {
      console.error(e);
      showToast('Error parsing tracker file.', 'error');
    }
  };

  const handleLocalFileChoose = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const bytes = new Uint8Array(evt.target.result as ArrayBuffer);
          if (onLoadLocalFile) {
            onLoadLocalFile(file.name, bytes);
          } else {
            loadAndPlayTrack(file.name, bytes);
          }
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };
  const modSpeed = useRef<number>(6);
  const modBpm = useRef<number>(125);
  const modRow = useRef<number>(0);
  const modTick = useRef<number>(0);
  const modPatternOrderIdx = useRef<number>(0);
  const activeInstrumentIndices = useRef<number[]>([0, 0, 0, 0]);
  const activeChannelPeriods = useRef<number[]>([0, 0, 0, 0]);
  const nextTickTimeRef = useRef<number>(0);

  // Classic Atari Preset library
  const PRESETS: Record<string, PresetTrack> = {
    'cuddly': {
      title: 'Cuddly Demos (Main theme)',
      composer: 'Mad Max (Jochen Hippel)',
      comment: 'Atari ST 1989 - YM2149 chip',
      dataLength: '12,400 Bytes',
      speedHz: 50,
      patterns: [
        { notes: ['E4', 'G4', 'B4'], noise: 0, mixer: 0x38 },
        { notes: ['E4', 'A4', 'C5'], noise: 0, mixer: 0x38 },
        { notes: ['F#4', 'A4', 'D5'], noise: 12, mixer: 0x30 },
        { notes: ['G4', 'B4', 'E5'], noise: 0, mixer: 0x38 },
        { notes: ['A4', 'C5', 'E5'], noise: 8, mixer: 0x30 },
        { notes: ['B4', 'D#5', 'F#5'], noise: 0, mixer: 0x38 },
        { notes: ['C5', 'E5', 'G5'], noise: 15, mixer: 0x30 },
        { notes: ['B4', 'D#5', 'F#5'], noise: 0, mixer: 0x38 },
      ]
    },
    'union': {
      title: 'The Union Demo',
      composer: 'Big Alec',
      comment: 'Synth power chords and arpeggiator',
      dataLength: '16,580 Bytes',
      speedHz: 50,
      patterns: [
        { notes: ['A3', 'E4', 'A4'], noise: 10, mixer: 0x30 },
        { notes: ['G3', 'D4', 'G4'], noise: 0, mixer: 0x38 },
        { notes: ['F3', 'C4', 'F4'], noise: 14, mixer: 0x30 },
        { notes: ['E3', 'B3', 'E4'], noise: 0, mixer: 0x38 },
        { notes: ['F3', 'C4', 'F4'], noise: 10, mixer: 0x30 },
        { notes: ['G3', 'D4', 'G4'], noise: 0, mixer: 0x38 },
        { notes: ['A3', 'E4', 'A4'], noise: 15, mixer: 0x30 },
        { notes: ['B3', 'F#4', 'B4'], noise: 0, mixer: 0x38 },
      ]
    },
    'enchanted': {
      title: 'Enchanted Land Soundtrack',
      composer: 'Dave Rogers',
      comment: 'Flawless 3-voice ST-soundyard',
      dataLength: '9,810 Bytes',
      speedHz: 50,
      patterns: [
        { notes: ['D4', 'F4', 'A4'], noise: 0, mixer: 0x38 },
        { notes: ['A3', 'C#4', 'E4'], noise: 12, mixer: 0x30 },
        { notes: ['D4', 'F4', 'A4'], noise: 0, mixer: 0x38 },
        { notes: ['G4', 'Bb4', 'D5'], noise: 15, mixer: 0x30 },
        { notes: ['D4', 'F4', 'A4'], noise: 0, mixer: 0x38 },
        { notes: ['A3', 'C#4', 'E4'], noise: 10, mixer: 0x30 },
        { notes: ['D4', 'F4', 'A4'], noise: 0, mixer: 0x38 },
        { notes: ['C4', 'E4', 'G4'], noise: 12, mixer: 0x30 },
      ]
    }
  };

  const NOTE_FREQS: Record<string, number> = {
    'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
    'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
    'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77,
  };

  // Setup Web Audio Nodes
  const initAudio = () => {
    if (audioCtx) return audioCtx;

    let ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!ctx) return null;

    const newCtx = new ctx() as AudioContext;
    
    // Master Analyzer (tracks both synth oscillators and Amiga sample playing channels)
    const analyzer = newCtx.createAnalyser();
    analyzer.fftSize = 128;
    
    const masterGain = newCtx.createGain();
    masterGain.gain.setValueAtTime(0.6, newCtx.currentTime);
    
    analyzer.connect(masterGain);
    masterGain.connect(newCtx.destination);

    // Initialise 4 Channel Gains for MOD native resampler playback
    const modChans: GainNode[] = [];
    for (let c = 0; c < 4; c++) {
      const gNode = newCtx.createGain();
      gNode.gain.setValueAtTime(0.25, newCtx.currentTime);
      gNode.connect(analyzer);
      modChans.push(gNode);
    }
    channelGains.current = modChans;

    // Create 3 PSG voices for .YM playing / presets
    const oscA = newCtx.createOscillator();
    oscA.type = 'square';
    const gainA = newCtx.createGain();
    gainA.gain.setValueAtTime(0, newCtx.currentTime);
    oscA.connect(gainA);
    gainA.connect(analyzer);
    oscA.start();

    const oscB = newCtx.createOscillator();
    oscB.type = 'square';
    const gainB = newCtx.createGain();
    gainB.gain.setValueAtTime(0, newCtx.currentTime);
    oscB.connect(gainB);
    gainB.connect(analyzer);
    oscB.start();

    const oscC = newCtx.createOscillator();
    oscC.type = 'square';
    const gainC = newCtx.createGain();
    gainC.gain.setValueAtTime(0, newCtx.currentTime);
    oscC.connect(gainC);
    gainC.connect(analyzer);
    oscC.start();

    // White Noise Channel for PSG drum triggers
    const bufferSize = 2 * newCtx.sampleRate;
    const noiseBuffer = newCtx.createBuffer(1, bufferSize, newCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
       output[i] = Math.random() * 2 - 1;
    }

    const noiseBufferSource = newCtx.createBufferSource();
    noiseBufferSource.buffer = noiseBuffer;
    noiseBufferSource.loop = true;

    const noiseGain = newCtx.createGain();
    noiseGain.gain.setValueAtTime(0, newCtx.currentTime);

    const filter = newCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1000, newCtx.currentTime);

    noiseBufferSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(analyzer);
    noiseBufferSource.start();

    synthNodes.current = {
      oscA, oscB, oscC,
      gainA, gainB, gainC,
      noiseBufferSource, noiseGain,
      analyzer, masterGain
    };

    setIsAudioLocked(newCtx.state === 'suspended');
    newCtx.onstatechange = () => {
      setIsAudioLocked(newCtx.state === 'suspended');
    };

    setAudioCtx(newCtx);
    return newCtx;
  };

  const stopAllActiveSources = () => {
    activeSources.current.forEach((src, idx) => {
      if (src) {
        try {
          src.stop();
        } catch (e) {}
        activeSources.current[idx] = null;
      }
    });
  };

  const playSfx = (type: string) => {
    const ctx = initAudio() || audioCtx;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const dummyOsc = ctx.createOscillator();
    const dummyGain = ctx.createGain();
    dummyOsc.connect(dummyGain);
    dummyGain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'disinfect') {
      dummyOsc.type = 'triangle';
      dummyOsc.frequency.setValueAtTime(300, now);
      dummyOsc.frequency.exponentialRampToValueAtTime(1200, now + 0.35);
      dummyGain.gain.setValueAtTime(0.3, now);
      dummyGain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      dummyOsc.start(now);
      dummyOsc.stop(now + 0.35);
      showToast('🔊 Autopilot disinfect synth chirp triggered!', 'success');
    } else if (type === 'infect') {
      dummyOsc.type = 'sawtooth';
      dummyOsc.frequency.setValueAtTime(800, now);
      dummyOsc.frequency.exponentialRampToValueAtTime(100, now + 0.5);
      dummyGain.gain.setValueAtTime(0.4, now);
      dummyGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      dummyOsc.start(now);
      dummyOsc.stop(now + 0.5);
      showToast('💀 Alien infection code registered (Simulated YM sweep)', 'error');
    } else if (type === 'boot') {
      dummyOsc.type = 'square';
      dummyOsc.frequency.setValueAtTime(880, now);
      dummyOsc.frequency.setValueAtTime(1100, now + 0.08);
      dummyGain.gain.setValueAtTime(0.25, now);
      dummyGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      dummyOsc.start(now);
      dummyOsc.stop(now + 0.25);
      showToast('🎹 Standard Atari diagnostic RAM boot tone sound', 'info');
    } else if (type === 'laser') {
      dummyOsc.type = 'square';
      dummyOsc.frequency.setValueAtTime(1500, now);
      dummyOsc.frequency.exponentialRampToValueAtTime(50, now + 0.4);
      dummyGain.gain.setValueAtTime(0.3, now);
      dummyGain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      dummyOsc.start(now);
      dummyOsc.stop(now + 0.4);
    }
  };

  // Run uncompressed YM step sequence at 50Hz register updates with precision look-ahead scheduling
  const runYmSequence = () => {
    const record = currentYmRecord.current;
    if (!record) return;

    const ctx = initAudio() || audioCtx;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    setIsPlaying(true);
    setPlayerMode('ym');

    if (trackerIntervalRef.current) clearInterval(trackerIntervalRef.current);
    const frameRate = record.frameRate || 50;
    const frameDuration = 1 / frameRate;

    nextTickTimeRef.current = ctx.currentTime + 0.05;

    const processYmFrame = (timeToPlay: number) => {
      const f = ymFrame.current;
      const numF = record.numFrames;

      if (f % 5 === 0 || f === numF - 1) {
        setCurrentTick(f);
        setTotalTicks(numF);
      }

      const nodes = synthNodes.current;
      if (!nodes || !nodes.oscA) return;

      const regs = record.registers;

      const getReg = (r: number) => {
        const idx = r * numF + f;
        return regs[idx] || 0;
      };

      const r0 = getReg(0);
      const r1 = getReg(1);
      const r2 = getReg(2);
      const r3 = getReg(3);
      const r4 = getReg(4);
      const r5 = getReg(5);
      const r6 = getReg(6);
      const r7 = getReg(7);
      const r8 = getReg(8);
      const r9 = getReg(9);
      const r10 = getReg(10);

      const clock = record.masterClock;

      // Tone tuning periods
      const pA = ((r1 & 0x0F) << 8) | r0;
      const pB = ((r3 & 0x0F) << 8) | r2;
      const pC = ((r5 & 0x0F) << 8) | r4;

      const fA = pA > 0 ? clock / (16 * pA) : 0;
      const fB = pB > 0 ? clock / (16 * pB) : 0;
      const fC = pC > 0 ? clock / (16 * pC) : 0;

      setFreqA(Math.round(fA));
      setFreqB(Math.round(fB));
      setFreqC(Math.round(fC));

      const toneA_off = (r7 & 0x01) !== 0;
      const toneB_off = (r7 & 0x02) !== 0;
      const toneC_off = (r7 & 0x04) !== 0;

      // Check envelope bits in volume registers: if bit 4 (0x10) is set, we use simulated envelope volume
      const hasEnvA = (r8 & 0x10) !== 0;
      const vA = hasEnvA ? 12 : (r8 & 0x0F);

      const hasEnvB = (r9 & 0x10) !== 0;
      const vB = hasEnvB ? 12 : (r9 & 0x0F);

      const hasEnvC = (r10 & 0x10) !== 0;
      const vC = hasEnvC ? 12 : (r10 & 0x0F);

      setVolA(vA);
      setVolB(vB);
      setVolC(vC);

      // Play through oscillators scheduled sample-accurately at timeToPlay
      if (fA > 0 && !toneA_off && !muteA) {
        nodes.oscA.frequency.setValueAtTime(fA, timeToPlay);
        nodes.gainA.gain.setValueAtTime((vA / 15) * 0.15, timeToPlay);
      } else {
        nodes.gainA.gain.setValueAtTime(0, timeToPlay);
      }

      if (fB > 0 && !toneB_off && !muteB) {
        nodes.oscB.frequency.setValueAtTime(fB, timeToPlay);
        nodes.gainB.gain.setValueAtTime((vB / 15) * 0.15, timeToPlay);
      } else {
        nodes.gainB.gain.setValueAtTime(0, timeToPlay);
      }

      if (fC > 0 && !toneC_off && !muteC) {
        nodes.oscC.frequency.setValueAtTime(fC, timeToPlay);
        nodes.gainC.gain.setValueAtTime((vC / 15) * 0.15, timeToPlay);
      } else {
        nodes.gainC.gain.setValueAtTime(0, timeToPlay);
      }

      // Noise frequency computation
      const pNoise = r6 & 0x1F;
      const noiseA_on = (r7 & 0x08) === 0;
      const noiseB_on = (r7 & 0x10) === 0;
      const noiseC_on = (r7 & 0x20) === 0;

      if ((noiseA_on || noiseB_on || noiseC_on) && !muteNoise) {
        const noiseLevel = Math.max(vA, vB, vC) / 15 * 0.05;
        nodes.noiseGain.gain.setValueAtTime(noiseLevel, timeToPlay);
      } else {
        nodes.noiseGain.gain.setValueAtTime(0, timeToPlay);
      }

      ymFrame.current++;
      if (ymFrame.current >= numF) {
        ymFrame.current = record.loopFrame < numF ? record.loopFrame : 0;
      }
    };

    const scheduler = () => {
      while (nextTickTimeRef.current < ctx.currentTime + 0.05) {
        processYmFrame(nextTickTimeRef.current);
        nextTickTimeRef.current += frameDuration;
      }
    };

    trackerIntervalRef.current = setInterval(scheduler, 10);
  };

  // Run Protracker Amiga module sequence with precision look-ahead scheduling
  const runModSequence = () => {
    const track = currentModTrack.current;
    if (!track) return;

    const ctx = initAudio() || audioCtx;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    setIsPlaying(true);
    setPlayerMode('mod');
    stopAllActiveSources();

    if (trackerIntervalRef.current) clearInterval(trackerIntervalRef.current);

    nextTickTimeRef.current = ctx.currentTime + 0.05;

    const processModTick = (timeToPlay: number) => {
      const activePatIdx = track.patternOrder[modPatternOrderIdx.current];
      const activePat = track.patterns[activePatIdx];
      if (!activePat) {
        modPatternOrderIdx.current = 0;
        modRow.current = 0;
        modTick.current = 0;
        return;
      }

      const r = modRow.current;
      const tIdx = modPatternOrderIdx.current;

      if (modTick.current === 0) {
        setCurrentTick((tIdx * 64) + r);
        setTotalTicks(track.songLength * 64);
        const rowData = activePat[modRow.current];
        if (rowData) {
          rowData.forEach((chanData, chanIdx) => {
            const { sampleNum, period, effectCmd, effectParam } = chanData;
            
            if (sampleNum > 0) {
              activeInstrumentIndices.current[chanIdx] = sampleNum;
            }

            if (period > 0) {
              activeChannelPeriods.current[chanIdx] = period;
              
              if (activeSources.current[chanIdx]) {
                try {
                  activeSources.current[chanIdx]?.stop(timeToPlay);
                } catch (e) {}
              }

              const instIdx = activeInstrumentIndices.current[chanIdx] - 1;
              const inst = track.instruments[instIdx];
              if (inst && inst.audioBuffer) {
                const src = ctx.createBufferSource();
                src.buffer = inst.audioBuffer;
                
                if (inst.loopLength > 2) {
                  src.loop = true;
                  src.loopStart = inst.loopStart / 22050;
                  src.loopEnd = (inst.loopStart + inst.loopLength) / 22050;
                }

                // Pal Clock constant speed translation
                const rate = (3546895 / period) / 22050;
                src.playbackRate.setValueAtTime(rate, timeToPlay);

                let vol = inst.volume / 64;
                if (effectCmd === 0xC) {
                  vol = effectParam / 64;
                }

                const isMuted = (muteA && chanIdx ===0) || (muteB && chanIdx === 1) || (muteC && chanIdx === 2) || (muteNoise && chanIdx === 3);
                if (channelGains.current[chanIdx]) {
                  channelGains.current[chanIdx].gain.setValueAtTime(isMuted ? 0 : vol * 0.25, timeToPlay);
                }

                src.connect(channelGains.current[chanIdx]);
                src.start(timeToPlay);
                activeSources.current[chanIdx] = src;
              }
            } else {
              if (effectCmd === 0xC) {
                const vol = effectParam / 64;
                if (channelGains.current[chanIdx]) {
                  channelGains.current[chanIdx].gain.setValueAtTime(vol * 0.25, timeToPlay);
                }
              }
            }

            // BPM / Speed triggers
            if (effectCmd === 0xF) {
              if (effectParam < 32) {
                modSpeed.current = effectParam || 6;
              } else {
                modBpm.current = effectParam;
              }
            }
          });
        }
      }

      modTick.current++;
      if (modTick.current >= modSpeed.current) {
        modTick.current = 0;
        modRow.current++;
        if (modRow.current >= 64) {
          modRow.current = 0;
          modPatternOrderIdx.current++;
          if (modPatternOrderIdx.current >= track.songLength) {
            modPatternOrderIdx.current = 0;
          }
        }
      }
    };

    const scheduler = () => {
      while (nextTickTimeRef.current < ctx.currentTime + 0.05) {
        processModTick(nextTickTimeRef.current);
        const tickDuration = 2.5 / modBpm.current;
        nextTickTimeRef.current += tickDuration;
      }
    };

    trackerIntervalRef.current = setInterval(scheduler, 10);
  };

  const handleLoadImportedFile = () => {
    if (!importedFileBytes) {
      showToast('No audio files loaded into disk drives to play. Use drive explorer to mount or drag/drop local files anywhere!', 'info');
      return;
    }

    try {
      const ctx = initAudio() || audioCtx;
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      if (trackerIntervalRef.current) clearInterval(trackerIntervalRef.current);
      stopAllActiveSources();

      const headerSignature = String.fromCharCode(...importedFileBytes.subarray(0, 4));
      if (headerSignature.startsWith('YM')) {
        // Real uncompressed YM file!
        const ymRec = parseYM(importedFileBytes);
        if (ymRec) {
          currentYmRecord.current = ymRec;
          ymFrame.current = 0;
          
          let trackTitle = ymRec.songTitle;
          if ((!trackTitle || trackTitle === "Atari PSG Tune" || trackTitle === "Atari ST Tune") && importedFileName) {
            trackTitle = importedFileName.replace(/\.[^/.]+$/, "");
          }
          
          setActiveTrackName(trackTitle);
          setActiveComposer(ymRec.composer);
          setActiveComment(ymRec.comments);
          setTotalTicks(ymRec.numFrames);
          setCurrentTick(0);
          setPlayerMode('ym');
          
          showToast(`👾 Decoded REAL uncompressed PSG YM track: ${trackTitle}!`, 'success');
          runYmSequence();
        } else {
          showToast(`Invalid or unsupported compressed YM signature: ${headerSignature}. (Requires uncompressed YM5/YM6 register stream)`, 'error');
        }
      } else {
        const lowercaseName = importedFileName.toLowerCase();
        const isModExtension = lowercaseName.endsWith('.mod');
        const sig = String.fromCharCode(...importedFileBytes.subarray(1080, 1084));
        const validSigs = ["M.K.", "M!K!", "4CHN", "FLT4", "M.K"];
        const hasValidModSig = validSigs.some(s => sig.startsWith(s));

        if (isModExtension || hasValidModSig) {
          // Let's decode it as an Amiga Protracker MOD sampler module
          const modTrack = parseMOD(importedFileBytes, ctx);
          if (modTrack) {
            currentModTrack.current = modTrack;
            modRow.current = 0;
            modTick.current = 0;
            modPatternOrderIdx.current = 0;
            modSpeed.current = 6;
            modBpm.current = 125;
            activeInstrumentIndices.current = [0,0,0,0];
            activeChannelPeriods.current = [0,0,0,0];

            let trackTitle = modTrack.title;
            if ((!trackTitle || trackTitle === "Tracker Module" || trackTitle === "Amiga Module") && importedFileName) {
              trackTitle = importedFileName.replace(/\.[^/.]+$/, "");
            }

            setActiveTrackName(trackTitle);
            setActiveComposer('Amiga Modules');
            setActiveComment(`Protracker ${modTrack.instruments.filter(i=>i.length>0).length} channels sampler`);
            setTotalTicks(modTrack.songLength * 64);
            setCurrentTick(0);
            setPlayerMode('mod');

            showToast(`🎵 Decoded PAL Amiga Protracker MOD: ${trackTitle}!`, 'success');
            runModSequence();
          } else {
            showToast('Failed to parse tracker module of type MOD.', 'error');
          }
        } else {
          if (lowercaseName.endsWith('.ym') || lowercaseName.endsWith('.mym') || lowercaseName.endsWith('.snd')) {
            showToast(`Compressed or unsupported YM format (${importedFileName}). Emulation expects uncompressed YM5/YM6 format.`, 'error');
          } else {
            showToast('Unknown sound tracker or chiptune format. File is unrecognized.', 'error');
          }
        }
      }
    } catch (e) {
      console.error(e);
      showToast('Error parsing tracker file structure.', 'error');
    }
  };

  const playPreset = (presetKey: 'cuddly' | 'union' | 'enchanted') => {
    const track = PRESETS[presetKey];
    if (!track) return;

    const ctx = initAudio() || audioCtx;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Clear and stop general registers
    if (trackerIntervalRef.current) clearInterval(trackerIntervalRef.current);
    stopAllActiveSources();

    setActiveTrackName(track.title);
    setActiveComposer(track.composer);
    setActiveComment(track.comment);
    setIsPlaying(true);
    setTotalTicks(120);
    setPlayerMode('preset');

    let cnt = 0;

    trackerIntervalRef.current = setInterval(() => {
      const stepIdx = cnt % track.patterns.length;
      cnt++;
      setCurrentTick(cnt % 120);

      const pattern = track.patterns[stepIdx];
      const nodes = synthNodes.current;
      if (!nodes || !nodes.oscA) return;

      const time = ctx.currentTime;
      const notes = pattern.notes;
      const fA = NOTE_FREQS[notes[0]] || 261;
      const fB = NOTE_FREQS[notes[1]] || 329;
      const fC = NOTE_FREQS[notes[2]] || 392;

      setFreqA(Math.round(fA));
      setFreqB(Math.round(fB));
      setFreqC(Math.round(fC));

      nodes.oscA.frequency.setValueAtTime(fA, time);
      nodes.oscB.frequency.setValueAtTime(fB, time);
      nodes.oscC.frequency.setValueAtTime(fC, time);

      const ampA = stepIdx % 2 === 0 ? 12 : 6;
      const ampB = stepIdx % 3 === 0 ? 10 : 5;
      const ampC = stepIdx % 4 === 0 ? 14 : 7;

      setVolA(ampA);
      setVolB(ampB);
      setVolC(ampC);

      nodes.gainA.gain.setValueAtTime(muteA ? 0 : (ampA / 15) * 0.15, time);
      nodes.gainB.gain.setValueAtTime(muteB ? 0 : (ampB / 15) * 0.15, time);
      nodes.gainC.gain.setValueAtTime(muteC ? 0 : (ampC / 15) * 0.15, time);

      if (pattern.noise && pattern.noise > 0) {
        const noiseLevel = (pattern.noise / 15) * 0.1;
        nodes.noiseGain.gain.setValueAtTime(muteNoise ? 0 : noiseLevel, time);
        nodes.noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      }
    }, 150);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      if (trackerIntervalRef.current) clearInterval(trackerIntervalRef.current);
      stopAllActiveSources();
      const nodes = synthNodes.current;
      if (nodes && nodes.gainA) {
        const t = audioCtx?.currentTime || 0;
        nodes.gainA.gain.setValueAtTime(0, t);
        nodes.gainB.gain.setValueAtTime(0, t);
        nodes.gainC.gain.setValueAtTime(0, t);
        nodes.noiseGain.gain.setValueAtTime(0, t);
      }
      setIsPlaying(false);
    } else {
      if (playerMode === 'ym' && currentYmRecord.current) {
        runYmSequence();
      } else if (playerMode === 'mod' && currentModTrack.current) {
        runModSequence();
      } else {
        playPreset('cuddly');
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = canvas.width;
    let height = canvas.height;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let i = 0; i < width; i += 20) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
        ctx.stroke();
      }
      for (let j = 0; j < height; j += 20) {
        ctx.beginPath();
        ctx.moveTo(0, j);
        ctx.lineTo(width, j);
        ctx.stroke();
      }

      const analyzer = synthNodes.current.analyzer;
      if (analyzer && isPlaying) {
        const bufferLength = analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyzer.getByteTimeDomainData(dataArray);

        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2.5;
        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.lineTo(width, height / 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#15803d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
      }
    };

    draw();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isOpen, isPlaying]);

  useEffect(() => {
    return () => {
      if (trackerIntervalRef.current) clearInterval(trackerIntervalRef.current);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (audioCtx) {
        audioCtx.close();
      }
    };
  }, [audioCtx]);

  useEffect(() => {
    if (importedFileBytes && isOpen) {
      handleLoadImportedFile();
    }
  }, [importedFileBytes, isOpen]);

  return (
    <GEMSkeletalWindow
      id="sound"
      title="SOUND.PRG"
      isOpen={isOpen}
      onClose={() => {
        if (trackerIntervalRef.current) clearInterval(trackerIntervalRef.current);
        stopAllActiveSources();
        const nodes = synthNodes.current;
        if (nodes && nodes.gainA) {
          nodes.gainA.gain.setValueAtTime(0, 0);
          nodes.gainB.gain.setValueAtTime(0, 0);
          nodes.gainC.gain.setValueAtTime(0, 0);
        }
        setIsPlaying(false);
        onClose();
      }}
      defaultX={220}
      defaultY={80}
      width={500}
      activeId={activeId}
      onFocus={onFocus}
      mobileMode={mobileMode}
    >
      <div 
        onMouseDown={() => {
          const ctx = audioCtx || initAudio();
          if (ctx && ctx.state === "suspended") {
            ctx.resume().catch((e) => console.error(e));
          }
        }}
        className="bg-slate-900 text-white p-4 font-mono text-gem-normal no-drag flex flex-col gap-4 select-none"
      >
        
        {/* PLAYER CONTROL HUB HEADER */}
        <div className="flex items-center justify-between border-b border-sky-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-sky-950 border border-sky-800 text-sky-400 font-bold rounded-sm text-gem-medium animate-pulse animate-none">
              {playerMode === 'mod' ? '🎹 AMIGA' : '🎛️ YM2149'}
            </div>
            <div>
              <h2 className="font-bold text-gem-medium text-sky-300 leading-tight">
                {playerMode === 'mod' ? 'PROTRACKER SAMPLER CORE' : 'YM2149 PSG PLAYER'}
              </h2>
              <span className="text-[9px] text-gray-400 block uppercase">
                {playerMode === 'mod' ? 'Amiga 4-Channel Native Resampler' : 'Real-Time Web Audio PSG Engine'}
              </span>
            </div>
          </div>
          <div className="text-right flex flex-col items-end gap-1">
            <span className={`text-[10px] font-bold border px-2 py-0.5 rounded uppercase ${
              isAudioLocked 
                ? 'bg-amber-950 text-amber-400 border-amber-800 animate-pulse' 
                : 'bg-red-950 text-red-500 border-red-900'
            }`}>
              {isAudioLocked ? '🔊 CLICK TO UNMUTE' : (isPlaying ? '● PLAYING LIVE' : '■ STANDBY')}
            </span>
            {isAudioLocked && (
              <span className="text-[8px] text-amber-500 uppercase tracking-wider">
                Click window to unlock audio
              </span>
            )}
          </div>
        </div>

        {/* METADATA DISPLAY CHIP */}
        <div className="bg-slate-950 border border-sky-950 p-3 rounded flex flex-col gap-1.5 text-gem-small shadow-inner">
          <div className="flex justify-between text-[11px]">
            <span className="text-sky-400 font-bold">ACTIVE FILE:</span>
            <span className="text-white font-bold max-w-[280px] truncate">{activeTrackName}</span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-400">
            <span>COMPOSER / FORMAT:</span>
            <span className="text-sky-100">{activeComposer}</span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 italic">
            <span>METADATA COMMENTS:</span>
            <span>{activeComment}</span>
          </div>
          
          {/* TRACK STATUS PROGRESS */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] text-sky-400">00:00</span>
            <div className="flex-grow bg-slate-800 h-2 rounded overflow-hidden relative">
              <div 
                className="bg-sky-500 h-full transition-all duration-100" 
                style={{ width: `${(currentTick / Math.max(1, totalTicks)) * 100}%` }}
              ></div>
            </div>
            <span className="text-[9px] text-sky-400 font-mono">
              SZ: {importedFileBytes ? `${importedFileBytes.length.toLocaleString()} B` : 'Preset'}
            </span>
          </div>
        </div>

        {/* GRID DISPLAY: WAVES & REGISTER DIAGRAM */}
        <div className="grid grid-cols-2 gap-3.5">
          {/* Left Panel: Real-time Oscilloscope */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-sky-400 font-bold uppercase">Phosphor Oscilloscope:</label>
            <div className="border border-sky-850 h-28 rounded overflow-hidden">
              <canvas 
                ref={canvasRef} 
                width={200} 
                height={110} 
                className="w-full h-full block"
              />
            </div>
          </div>

          {/* Right Panel: Active Registers / tracker panel */}
          <div className="flex flex-col gap-1 bg-slate-950/60 p-2 border border-slate-850 rounded text-[9.5px]">
            <span className="text-sky-400 text-[9px] font-bold uppercase mb-1 block">
              {playerMode === 'mod' ? 'Tracker Frame Monitor:' : 'Active HW Registers:'}
            </span>
            {playerMode === 'mod' ? (
              <div className="flex flex-col gap-1.5 leading-tight">
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-1">
                  <span className="font-bold text-amber-500">ROW POSITION:</span>
                  <span className="text-white">Row {modRow.current} / Order {modPatternOrderIdx.current}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-1">
                  <span className="font-bold text-emerald-500">VOICES 1 &amp; 2 PERIOD:</span>
                  <span className="text-white">
                    {activeChannelPeriods.current[0] || '---'} | {activeChannelPeriods.current[1] || '---'}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-1">
                  <span className="font-bold text-sky-400">VOICES 3 &amp; 4 PERIOD:</span>
                  <span className="text-white">
                    {activeChannelPeriods.current[2] || '---'} | {activeChannelPeriods.current[3] || '---'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-rose-500">SPEED &amp; TEMPO:</span>
                  <span className="text-rose-400">Speed {modSpeed.current} | BPM {modBpm.current}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-1">
                  <span className="font-bold text-amber-500">VOICE A (Tone):</span>
                  <span>{freqA}Hz | Amp: {volA}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-1">
                  <span className="font-bold text-emerald-500">VOICE B (Tone):</span>
                  <span>{freqB}Hz | Amp: {volB}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-1">
                  <span className="font-bold text-indigo-400">VOICE C (Bass):</span>
                  <span>{freqC}Hz | Amp: {volC}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-rose-500">PERCUSSION ROUTE:</span>
                  <span>Clock: {playerMode === 'ym' ? `${Math.round(currentYmRecord.current?.masterClock || 2000000 / 1000000)}MHz` : '2MHz'} | Noise</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CHANNEL MONITOR & MUTES */}
        <div className="flex justify-around items-center bg-slate-950 p-2.5 rounded border border-slate-900/80">
          <button 
            onClick={() => setMuteA(!muteA)}
            className={`px-3 py-1 text-gem-tiny border font-bold transition rounded-sm ${
              muteA ? 'bg-red-950 text-red-500 border-red-900' : 'bg-slate-900 text-amber-400 border-amber-800 hover:bg-slate-850'
            }`}
          >
            {muteA ? '🔇 CH 1 MUTE' : '🔊 CHANNEL 1'}
          </button>
          
          <button 
            onClick={() => setMuteB(!muteB)}
            className={`px-3 py-1 text-gem-tiny border font-bold transition rounded-sm ${
              muteB ? 'bg-red-950 text-red-500 border-red-900' : 'bg-slate-900 text-emerald-400 border-emerald-800 hover:bg-slate-850'
            }`}
          >
            {muteB ? '🔇 CH 2 MUTE' : '🔊 CHANNEL 2'}
          </button>

          <button 
            onClick={() => setMuteC(!muteC)}
            className={`px-3 py-1 text-gem-tiny border font-bold transition rounded-sm ${
              muteC ? 'bg-red-950 text-red-500 border-red-900' : 'bg-slate-900 text-sky-400 border-sky-800 hover:bg-slate-850'
            }`}
          >
            {muteC ? '🔇 CH 3 MUTE' : '🔊 CHANNEL 3'}
          </button>
        </div>

        {/* SOUNDBOARD TRIGGER EFFECTS */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] text-[#22c55e] font-bold uppercase">PSG Retro Effects Soundboard:</label>
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => playSfx('boot')}
              className="bg-slate-850 border border-slate-700 hover:bg-slate-700 text-white font-bold p-1.5 text-[10px] rounded active:translate-y-0.5"
            >
              🎹 BOOT CHIRP
            </button>
            <button
              onClick={() => playSfx('laser')}
              className="bg-slate-850 border border-slate-700 hover:bg-slate-700 text-white font-bold p-1.5 text-[10px] rounded active:translate-y-0.5"
            >
              🚀 ATARI LASER
            </button>
            <button
              onClick={() => playSfx('infect')}
              className="bg-rose-950 border border-rose-900 hover:bg-rose-900 text-rose-300 font-bold p-1.5 text-[10px] rounded active:translate-y-0.5"
            >
              💀 VIRUS SWEEP
            </button>
            <button
              onClick={() => playSfx('disinfect')}
              className="bg-emerald-950 border border-emerald-900 hover:bg-emerald-900 text-emerald-300 font-bold p-1.5 text-[10px] rounded active:translate-y-0.5"
            >
              🛡️ AV ANTIDOTE
            </button>
          </div>
        </div>

        {/* DEMOSCENE BUILTIN TRACK TRACKS PLAYLIST */}
        <div className="flex flex-col gap-1.5 border-t border-sky-950 pt-3">
          <label className="text-[9px] text-sky-400 font-bold uppercase">Select Demoscene Presets Tracks (PSG Synth):</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => playPreset('cuddly')}
              className="border border-sky-900/50 bg-slate-950 hover:bg-sky-900/30 text-sky-200 font-bold text-[9.5px] p-2 leading-tight text-center rounded transition"
            >
              💼 CUDDLY DEMOS
              <span className="text-[7.5px] block font-normal text-gray-500 mt-0.5">by Jochen Hippel</span>
            </button>
            
            <button
              onClick={() => playPreset('union')}
              className="border border-sky-900/50 bg-slate-950 hover:bg-sky-900/30 text-sky-200 font-bold text-[9.5px] p-2 leading-tight text-center rounded transition"
            >
              🏰 THE UNION DEMO
              <span className="text-[7.5px] block font-normal text-gray-500 mt-0.5">by Big Alec</span>
            </button>

            <button
              onClick={() => playPreset('enchanted')}
              className="border border-sky-900/50 bg-slate-950 hover:bg-sky-900/30 text-sky-200 font-bold text-[9.5px] p-2 leading-tight text-center rounded transition"
            >
              🧚 ENCHANTED LAND
              <span className="text-[7.5px] block font-normal text-gray-500 mt-0.5">by Dave Rogers</span>
            </button>
          </div>
        </div>

        {/* BOTTOM ACTION BUTTONS LOAD FLOPPY AUDIO */}
        <div className="flex gap-2.5 mt-1 border-t border-sky-950 pt-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleLocalFileChoose}
            accept=".ym,.mod,.mym,.snd"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-grow border border-emerald-700 bg-emerald-950/40 hover:bg-emerald-950/70 text-emerald-300 font-bold py-1.5 px-3 rounded text-gem-small transition uppercase"
          >
            📂 LOAD CHIPTUNE...
          </button>
          
          <button
            onClick={handleTogglePlay}
            className={`w-32 py-1.5 px-3 border font-bold rounded text-gem-small transition uppercase ${
              isPlaying ? 'border-amber-700 bg-amber-950/40 text-amber-300 hover:bg-amber-950/70' : 'border-sky-700 bg-sky-950/40 text-sky-300 hover:bg-sky-950/70'
            }`}
          >
            {isPlaying ? '⏸️ PAUSE' : '▶️ PLAY'}
          </button>
        </div>

      </div>
    </GEMSkeletalWindow>
  );
}
