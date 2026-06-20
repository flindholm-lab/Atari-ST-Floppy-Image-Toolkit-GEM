/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import {
  NavigationMode,
  DiskFileInfo,
  PendingFileAdd,
  PendingDirAdd,
  PendingDelete,
  ArchiveVault,
  ArchiveContext,
  DiskGeometry,
  FloppyDisk,
} from './types';
import {
  detectPackerSignature,
  bytesToString,
  stringToBytes,
  formatSizeBytes,
  dateTimeToFatTime,
  dateTimeToFatDate,
  readFAT12Entry,
  writeFAT12EntryAllCopies,
  getClusterChain,
  getDiskDirEntries,
  decompressMSA,
  isGeometryCompliant,
  discoverDirectoryContent,
  optimizeDiskImage,
  scoreDirectoryAtOffset,
  scoreDirectory,
  deduceGeometryForRootOffset,
} from './utils/diskUtils';
import GEMSkeletalWindow from './components/GEMSkeletalWindow';
import DiskInfoPanel from './components/DiskInfoPanel';
import FileViewerWindow from './components/FileViewerWindow';
import GEMAlertDialog from './components/GEMAlertDialog';
import ROMSplitterWindow from './components/ROMSplitterWindow';
import ROMMergerWindow from './components/ROMMergerWindow';
import { identifyROM } from './utils/romUtils';
import { scanLoadedDisk } from './utils/virusScanner';
import VirusScannerWindow from './components/VirusScannerWindow';
import SectorEditorWindow from './components/SectorEditorWindow';
import SoundPlayerWindow from './components/SoundPlayerWindow';
import BootBlockCreatorWindow from './components/BootBlockCreatorWindow';
import DepackWindow from './components/DepackWindow';
import AtariSTEmulatorWindow from './components/AtariSTEmulatorWindow';

function uint8ArrayToBase64(arr: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0xffff; // 65535 is safe for call stack size
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, chunk as any));
  }
  return window.btoa(chunks.join(''));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

const defaultGeometry: DiskGeometry = {
  bytesPerSector: 512,
  sectorsPerCluster: 2,
  reservedSectors: 1,
  numFats: 2,
  rootDirEntries: 112,
  totalSectors: 1440,
  sectorsPerFat: 3,
  singleFatSize: 3 * 512,
  fatTableStart: 512,
  fatTableSize: 2 * 3 * 512,
  rootDirStart: 512 + 2 * 3 * 512,
  rootDirSectors: 7, // Math.floor(((112 * 32) + 511) / 512)
  dataAreaStart: 512 + 2 * 3 * 512 + 7 * 512,
  bytesPerCluster: 2 * 512,
};

export default function App() {
  // DISK IMAGE ENGINE STATES
  const [loadedDiskBytes, setLoadedDiskBytes] = useState<Uint8Array | null>(null);
  const [currentImageName, setCurrentImageName] = useState('empty720kb.st');
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [clusterHistory, setClusterHistory] = useState<number[]>([0]);
  const [geometry, setGeometry] = useState<DiskGeometry>(defaultGeometry);

  const [expertMode, setExpertMode] = useState<boolean>(() => {
    return localStorage.getItem('gem_expert_mode') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('gem_expert_mode', expertMode ? 'true' : 'false');
  }, [expertMode]);

  const [manualDepack, setManualDepack] = useState<boolean>(() => {
    return localStorage.getItem('gem_manual_depack') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('gem_manual_depack', manualDepack ? 'true' : 'false');
  }, [manualDepack]);

  const [singleFloppyMode, setSingleFloppyMode] = useState<boolean>(() => {
    return localStorage.getItem('gem_single_floppy_mode') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('gem_single_floppy_mode', singleFloppyMode ? 'true' : 'false');
  }, [singleFloppyMode]);

  const handleSingleFloppyModeToggle = (checked: boolean) => {
    setSingleFloppyMode(checked);
    if (checked && floppyDisks.length > 1) {
      const activeDisk = floppyDisks.find((d) => d.id === activeDiskId) || floppyDisks[0];
      if (activeDisk) {
        setFloppyDisks([activeDisk]);
        selectActiveDisk(activeDisk.id, [activeDisk]);
      }
    }
  };

  // STAGING ACCUMULATIVE QUEUES
  const [pendingAdds, setPendingAdds] = useState<PendingFileAdd[]>([]);
  const [pendingDirs, setPendingDirs] = useState<PendingDirAdd[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([]);
  const [pendingDirsToDelete, setPendingDirsToDelete] = useState<PendingDelete[]>([]);

  // ARCHIVE NAVIGATION STATES
  const [navigationMode, setNavigationMode] = useState<NavigationMode>('disk');
  const [archiveContext, setArchiveContext] = useState<ArchiveContext | null>(null);
  const [archiveVaults, setArchiveVaults] = useState<Map<number, ArchiveVault>>(new Map());
  const [nextArchiveVaultId, setNextArchiveVaultId] = useState(1);

  // SECTOR WORKSPACE SELECTIONS & VISUAL CUES
  const [selectedDrive, setSelectedDrive] = useState<'A' | 'C' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeWindowId, setActiveWindowId] = useState<string | null>('manager');
  const [hoveredCluster, setHoveredCluster] = useState<number | null>(null);
  const [highlightedClusters, setHighlightedClusters] = useState<number[]>([]);
  const [sectorEditorNum, setSectorEditorNum] = useState<number>(0);

  // MOBILE LAUNCH & ADAPTIVITY VIEWPORTS
  const [mobileMode, setMobileMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('gem_mobile_mode');
    if (saved !== null) return saved === 'true';
    return false;
  });

  const [saveWorkbench, setSaveWorkbench] = useState<boolean>(() => {
    return localStorage.getItem('gem_save_workbench') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('gem_save_workbench', saveWorkbench ? 'true' : 'false');
  }, [saveWorkbench]);

  useEffect(() => {
    const saved = localStorage.getItem('gem_mobile_mode');
    const isNarrow = saved !== null ? saved === 'true' : window.innerWidth < 768;
    setMobileMode(isNarrow);
    (window as any).GEM_MOBILE_OVERRIDE = isNarrow;
    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('gem-mobile-toggle', { detail: { mobileMode: isNarrow } }));
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleMobileModeToggle = (checked: boolean) => {
    setMobileMode(checked);
    localStorage.setItem('gem_mobile_mode', checked ? 'true' : 'false');
    (window as any).GEM_MOBILE_OVERRIDE = checked;
    window.dispatchEvent(new CustomEvent('gem-mobile-toggle', { detail: { mobileMode: checked } }));
  };

  // SYSTEM MODALS, PREVIEWS & DIALOGS
  const [openedWindows, setOpenedWindows] = useState({
    manager: true,
    diskinfo: true,
    viewer: false,
    splitter: false,
    merger: false,
    harddrive: false,
    virusscanner: false,
    sectoreditor: false,
    bootblockcreator: false,
    sound: false,
    depacker: false,
    emulator: false,
  });

  const [depackFileName, setDepackFileName] = useState<string>('');
  const [depackBytes, setDepackBytes] = useState<Uint8Array | null>(null);

  // MULTIPLE FLOPPY DISKS ENGINE
  const [floppyDisks, setFloppyDisks] = useState<FloppyDisk[]>([]);
  const [activeDiskId, setActiveDiskId] = useState<string | null>(null);
  const [copyModalFile, setCopyModalFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);

  // TOS ROM TOOLKIT STATES
  const [activeROM, setActiveROM] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [presetMergeParts, setPresetMergeParts] = useState<{ name: string; data: Uint8Array }[]>([]);
  const romFileInputRef = useRef<HTMLInputElement | null>(null);
  const soundLocalFileInputRef = useRef<HTMLInputElement | null>(null);
  const workbenchRestoredRef = useRef<boolean>(false);

  const saveWorkbenchToStorage = (disks: FloppyDisk[], activeId: string | null) => {
    try {
      const serializedDisks = disks.map((d) => ({
        id: d.id,
        name: d.name,
        bytesBase64: uint8ArrayToBase64(d.bytes),
        geometry: d.geometry,
        currentPath: d.currentPath,
        clusterHistory: d.clusterHistory,
        pendingAdds: d.pendingAdds,
        pendingDirs: d.pendingDirs,
        pendingDeletes: d.pendingDeletes,
        pendingDirsToDelete: d.pendingDirsToDelete,
      }));
      
      const data = {
        activeId,
        disks: serializedDisks,
        openedWindows,
      };
      
      localStorage.setItem('gem_workbench_data', JSON.stringify(data));
    } catch (err: any) {
      console.error('Failed to save workbench:', err);
    }
  };

  // AUTO SAVE WORKBENCH EFFECT
  useEffect(() => {
    if (!workbenchRestoredRef.current) return;

    const handler = setTimeout(() => {
      if (saveWorkbench) {
        if (floppyDisks.length > 0) {
          saveWorkbenchToStorage(floppyDisks, activeDiskId);
        } else {
          localStorage.removeItem('gem_workbench_data');
        }
      } else {
        localStorage.removeItem('gem_workbench_data');
      }
    }, 250);

    return () => {
      clearTimeout(handler);
    };
  }, [saveWorkbench, floppyDisks, activeDiskId, openedWindows]);

  const handleSoundLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const bytes = new Uint8Array(evt.target.result as ArrayBuffer);
          setSoundPlayFileName(file.name);
          setSoundPlayBytes(bytes);
          setOpenedWindows((p) => ({ ...p, sound: true }));
          setActiveWindowId('sound');
          showToast(`Opened raw local audio file: ${file.name}!`, 'success');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleRomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const bytes = new Uint8Array(evt.target.result as ArrayBuffer);
          setActiveROM({ name: file.name, bytes });
          
          // Focus and show splitter and merger windows
          setOpenedWindows((p) => ({
            ...p,
            splitter: true,
            merger: true,
          }));
          setActiveWindowId('splitter');

          const ident = identifyROM(bytes);
          showToast(`Loaded ROM image: ${file.name} (${ident}). Opened Split and Merge windows.`, 'success');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const [viewingFileName, setViewingFileName] = useState('');
  const [viewingBytes, setViewingBytes] = useState<Uint8Array | null>(null);
  const [soundPlayFileName, setSoundPlayFileName] = useState('');
  const [soundPlayBytes, setSoundPlayBytes] = useState<Uint8Array | null>(null);

  const [dirModalOpen, setDirModalOpen] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [manualOpen, setManualOpen] = useState(false);

  // Promise-driven native Dialog System
  const [dialogConfig, setDialogConfig] = useState<{
    isOpen: boolean;
    type: 'info' | 'success' | 'warn' | 'confirm' | 'prompt';
    title: string;
    message: string | React.ReactNode;
    promptValue?: string;
    onConfirm: (val?: string) => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    type: 'info',
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addFilesRef = useRef<HTMLInputElement | null>(null);
  const explorerDropRef = useRef<HTMLDivElement | null>(null);
  const [dragOverActive, setDragOverActive] = useState(false);

  // INIT & LHA DEPENDENCY INJECTION
  useEffect(() => {
    // Dynamic integration of the classic LHA decompressor dependency
    if (!(window as any).LHA) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/gh/kyz/lha.js@master/lha.js';
      script.async = true;
      document.body.appendChild(script);
    }
    
    // Set up standard responsive template or restore
    const isSaveWorkbench = localStorage.getItem('gem_save_workbench') === 'true';
    let loadedFromWorkbench = false;
    
    if (isSaveWorkbench) {
      try {
        const storedStr = localStorage.getItem('gem_workbench_data');
        if (storedStr) {
          const parsed = JSON.parse(storedStr);
          if (parsed && parsed.disks && parsed.disks.length > 0) {
            const restoredDisks: FloppyDisk[] = parsed.disks.map((d: any) => ({
              id: d.id,
              name: d.name,
              bytes: base64ToUint8Array(d.bytesBase64),
              geometry: d.geometry,
              currentPath: d.currentPath || [],
              clusterHistory: d.clusterHistory || [0],
              pendingAdds: d.pendingAdds || [],
              pendingDirs: d.pendingDirs || [],
              pendingDeletes: d.pendingDeletes || [],
              pendingDirsToDelete: d.pendingDirsToDelete || [],
            }));
            
            setFloppyDisks(restoredDisks);
            const activeId = parsed.activeId || restoredDisks[0].id;
            const activeDisk = restoredDisks.find((d: FloppyDisk) => d.id === activeId) || restoredDisks[0];
            
            setActiveDiskId(activeDisk.id);
            setLoadedDiskBytes(activeDisk.bytes);
            setCurrentImageName(activeDisk.name);
            setGeometry(activeDisk.geometry);
            setCurrentPath(activeDisk.currentPath);
            setClusterHistory(activeDisk.clusterHistory);
            setPendingAdds(activeDisk.pendingAdds);
            setPendingDirs(activeDisk.pendingDirs);
            setPendingDeletes(activeDisk.pendingDeletes);
            setPendingDirsToDelete(activeDisk.pendingDirsToDelete);
            
            if (parsed.openedWindows) {
              setOpenedWindows(parsed.openedWindows);
            }
            loadedFromWorkbench = true;
          }
        }
      } catch (err: any) {
        console.error('Failed to restore workbench:', err);
      }
    }
    
    if (!loadedFromWorkbench) {
      initializeDefaultImage(720);
    }
    workbenchRestoredRef.current = true;
  }, []);

  // MULTIPLE FLOPPY DISKS COMPLEMENTARY LOGIC
  const selectActiveDisk = (id: string, disksList = floppyDisks) => {
    const disk = disksList.find((d) => d.id === id);
    if (!disk) return;

    setActiveDiskId(id);
    setSelectedDrive('A');

    setLoadedDiskBytes(disk.bytes);
    setCurrentImageName(disk.name);
    setGeometry(disk.geometry);
    setCurrentPath(disk.currentPath);
    setClusterHistory(disk.clusterHistory);
    setPendingAdds(disk.pendingAdds);
    setPendingDirs(disk.pendingDirs);
    setPendingDeletes(disk.pendingDeletes);
    setPendingDirsToDelete(disk.pendingDirsToDelete);
  };

  const addFloppyToCollection = (name: string, bytes: Uint8Array, geom: DiskGeometry, clearAllBeforehand = false) => {
    let updatedList = clearAllBeforehand ? [] : [...floppyDisks];
    const isAddingRealCustomDisk = !name.startsWith('empty');
    if (singleFloppyMode) {
      updatedList = [];
    } else if (updatedList.length === 1 && updatedList[0].name.startsWith('empty') && isAddingRealCustomDisk) {
      updatedList = [];
    }

    if (!singleFloppyMode && updatedList.length >= 20) {
      showToast('Maximum limit of 20 loaded floppy disk images reached. Please eject an image first.', 'error');
      return null;
    }

    const newId = 'disk-' + Math.random().toString(36).substring(2, 9);
    const newDisk: FloppyDisk = {
      id: newId,
      name,
      bytes,
      geometry: geom,
      currentPath: [],
      clusterHistory: [0],
      pendingAdds: [],
      pendingDirs: [],
      pendingDeletes: [],
      pendingDirsToDelete: [],
    };

    const nextList = [...updatedList, newDisk];
    setFloppyDisks(nextList);
    setActiveDiskId(newId);

    // Update active state variables
    setLoadedDiskBytes(bytes);
    setCurrentImageName(name);
    setGeometry(geom);
    setCurrentPath([]);
    setClusterHistory([0]);
    setPendingAdds([]);
    setPendingDirs([]);
    setPendingDeletes([]);
    setPendingDirsToDelete([]);

    return newId;
  };

  const ejectFloppyDisk = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    setFloppyDisks((prev) => {
      const filtered = prev.filter((d) => d.id !== id);
      if (activeDiskId === id) {
        if (filtered.length > 0) {
          setTimeout(() => {
            selectActiveDisk(filtered[0].id, filtered);
          }, 0);
        } else {
          // Fallback to avoid empty state: create a new blank template
          setTimeout(() => {
            initializeDefaultImage(720);
          }, 0);
        }
      }
      return filtered;
    });
    showToast('Floppy disk image ejected successfully.', 'success');
  };

  const getFloppyLabel = (disk: FloppyDisk, totalCount: number) => {
    if (disk.name.length > 16) {
      const dotIdx = disk.name.lastIndexOf('.');
      if (dotIdx !== -1 && disk.name.length - dotIdx <= 5) {
        const ext = disk.name.substring(dotIdx);
        const base = disk.name.substring(0, dotIdx);
        const maxBaseLen = 16 - ext.length;
        return base.substring(0, maxBaseLen) + ext;
      }
      return disk.name.substring(0, 16);
    }
    return disk.name;
  };

  const addFileToDiskStream = (
    disk: Uint8Array,
    name: string,
    fileBytes: Uint8Array,
    geom: DiskGeometry,
    parentCluster = 0
  ): Uint8Array => {
    const diskCopy = new Uint8Array(disk);
    const clusNeeded = Math.ceil(fileBytes.length / geom.bytesPerCluster);
    let firstCluster = 0;

    if (clusNeeded > 0) {
      const alloc = findFreeClusterIndices(diskCopy, clusNeeded, geom);
      if (alloc.length < clusNeeded) {
        throw new Error('Target floppy disk storage capacity is exhausted.');
      }
      firstCluster = alloc[0];

      for (let i = 0; i < alloc.length; i++) {
        const cluster = alloc[i];
        const sourceOffset = i * geom.bytesPerCluster;
        const targetOffset = geom.dataAreaStart + (cluster - 2) * geom.bytesPerCluster;
        const lenToCopy = Math.min(geom.bytesPerCluster, fileBytes.length - sourceOffset);
        diskCopy.set(fileBytes.slice(sourceOffset, sourceOffset + lenToCopy), targetOffset);
      }

      for (let i = 0; i < alloc.length; i++) {
        writeFAT12EntryAllCopies(
          diskCopy,
          alloc[i],
          i < alloc.length - 1 ? alloc[i + 1] : 0xfff,
          geom
        );
      }
    }

    const parentEntryPos = findFreeDirectoryEntryOffset(diskCopy, parentCluster, geom);
    if (parentEntryPos === -1) {
      throw new Error('Target root directory table listing is exhausted.');
    }

    // Adapt to 8.3 standard format
    const dotIdx = name.lastIndexOf('.');
    let base = dotIdx !== -1 ? name.substring(0, dotIdx) : name;
    let ext = dotIdx !== -1 ? name.substring(dotIdx + 1) : '';
    
    // Clean characters and uppercase
    base = base.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8).padEnd(8, ' ');
    ext = ext.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 3).padEnd(3, ' ');

    const pEntry = new Uint8Array(32);
    pEntry.set(stringToBytes(base, 8), 0);
    pEntry.set(stringToBytes(ext, 3), 8);
    pEntry[11] = 0x20; // normal file archive marker
    pEntry[26] = firstCluster & 0xff;
    pEntry[27] = (firstCluster >> 8) & 0xff;

    const size = fileBytes.length;
    pEntry[28] = size & 0xff;
    pEntry[29] = (size >> 8) & 0xff;
    pEntry[30] = (size >> 16) & 0xff;
    pEntry[31] = (size >> 24) & 0xff;

    const now = new Date();
    const timeVal = dateTimeToFatTime(now);
    const dateVal = dateTimeToFatDate(now);
    pEntry[22] = timeVal & 0xff;
    pEntry[23] = (timeVal >> 8) & 0xff;
    pEntry[24] = dateVal & 0xff;
    pEntry[25] = (dateVal >> 8) & 0xff;

    diskCopy.set(pEntry, parentEntryPos);
    return diskCopy;
  };

  const lastActiveDiskIdRef = useRef<string | null>(null);

  // MULTIPLE DISKS SYNCHRONIZATION HOOK
  useEffect(() => {
    if (!activeDiskId || !loadedDiskBytes) {
      lastActiveDiskIdRef.current = activeDiskId;
      return;
    }

    // If activeDiskId has changed since the last sync, we are currently switching active disks.
    // We update our ref and exit immediately to prevent overwriting the target disk's state with stale values.
    if (activeDiskId !== lastActiveDiskIdRef.current) {
      lastActiveDiskIdRef.current = activeDiskId;
      return;
    }

    setFloppyDisks((prevDisks) => {
      const idx = prevDisks.findIndex((d) => d.id === activeDiskId);
      if (idx === -1) return prevDisks;
      const target = prevDisks[idx];
      if (
        target.bytes === loadedDiskBytes &&
        target.name === currentImageName &&
        JSON.stringify(target.currentPath) === JSON.stringify(currentPath) &&
        JSON.stringify(target.clusterHistory) === JSON.stringify(clusterHistory) &&
        target.pendingAdds === pendingAdds &&
        target.pendingDirs === pendingDirs &&
        target.pendingDeletes === pendingDeletes &&
        target.pendingDirsToDelete === pendingDirsToDelete
      ) {
        return prevDisks;
      }
      const updated = [...prevDisks];
      updated[idx] = {
        ...target,
        bytes: loadedDiskBytes,
        name: currentImageName,
        geometry,
        currentPath,
        clusterHistory,
        pendingAdds,
        pendingDirs,
        pendingDeletes,
        pendingDirsToDelete,
      };
      return updated;
    });
  }, [
    activeDiskId,
    loadedDiskBytes,
    currentImageName,
    geometry,
    currentPath,
    clusterHistory,
    pendingAdds,
    pendingDirs,
    pendingDeletes,
    pendingDirsToDelete,
  ]);

  const showCustomDialog = (
    title: string,
    message: string | React.ReactNode,
    type: 'info' | 'success' | 'warn' | 'confirm' | 'prompt' = 'info',
    defaultPromptVal = ''
  ): Promise<any> => {
    return new Promise((resolve) => {
      setDialogConfig({
        isOpen: true,
        type,
        title,
        message,
        promptValue: defaultPromptVal,
        onConfirm: (val) => {
          setDialogConfig((prev) => ({ ...prev, isOpen: false }));
          resolve(type === 'prompt' ? val : true);
        },
        onCancel: () => {
          setDialogConfig((prev) => ({ ...prev, isOpen: false }));
          resolve(false);
        },
      });
    });
  };

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    if (expertMode && type !== 'error') {
      console.log(`[ST DISK WORKSPACE] [${type.toUpperCase()}] ${message}`);
      return;
    }
    showCustomDialog(
      type === 'success' ? 'PROCESS SUCCESS' : type === 'error' ? 'ERROR ALERT' : 'SYSTEM DIALOG',
      message,
      type === 'error' ? 'warn' : 'info'
    );
  };

  // INITIALIZE TEMPLATES
  const initializeDefaultImage = (typeSize: number, clearAllBeforehand = false) => {
    let totalSizeBytes = 737280;
    let tracks = 80;
    let sectors = 9;
    let sides = 2;
    let fatSects = 3;
    let rootEntries = 112;
    let mediaDescriptor = 0xf9;

    switch (typeSize) {
      case 360:
        totalSizeBytes = 368640;
        sides = 1;
        fatSects = 2;
        rootEntries = 64;
        mediaDescriptor = 0xf8;
        break;
      case 400:
        totalSizeBytes = 409600;
        sides = 1;
        sectors = 10;
        fatSects = 2;
        rootEntries = 64;
        mediaDescriptor = 0xf8;
        break;
      case 720:
        totalSizeBytes = 737280;
        sides = 2;
        fatSects = 3;
        rootEntries = 112;
        mediaDescriptor = 0xf9;
        break;
      case 800:
        totalSizeBytes = 819200;
        sides = 2;
        sectors = 10;
        fatSects = 3;
        rootEntries = 112;
        mediaDescriptor = 0xf9;
        break;
    }

    const disk = new Uint8Array(totalSizeBytes);
    const view = new DataView(disk.buffer);

    // Write boot sector (sector 0) GEMDOS keys
    view.setUint8(0, 0xe9);
    view.setUint8(1, 0x00);
    view.setUint8(2, 0x54); // T
    view.setUint8(3, 0x4f); // O
    view.setUint8(4, 0x53); // S
    view.setUint8(5, 0x31); // 1
    view.setUint8(6, 0x30); // 0
    view.setUint8(7, 0x32); // 2
    view.setUint8(8, 0x20); // space
    view.setUint8(9, 0x20); // space
    view.setUint16(11, 512, true); // bytes per sector
    view.setUint8(13, 2); // sectors per cluster
    view.setUint16(14, 1, true); // reserved sectors
    view.setUint8(16, 2); // FAT copies
    view.setUint16(17, rootEntries, true);
    view.setUint16(19, tracks * sectors * sides, true);
    view.setUint8(21, mediaDescriptor);
    view.setUint16(22, fatSects, true);
    view.setUint16(24, sectors, true);
    view.setUint16(26, sides, true);

    const fOffset1 = 512;
    const fOffset2 = fOffset1 + fatSects * 512;

    // FAT Header
    disk[fOffset1] = mediaDescriptor;
    disk[fOffset1 + 1] = 0xff;
    disk[fOffset1 + 2] = 0xff;
    disk[fOffset2] = mediaDescriptor;
    disk[fOffset2 + 1] = 0xff;
    disk[fOffset2 + 2] = 0xff;

    // Map physical properties
    const bytesPerSector = 512;
    const sectorsPerCluster = 2;
    const reservedSectors = 1;
    const numFats = 2;
    const rootDirEntries = rootEntries;
    const totalSectors = tracks * sectors * sides;
    const sectorsPerFat = fatSects;

    const singleFatSize = sectorsPerFat * bytesPerSector;
    const fatTableStart = reservedSectors * bytesPerSector;
    const fatTableSize = numFats * singleFatSize;
    const rootDirStart = fatTableStart + fatTableSize;
    const rootDirSectors = Math.floor((rootDirEntries * 32 + (bytesPerSector - 1)) / bytesPerSector);
    const dataAreaStart = rootDirStart + rootDirSectors * bytesPerSector;
    const bytesPerCluster = sectorsPerCluster * bytesPerSector;

    const newGeometry = {
      bytesPerSector,
      sectorsPerCluster,
      reservedSectors,
      numFats,
      rootDirEntries,
      totalSectors,
      sectorsPerFat,
      singleFatSize,
      fatTableStart,
      fatTableSize,
      rootDirStart,
      rootDirSectors,
      dataAreaStart,
      bytesPerCluster,
    };

    addFloppyToCollection(`empty${typeSize}kb.st`, disk, newGeometry, clearAllBeforehand);
  };

  const handleCloseAll = () => {
    setActiveROM(null);
    setPresetMergeParts([]);
    initializeDefaultImage(720, true);
    setOpenedWindows({
      manager: true,
      diskinfo: true,
      viewer: false,
      splitter: false,
      merger: false,
      harddrive: false,
      virusscanner: false,
      sectoreditor: false,
      bootblockcreator: false,
      sound: false,
      depacker: false,
      emulator: false,
    });
    showToast('All loaded ROM states and floppy disk images closed/ejected.', 'success');
  };

  const resetArchiveNavigation = () => {
    setNavigationMode('disk');
    setArchiveContext(null);
    setArchiveVaults(new Map());
  };

  const processRawDiskBytes = (bytes: Uint8Array, fileName: string) => {
    let finalBytes = bytes;
    let msaSectorsPerTrack: number | undefined = undefined;
    let msaSides: number | undefined = undefined;

    if (finalBytes.length >= 10 && finalBytes[0] === 0x0e && finalBytes[1] === 0x0f) {
      try {
        msaSectorsPerTrack = (finalBytes[2] << 8) | finalBytes[3];
        msaSides = ((finalBytes[4] << 8) | finalBytes[5]) + 1;
        // Decompress MSA raw sectors
        finalBytes = decompressMSA(finalBytes);
      } catch (err: any) {
        showToast('Failed to decompress MSA image: ' + err.message, 'error');
        return;
      }
    }

    if (finalBytes.length < 100000) {
      showToast('Uploaded block is too small to be a valid floppy layout.', 'error');
      return;
    }

    // Run custom sliding-window layout correction optimizer
    const optimization = optimizeDiskImage(finalBytes, msaSectorsPerTrack, msaSides);
    const wasDeinterleaved = optimization.wasDeinterleaved;
    finalBytes = optimization.bytes;

    if (wasDeinterleaved) {
      showToast('⚠️ Faked/misaligned Double-Sided container detected! Extracted core Single-Sided contents.', 'info');
    }

    // Check and handle geometry compliance with content-based sliding-window fallback
    let newGeometry;
    if (!isGeometryCompliant(finalBytes)) {
      showToast('⚠️ Non-compliant boot sector discovered! Bypassing BPB using sliding-window content scanner.', 'info');
      const discovery = discoverDirectoryContent(finalBytes);
      
      // Sliding-window scoring verification to check if another scanned location contains actual valid directory content
      const bpbRootDirScore = scoreDirectoryAtOffset(finalBytes, discovery.rootDirStart, discovery.rootDirEntries);
      const bestScanned = discoverDirectoryContent(finalBytes);
      const scannedRootDirScore = scoreDirectoryAtOffset(finalBytes, bestScanned.rootDirStart, bestScanned.rootDirEntries);

      let activeRootDirStart = discovery.rootDirStart;
      let activeRootDirEntries = discovery.rootDirEntries;

      if (scannedRootDirScore > bpbRootDirScore && scannedRootDirScore >= 1) {
        console.log(`[App.tsx Fallback] Corrected root directory offset from ${discovery.rootDirStart} (Score: ${bpbRootDirScore}) to fallback scan offset ${bestScanned.rootDirStart} (Score: ${scannedRootDirScore}).`);
        activeRootDirStart = bestScanned.rootDirStart;
        activeRootDirEntries = bestScanned.rootDirEntries;
      }

      newGeometry = deduceGeometryForRootOffset(finalBytes, activeRootDirStart, activeRootDirEntries);
    } else {
      // Recalculate properties from compliant uploaded boot sector
      const view = new DataView(finalBytes.buffer);
      const bytesPerSector = view.getUint16(11, true) || 512;
      const reservedSectors = view.getUint16(14, true) || 1;
      const numFats = view.getUint8(16) || 2;
      const rootDirEntries = view.getUint16(17, true) || 112;
      const sectorsPerFat = view.getUint16(22, true) || 3;

      const singleFatSize = sectorsPerFat * bytesPerSector;
      const fatTableStart = reservedSectors * bytesPerSector;
      const fatTableSize = numFats * singleFatSize;
      let rootDirStart = fatTableStart + fatTableSize;

      // Sliding-window scoring verification on compliant disks to handle custom structures
      const bpbRootDirScore = scoreDirectoryAtOffset(finalBytes, rootDirStart, rootDirEntries);
      const bestScanned = discoverDirectoryContent(finalBytes);
      const scannedRootDirScore = scoreDirectoryAtOffset(finalBytes, bestScanned.rootDirStart, bestScanned.rootDirEntries);

      let activeRootDirStart = rootDirStart;
      let activeRootDirEntries = rootDirEntries;
      let forceFallback = false;

      if (scannedRootDirScore > bpbRootDirScore && scannedRootDirScore >= 1) {
        console.log(`[App.tsx Compliant] Corrected root directory offset from ${rootDirStart} (Score: ${bpbRootDirScore}) to fallback scan offset ${bestScanned.rootDirStart} (Score: ${scannedRootDirScore}).`);
        activeRootDirStart = bestScanned.rootDirStart;
        activeRootDirEntries = bestScanned.rootDirEntries;
        forceFallback = true;
      }

      newGeometry = deduceGeometryForRootOffset(finalBytes, activeRootDirStart, activeRootDirEntries);
      newGeometry.isFallback = wasDeinterleaved || forceFallback;
    }

    const runId = addFloppyToCollection(fileName, finalBytes, newGeometry);
    if (!runId) return;

    showToast('Floppy disk image workspace synced.', 'success');

    // Floppy scan automatically when loaded if expert mode is disabled
    if (!expertMode) {
      setTimeout(() => {
        const threats = scanLoadedDisk(finalBytes, newGeometry);
        if (threats.length > 0) {
          showToast(`🚨 ATTENTION: Detected ${threats.length} potential virus threats! Running Autopilot disinfectant...`, 'error');
          setOpenedWindows((p) => ({ ...p, virusscanner: true }));
          setActiveWindowId('virusscanner');
        } else {
          showToast('🛡️ Floppy scanned automatically. No viruses found.', 'success');
        }
      }, 500);
    }
  };

  const handleDiskUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = function (evt) {
        if (!evt.target?.result) return;
        const bytes = new Uint8Array(evt.target.result as ArrayBuffer);

        // Check ZIP file signature (PK\x03\x04) or extension
        if ((bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) || file.name.toLowerCase().endsWith('.zip')) {
          showToast(`Processing uploaded ZIP archive "${file.name}"...`, 'info');
          JSZip.loadAsync(bytes).then((zip) => {
            // Find ST or MSA files inside ZIP
            const diskFiles = Object.keys(zip.files).filter(name => name.toLowerCase().endsWith('.st') || name.toLowerCase().endsWith('.msa'));
            if (diskFiles.length === 0) {
              showToast(`No .ST or .MSA disk image found inside ZIP: ${file.name}`, 'error');
              return;
            }
            diskFiles.forEach((diskFile) => {
              zip.files[diskFile].async('uint8array').then((unzippedBytes) => {
                processRawDiskBytes(unzippedBytes, diskFile.split('/').pop() || diskFile);
              }).catch((err) => {
                showToast(`Failed to extract "${diskFile}" from ZIP: ` + err.message, 'error');
              });
            });
          }).catch((err) => {
            showToast(`Failed to parse ZIP archive "${file.name}": ` + err.message, 'error');
          });
          return;
        }

        processRawDiskBytes(bytes, file.name);
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // ARCHIVE ACTIONS
  const isArchiveFilename = (name: string) => {
    const ext = name.split('.').pop()?.toUpperCase() || '';
    return ['ZIP', 'ZOO', 'ARC', 'LZH', 'LHA', 'PAK', 'LZ4', 'LZS'].includes(ext);
  };

  const detectArchiveFormat = (name: string, bytes: Uint8Array): string | null => {
    const ext = name.split('.').pop()?.toUpperCase() || '';
    if (ext === 'ZIP' && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';
    if (['LZH', 'LHA', 'LZ4', 'LZS'].includes(ext) && bytes.length >= 24) return 'lha';
    if (['ARC', 'PAK'].includes(ext) && bytes.length >= 4 && bytes[0] === 0x1a) return 'arc';
    if (ext === 'ZOO' && bytes.length >= 8) {
      const tag = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
      if (tag === 0xfdc4a7dc) return 'zoo';
    }
    return null;
  };

  const normalizeArchivePath = (path: string) => {
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  };

  const splitArchivePath = (path: string) => {
    const norm = normalizeArchivePath(path);
    return norm ? norm.split('/') : [];
  };

  const listArchiveChildren = (vault: ArchiveVault, innerPath: string) => {
    const prefix = innerPath ? normalizeArchivePath(innerPath) + '/' : '';
    const children = new Map<string, any>();

    for (const item of vault.items) {
      const full = normalizeArchivePath(item.path);
      if (prefix && !full.startsWith(prefix)) continue;
      const rest = prefix ? full.slice(prefix.length) : full;
      if (!rest) continue;
      const slash = rest.indexOf('/');
      const childName = slash >= 0 ? rest.slice(0, slash) : rest;
      const childIsDir = slash >= 0 || item.isDir;
      if (!children.has(childName)) {
        children.set(childName, {
          name: childName,
          isDir: childIsDir,
          size: childIsDir ? 0 : item.size,
          fullPath: slash >= 0 ? prefix + childName : full,
          vaultId: vault.id,
        });
      } else if (!childIsDir) {
        const existing = children.get(childName);
        if (!existing.isDir) existing.size = item.size;
      } else {
        children.get(childName).isDir = true;
      }
    }
    return Array.from(children.values()).sort(
      (a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || a.name.localeCompare(b.name)
    );
  };

  const parseArcArchive = (bytes: Uint8Array) => {
    const items: any[] = [];
    let offset = 0;
    while (offset + 20 < bytes.length) {
      if (bytes[offset] !== 0x1a) break;
      const method = bytes[offset + 1];
      const nameLen = bytes[offset + 2];
      if (nameLen === 0 || offset + 3 + nameLen + 12 > bytes.length) break;
      const name = bytesToString(bytes.subarray(offset + 3, offset + 3 + nameLen));
      const hdr = offset + 3 + nameLen;
      const compSize = bytes[hdr] | (bytes[hdr + 1] << 8) | (bytes[hdr + 2] << 16) | (bytes[hdr + 3] << 24);
      const origSize = bytes[hdr + 8] | (bytes[hdr + 9] << 8) | (bytes[hdr + 10] << 16) | (bytes[hdr + 11] << 24);
      const dataOffset = hdr + 12;
      if (method >= 20) break;
      if (dataOffset + compSize > bytes.length) break;
      items.push({
        path: name.replace(/\\/g, '/'),
        isDir: false,
        size: origSize,
        method,
        compSize,
        origSize,
        data: bytes.subarray(dataOffset, dataOffset + compSize),
      });
      offset = dataOffset + compSize;
    }
    return items;
  };

  const decompressArcStored = (entry: any) => {
    if (entry.method === 0) return entry.data.subarray(0, entry.origSize);
    if (entry.method === 1) {
      const out: number[] = [];
      let i = 0;
      while (out.length < entry.origSize && i < entry.data.length) {
        const ctrl = entry.data[i++];
        if (ctrl === 0) {
          if (i < entry.data.length) out.push(entry.data[i++]);
        } else {
          const val = entry.data[i++];
          for (let c = 0; c < ctrl; c++) out.push(val);
        }
      }
      return new Uint8Array(out);
    }
    throw new Error('ARC method ' + entry.method + ' not supported (stored/RLE only)');
  };

  const parseZooArchive = (bytes: Uint8Array) => {
    const tag = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
    if (tag !== 0xfdc4a7dc) throw new Error('Invalid ZOO archive tag');
    const dirOffset = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
    const items: any[] = [];
    let pos = dirOffset;
    let guard = 0;
    while (pos > 0 && pos + 43 < bytes.length && guard++ < 4096) {
      const name = bytesToString(bytes.subarray(pos, pos + 13))
        .replace(/\0.*$/, '')
        .trim();
      const nextDir = bytes[pos + 13] | (bytes[pos + 14] << 8) | (bytes[pos + 15] << 16) | (bytes[pos + 16] << 24);
      const dataOffset = bytes[pos + 17] | (bytes[pos + 18] << 8) | (bytes[pos + 19] << 16) | (bytes[pos + 20] << 24);
      const packType = bytes[pos + 33] | (bytes[pos + 34] << 8);
      const sizeOrg = bytes[pos + 35] | (bytes[pos + 36] << 8) | (bytes[pos + 37] << 16) | (bytes[pos + 38] << 24);
      const sizeNow = bytes[pos + 39] | (bytes[pos + 40] << 8) | (bytes[pos + 41] << 16) | (bytes[pos + 42] << 24);
      if (name) {
        items.push({
          path: name.replace(/\\/g, '/'),
          isDir: false,
          size: sizeOrg >>> 0,
          packType,
          dataOffset,
          sizeNow: sizeNow >>> 0,
          sizeOrg: sizeOrg >>> 0,
        });
      }
      if (nextDir === 0 || nextDir === pos) break;
      pos = nextDir;
    }
    return items;
  };

  const decompressZooEntry = (bytes: Uint8Array, entry: any) => {
    if (entry.packType !== 0 && entry.packType !== 1) {
      throw new Error('ZOO pack type ' + entry.packType + ' not supported');
    }
    const start = entry.dataOffset;
    const len = entry.sizeNow;
    if (start + len > bytes.length) throw new Error('ZOO entry out of bounds');
    const chunk = bytes.subarray(start, start + len);
    if (entry.packType === 0) return chunk.subarray(0, entry.sizeOrg);
    return chunk;
  };

  const buildArchiveVault = async (bytes: Uint8Array, archiveName: string, diskOffset: number | null): Promise<number> => {
    const format = detectArchiveFormat(archiveName, bytes);
    if (!format) throw new Error('Unrecognized archive format');

    const vaultId = nextArchiveVaultId;
    setNextArchiveVaultId((p) => p + 1);

    const vault: ArchiveVault = {
      id: vaultId,
      format,
      sourceName: archiveName,
      sourceOffset: diskOffset,
      rawBytes: bytes,
      items: [],
    };

    if (format === 'zip') {
      const zip = await JSZip.loadAsync(bytes);
      vault.zip = zip;
      const paths: any[] = [];
      zip.forEach((relativePath, file) => paths.push({ relativePath, file }));
      for (const { relativePath, file } of paths) {
        const norm = normalizeArchivePath(relativePath);
        if (!norm) continue;
        vault.items.push({
          path: norm,
          isDir: file.dir || relativePath.endsWith('/'),
          size: (file as any)._data?.uncompressedSize || 0,
          zipPath: relativePath,
        });
      }
    } else if (format === 'lha') {
      const lhaDep = (window as any).LHA;
      if (!lhaDep) throw new Error('LHA decoder dependency is still syncing in container background');
      const entries = lhaDep.read(bytes);
      for (const entry of entries) {
        const isDir = entry.packMethod === '-lhd-';
        vault.items.push({
          path: normalizeArchivePath(entry.name),
          isDir,
          size: entry.length,
          lhaEntry: entry,
        });
      }
    } else if (format === 'arc') {
      vault.arcItems = parseArcArchive(bytes);
      for (const entry of vault.arcItems) {
        vault.items.push({
          path: normalizeArchivePath(entry.path),
          isDir: false,
          size: entry.origSize,
          arcEntry: entry,
        });
      }
    } else if (format === 'zoo') {
      vault.zooItems = parseZooArchive(bytes);
      for (const entry of vault.zooItems) {
        vault.items.push({
          path: normalizeArchivePath(entry.path),
          isDir: false,
          size: entry.sizeOrg,
          zooEntry: entry,
        });
      }
    } else {
      throw new Error(format.toUpperCase() + ' formats are currently unsupported');
    }

    setArchiveVaults((prev) => {
      const copy = new Map(prev);
      copy.set(vaultId, vault);
      return copy;
    });

    return vaultId;
  };

  const openArchiveFromDisk = async (diskOffset: number, archiveName: string) => {
    const bytes = getRawFileBytesFromDisk(diskOffset);
    if (!bytes || bytes.length === 0) {
      showToast('Archive file is empty or corrupted.', 'error');
      return;
    }
    showToast(`Parsing and mounting ${archiveName}...`, 'info');
    try {
      const vaultId = await buildArchiveVault(bytes, archiveName, diskOffset);
      setNavigationMode('archive');
      setArchiveContext({ vaultId, innerPath: '' });
      setCurrentPath((prev) => [...prev, archiveName]);
    } catch (err: any) {
      showToast('Failed to mount archive: ' + err.message, 'error');
    }
  };

  const extractArchiveEntry = async (vaultId: number, entryPath: string): Promise<Uint8Array> => {
    const vault = archiveVaults.get(vaultId);
    if (!vault) throw new Error('Archive session mapping timed out');
    const norm = normalizeArchivePath(entryPath);
    const item = vault.items.find((i) => normalizeArchivePath(i.path) === norm && !i.isDir);
    if (!item) throw new Error('Asset not found inside index map');

    if (vault.format === 'zip') {
      let file = vault.zip.file(item.zipPath) || vault.zip.file(item.path) || vault.zip.file(norm);
      if (!file && !norm.includes('/')) {
        file = vault.zip.file(norm + '/') || vault.zip.file('./' + norm);
      }
      if (!file) throw new Error('ZIP stream extract failed');
      const buf = await file.async('arraybuffer');
      return new Uint8Array(buf);
    }
    if (vault.format === 'lha') {
      const lhaDep = (window as any).LHA;
      if (!item.lhaEntry || !lhaDep) throw new Error('LHA engine mismatch');
      const unpacked = lhaDep.unpack(item.lhaEntry);
      if (!unpacked) throw new Error('Unsupported method compression schema');
      return unpacked;
    }
    if (vault.format === 'arc') {
      return decompressArcStored(item.arcEntry);
    }
    if (vault.format === 'zoo') {
      return decompressZooEntry(vault.rawBytes, item.zooEntry);
    }
    throw new Error('Unsupported unpack method');
  };

  const viewArchiveEntry = async (vaultId: number, entryPath: string) => {
    try {
      const bytes = await extractArchiveEntry(vaultId, entryPath);
      const displayName = entryPath.split('/').pop() || entryPath;
      setViewingFileName(displayName);
      setViewingBytes(bytes);
      setOpenedWindows((p) => ({ ...p, viewer: true }));
      setActiveWindowId('viewer');
    } catch (err: any) {
      showToast('Archive extract failed: ' + err.message, 'error');
    }
  };

  const playArchiveEntry = async (vaultId: number, entryPath: string) => {
    try {
      const bytes = await extractArchiveEntry(vaultId, entryPath);
      const displayName = entryPath.split('/').pop() || entryPath;
      setSoundPlayBytes(bytes);
      setSoundPlayFileName(displayName);
      setOpenedWindows((p) => ({ ...p, sound: true }));
      setActiveWindowId('sound');
      showToast(`Playing from archive: ${displayName}`, 'success');
    } catch (err: any) {
      showToast('Archive play failed: ' + err.message, 'error');
    }
  };

  const saveFileFromArchive = async (vaultId: number, entryPath: string) => {
    try {
      const bytes = await extractArchiveEntry(vaultId, entryPath);
      const defaultFilename = entryPath.split('/').pop() || entryPath;
      const chosenName = await showCustomDialog(
        'Extract File',
        'Enter the filename to save as:',
        'prompt',
        defaultFilename
      );
      if (!chosenName) return; // user cancelled
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = chosenName;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      showToast('Extract failed: ' + err.message, 'error');
    }
  };

  // DIRECT DISK SECTOR EXTRACTS
  const getRawFileBytesFromDisk = (diskOffset: number): Uint8Array | null => {
    if (!loadedDiskBytes) return null;

    const size =
      loadedDiskBytes[diskOffset + 28] |
      (loadedDiskBytes[diskOffset + 29] << 8) |
      (loadedDiskBytes[diskOffset + 30] << 16) |
      (loadedDiskBytes[diskOffset + 31] << 24);
    const startCluster = loadedDiskBytes[diskOffset + 26] | (loadedDiskBytes[diskOffset + 27] << 8);

    const fileBytes = new Uint8Array(size);
    let bytesWritten = 0;

    let chain = getClusterChain(loadedDiskBytes, startCluster, geometry);
    const clusNeeded = Math.ceil(size / geometry.bytesPerCluster);

    // Support undelete reconstruction on contiguous segments if chain is truncated
    if (chain.length < clusNeeded && (loadedDiskBytes[diskOffset] === 0xe5 || loadedDiskBytes[diskOffset] === 0x05)) {
      chain = [];
      for (let i = 0; i < clusNeeded; i++) {
        chain.push(startCluster + i);
      }
    }

    for (let cluster of chain) {
      const offset = geometry.dataAreaStart + (cluster - 2) * geometry.bytesPerCluster;
      const toRead = Math.min(geometry.bytesPerCluster, size - bytesWritten);
      if (offset + toRead <= loadedDiskBytes.length) {
        fileBytes.set(loadedDiskBytes.slice(offset, offset + toRead), bytesWritten);
      }
      bytesWritten += toRead;
    }
    return fileBytes;
  };

  const handleRowNavigation = (name: string, isDir: boolean, status: string, isDeleted: boolean = false) => {
    if (isDeleted) {
      showToast('This directory is currently deleted. Please undelete it first to explore its contents.', 'info');
      return;
    }

    if (status === 'ADDING') {
      showToast('Cannot enter uncommitted directory chains.', 'info');
      return;
    }

    if (navigationMode === 'archive' && archiveContext) {
      const vault = archiveVaults.get(archiveContext.vaultId);
      if (!vault) return;
      const child = listArchiveChildren(vault, archiveContext.innerPath).find((c) => c.name === name);
      if (child && child.isDir) {
        setArchiveContext({
          ...archiveContext,
          innerPath: child.fullPath,
        });
        setCurrentPath((prev) => [...prev, name]);
      }
      return;
    }

    if (!isDir && isArchiveFilename(name)) {
      const currentCluster = clusterHistory[clusterHistory.length - 1];
      const found = getDiskDirEntries(loadedDiskBytes!, currentCluster, geometry).find(
        (e) => !e.isDir && e.name === name
      );
      if (found && found.diskOffset) openArchiveFromDisk(found.diskOffset, found.name);
      return;
    }

    if (!isDir) return;

    const currentCluster = clusterHistory[clusterHistory.length - 1];
    const found = getDiskDirEntries(loadedDiskBytes!, currentCluster, geometry).find(
      (e) => e.isDir && e.name === name
    );
    if (found) {
      setClusterHistory((prev) => [...prev, found.cluster as number]);
      setCurrentPath((prev) => [...prev, name]);
    }
  };

  const navigateBack = () => {
    if (navigationMode === 'archive' && archiveContext) {
      if (archiveContext.innerPath) {
        const parts = splitArchivePath(archiveContext.innerPath);
        parts.pop();
        setArchiveContext({
          ...archiveContext,
          innerPath: parts.join('/'),
        });
        setCurrentPath((prev) => prev.slice(0, -1));
        return;
      }
      setNavigationMode('disk');
      setArchiveContext(null);
      setCurrentPath((prev) => prev.slice(0, -1));
      return;
    }
    if (clusterHistory.length > 1) {
      setClusterHistory((prev) => prev.slice(0, -1));
      setCurrentPath((prev) => prev.slice(0, -1));
    }
  };

  // STAGED WRITES HANDLERS
  const handleFileAddStaged = (files: FileList | null) => {
    if (!files) return;
    const currentCluster = clusterHistory[clusterHistory.length - 1];

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = function (evt) {
        if (!evt.target?.result) return;
        const nameInfo = parseTo83Filename(file.name);
        const fullSani = nameInfo.ext ? `${nameInfo.name}.${nameInfo.ext}` : nameInfo.name;

        // Verify uniqueness in pending Adds
        if (pendingAdds.some((a) => a.name === fullSani && a.parentCluster === currentCluster)) return;

        setPendingAdds((prev) => [
          ...prev,
          {
            name: fullSani,
            name83: nameInfo.name,
            ext83: nameInfo.ext,
            bytes: new Uint8Array(evt.target.result as ArrayBuffer),
            parentCluster: currentCluster,
          },
        ]);
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const removeAddedStagedFile = (name: string) => {
    const currentCluster = clusterHistory[clusterHistory.length - 1];
    setPendingAdds((prev) => prev.filter((a) => !(a.name === name && a.parentCluster === currentCluster)));
  };

  const commitAddDirStaged = () => {
    const saniName = newDirName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
    if (!saniName) {
      showToast('Directory name is invalid.', 'error');
      return;
    }
    const currentCluster = clusterHistory[clusterHistory.length - 1];
    setPendingDirs((prev) => [...prev, { name: saniName, parentCluster: currentCluster }]);
    setNewDirName('');
    setDirModalOpen(false);
  };

  const toggleDeleteState = (diskOffset: number, name: string, isDir: boolean) => {
    const currentCluster = clusterHistory[clusterHistory.length - 1];
    const targetArray = isDir ? pendingDirsToDelete : pendingDeletes;
    const isStaged = targetArray.some((d) => d.diskOffset === diskOffset);

    if (isStaged) {
      if (isDir) {
        setPendingDirsToDelete((p) => p.filter((d) => d.diskOffset !== diskOffset));
      } else {
        setPendingDeletes((p) => p.filter((d) => d.diskOffset !== diskOffset));
      }
    } else {
      const model = { name, diskOffset, parentCluster: currentCluster };
      if (isDir) {
        setPendingDirsToDelete((p) => [...p, model]);
      } else {
        setPendingDeletes((p) => [...p, model]);
      }
    }
  };

  const discardStagedChanges = () => {
    setPendingAdds([]);
    setPendingDirs([]);
    setPendingDeletes([]);
    setPendingDirsToDelete([]);
  };

  // MASTER PHYSICAL BINARY WRITER
  const writeChangesToDisk = () => {
    if (!loadedDiskBytes) return;
    const diskCopy = new Uint8Array(loadedDiskBytes);

    try {
      // 1. Process Deletions
      const allDeletes = [...pendingDeletes, ...pendingDirsToDelete];
      allDeletes.forEach((del) => {
        const startCluster = diskCopy[del.diskOffset + 26] | (diskCopy[del.diskOffset + 27] << 8);
        const firstByte = diskCopy[del.diskOffset];

        // Toggle delete sector flags (GEMDOS rules)
        diskCopy[del.diskOffset] = firstByte === 0xe5 ? 0x05 : 0xe5;

        // Reclaim associated FAT chains
        if (startCluster >= 2) {
          let curr = startCluster;
          let watchdog = 0;
          while (curr >= 2 && curr < 0xff8 && watchdog < 4096) {
            const next = readFAT12Entry(diskCopy, curr, geometry);
            writeFAT12EntryAllCopies(diskCopy, curr, 0x000, geometry);
            curr = next;
            watchdog++;
          }
        }
      });

      // 2. Process Folder Creations
      pendingDirs.forEach((dir) => {
        const freeC = findFreeClusterIndices(diskCopy, 1);
        if (!freeC.length) throw new Error('Floppy storage capacity exhausted.');
        const newCluster = freeC[0];

        const parentEntryPos = findFreeDirectoryEntryOffset(diskCopy, dir.parentCluster);
        if (parentEntryPos === -1) throw new Error('Directory Allocation Limit reached.');

        const sectorOffset = geometry.dataAreaStart + (newCluster - 2) * geometry.bytesPerCluster;
        diskCopy.fill(0x00, sectorOffset, sectorOffset + geometry.bytesPerCluster);

        const now = new Date();
        const timeVal = dateTimeToFatTime(now);
        const dateVal = dateTimeToFatDate(now);

        // Dot folder (.) record definitions
        const dot = new Uint8Array(32);
        dot.set(stringToBytes('.', 8), 0);
        dot.set(stringToBytes('', 3), 8);
        dot[11] = 0x10;
        dot[26] = newCluster & 0xff;
        dot[27] = (newCluster >> 8) & 0xff;
        dot[22] = timeVal & 0xff;
        dot[23] = (timeVal >> 8) & 0xff;
        dot[24] = dateVal & 0xff;
        dot[25] = (dateVal >> 8) & 0xff;
        diskCopy.set(dot, sectorOffset);

        // Dotdot folder (..) record definitions
        const dotdot = new Uint8Array(32);
        dotdot.set(stringToBytes('..', 8), 0);
        dotdot.set(stringToBytes('', 3), 8);
        dotdot[11] = 0x10;
        dotdot[26] = dir.parentCluster & 0xff;
        dotdot[27] = (dir.parentCluster >> 8) & 0xff;
        dotdot[22] = timeVal & 0xff;
        dotdot[23] = (timeVal >> 8) & 0xff;
        dotdot[24] = dateVal & 0xff;
        dotdot[25] = (dateVal >> 8) & 0xff;
        diskCopy.set(dotdot, sectorOffset + 32);

        writeFAT12EntryAllCopies(diskCopy, newCluster, 0xfff, geometry);

        // Parent table registration
        const pEntry = new Uint8Array(32);
        pEntry.set(stringToBytes(dir.name, 8), 0);
        pEntry.set(stringToBytes('', 3), 8);
        pEntry[11] = 0x10;
        pEntry[26] = newCluster & 0xff;
        pEntry[27] = (newCluster >> 8) & 0xff;
        pEntry[22] = timeVal & 0xff;
        pEntry[23] = (timeVal >> 8) & 0xff;
        pEntry[24] = dateVal & 0xff;
        pEntry[25] = (dateVal >> 8) & 0xff;
        diskCopy.set(pEntry, parentEntryPos);
      });

      // 3. Process Staged File Additions
      pendingAdds.forEach((file) => {
        const clusNeeded = Math.ceil(file.bytes.length / geometry.bytesPerCluster);
        let firstCluster = 0;
        if (clusNeeded > 0) {
          const alloc = findFreeClusterIndices(diskCopy, clusNeeded);
          if (alloc.length < clusNeeded) throw new Error('Floppy storage capacity exhausted.');
          firstCluster = alloc[0];

          for (let i = 0; i < alloc.length; i++) {
            const cluster = alloc[i];
            const sourceOffset = i * geometry.bytesPerCluster;
            const targetOffset = geometry.dataAreaStart + (cluster - 2) * geometry.bytesPerCluster;
            const lenToCopy = Math.min(geometry.bytesPerCluster, file.bytes.length - sourceOffset);
            diskCopy.set(file.bytes.slice(sourceOffset, sourceOffset + lenToCopy), targetOffset);
          }

          for (let i = 0; i < alloc.length; i++) {
            writeFAT12EntryAllCopies(
              diskCopy,
              alloc[i],
              i < alloc.length - 1 ? alloc[i + 1] : 0xfff,
              geometry
            );
          }
        }

        const parentEntryPos = findFreeDirectoryEntryOffset(diskCopy, file.parentCluster);
        if (parentEntryPos === -1) throw new Error('Parent table listing exhausted.');

        const pEntry = new Uint8Array(32);
        pEntry.set(stringToBytes(file.name83, 8), 0);
        pEntry.set(stringToBytes(file.ext83, 3), 8);
        pEntry[11] = 0x20;
        pEntry[26] = firstCluster & 0xff;
        pEntry[27] = (firstCluster >> 8) & 0xff;

        const size = file.bytes.length;
        pEntry[28] = size & 0xff;
        pEntry[29] = (size >> 8) & 0xff;
        pEntry[30] = (size >> 16) & 0xff;
        pEntry[31] = (size >> 24) & 0xff;

        const now = new Date();
        const timeVal = dateTimeToFatTime(now);
        const dateVal = dateTimeToFatDate(now);
        pEntry[22] = timeVal & 0xff;
        pEntry[23] = (timeVal >> 8) & 0xff;
        pEntry[24] = dateVal & 0xff;
        pEntry[25] = (dateVal >> 8) & 0xff;

        diskCopy.set(pEntry, parentEntryPos);
      });

      setLoadedDiskBytes(diskCopy);
      setPendingAdds([]);
      setPendingDirs([]);
      setPendingDeletes([]);
      setPendingDirsToDelete([]);
      setClusterHistory([0]);
      setCurrentPath([]);
      resetArchiveNavigation();
      showToast('Floppy visual partitions synced & written.', 'success');
    } catch (err: any) {
      showToast(`Write error: ${err.message}`, 'error');
    }
  };

  const findFreeClusterIndices = (buf: Uint8Array, count: number, geom = geometry): number[] => {
    const freeClusters: number[] = [];
    const totalC = Math.floor((buf.length - geom.dataAreaStart) / geom.bytesPerCluster);
    for (let c = 2; c <= totalC + 1; c++) {
      if (readFAT12Entry(buf, c, geom) === 0x000) {
        freeClusters.push(c);
        if (freeClusters.length === count) break;
      }
    }
    return freeClusters;
  };

  const findFreeDirectoryEntryOffset = (buf: Uint8Array, dirCluster: number, geom = geometry): number => {
    const segments: { offset: number; size: number }[] = [];
    if (dirCluster === 0) {
      segments.push({ offset: geom.rootDirStart, size: geom.rootDirEntries * 32 });
    } else {
      let curr = dirCluster;
      let watchdog = 0;
      while (curr >= 2 && curr < 0xff8 && watchdog < 4096) {
        segments.push({
          offset: geom.dataAreaStart + (curr - 2) * geom.bytesPerCluster,
          size: geom.bytesPerCluster,
        });
        curr = readFAT12Entry(buf, curr, geom);
        watchdog++;
      }
    }
    for (let seg of segments) {
      for (let offset = seg.offset; offset < seg.offset + seg.size; offset += 32) {
        if (buf[offset] === 0x00 || buf[offset] === 0xe5) return offset;
      }
    }
    return -1;
  };

  const parseTo83Filename = (fullFilename: string) => {
    const parts = fullFilename.split('.');
    const namePart = (parts[0] || 'NONAME')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, 8);
    const extPart = (parts[1] || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, 3);
    return { name: namePart, ext: extPart };
  };

  // OEM ID AND BOOT SECTOR CONTROLS
  const onSetOemId = (oem: string) => {
    if (!loadedDiskBytes) return;
    const updateBytes = new Uint8Array(loadedDiskBytes);
    const padded = oem.toUpperCase().padEnd(8, ' ');
    for (let i = 0; i < 8; i++) {
      updateBytes[2 + i] = padded.charCodeAt(i);
    }
    setLoadedDiskBytes(updateBytes);
    showToast('OEM ID metadata altered in floppy buffer.', 'success');
  };

  const makeDiskBootable = () => {
    if (!loadedDiskBytes) return;
    const disk = new Uint8Array(loadedDiskBytes);

    // Apply standard zero sum word matching code rules (0x1234 sum over sector 0)
    disk[510] = 0;
    disk[511] = 0;

    let currentSum = 0;
    for (let i = 0; i < 510; i += 2) {
      const wordValue = (disk[i] << 8) | disk[i + 1];
      currentSum = (currentSum + wordValue) & 0xffff;
    }

    const targetWord = (0x1234 - currentSum) & 0xffff;
    disk[510] = (targetWord >> 8) & 0xff;
    disk[511] = targetWord & 0xff;

    setLoadedDiskBytes(disk);
    showToast('Boot sector checksum matching standard 0x1234. Fixed successfully!', 'success');
  };

  const viewBootSector = () => {
    if (!loadedDiskBytes) return;
    const bootBytes = loadedDiskBytes.slice(0, 512);
    setViewingFileName('BOOT SECTOR (SECTOR 0)');
    setViewingBytes(bootBytes);
    setOpenedWindows((p) => ({ ...p, viewer: true }));
    setActiveWindowId('viewer');
  };

  const handleClusterClick = (clusterNum: number) => {
    if (!loadedDiskBytes) return;
    const sectorOffset = geometry.dataAreaStart + (clusterNum - 2) * geometry.bytesPerCluster;
    const startSector = Math.floor(sectorOffset / geometry.bytesPerSector);
    setSectorEditorNum(startSector);
    setOpenedWindows((p) => ({ ...p, sectoreditor: true }));
    setActiveWindowId('sectoreditor');
    showToast(`Jumped to Sector ${startSector} (Start of Cluster ${clusterNum})!`, 'info');
  };

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
    if (e.dataTransfer?.files) {
      handleFileAddStaged(e.dataTransfer.files);
    }
  };

  // ROW HOVER CHAIN TRACKING
  const handleRowMouseEnter = (cluster: number | string) => {
    if (typeof cluster !== 'number' || cluster < 2) return;
    const chain = getClusterChain(loadedDiskBytes!, cluster, geometry);
    setHighlightedClusters(chain);
  };

  const handleRowMouseLeave = () => {
    setHighlightedClusters([]);
  };

  // ZIP MASS GENERATION EXTRACTOR
  const downloadAllAsZip = async () => {
    if (!loadedDiskBytes) {
      showToast('No active floppy image found to pack.', 'error');
      return;
    }
    showToast('Parsing image and structuring Zip index...', 'info');

    try {
      const zip = new JSZip();

      const traverseAndZip = (currentCluster: number, zipFolder: JSZip) => {
        const entries = getDiskDirEntries(loadedDiskBytes, currentCluster, geometry);
        for (const ent of entries) {
          if (ent.isDeleted) continue;
          if (ent.name === '.' || ent.name === '..') continue;

          if (ent.isDir) {
            const nested = zipFolder.folder(ent.name);
            if (nested) traverseAndZip(ent.cluster as number, nested);
          } else if (ent.diskOffset) {
            const fileBytes = getRawFileBytesFromDisk(ent.diskOffset);
            if (fileBytes) zipFolder.file(ent.name, fileBytes);
          }
        }
      };

      traverseAndZip(0, zip);
      const content = await zip.generateAsync({ type: 'blob' });
      const downloadName = currentImageName.replace(/\.[^/.]+$/, '') + '.zip';

      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = downloadName;
      link.click();
      showToast('Floppy content successfully structured and downloaded as ZIP.', 'success');
    } catch (err: any) {
      showToast('Zipping error: ' + err.message, 'error');
    }
  };

  // SAVE PHYSICAL IMAGE FILES (.ST AND .MSA)
  const saveDiskImageST = () => {
    if (!loadedDiskBytes) return;
    const blob = new Blob([loadedDiskBytes], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = currentImageName;
    link.click();
  };

  const saveDiskImageMSA = () => {
    if (!loadedDiskBytes) return;
    showToast('Compressing track sectors to MSA format...', 'info');

    const sectors = geometry.sectorsPerCluster === 2 ? 9 : 10;
    const totalSect = loadedDiskBytes.length / 512;
    const sides = geometry.sectorsPerFat === 3 ? 2 : 1;
    const tracks = Math.floor(totalSect / (sectors * sides)) || 80;
    const bytesPerTrack = sectors * 512;

    const outChunks: Uint8Array[] = [];

    // MSA header structure
    const header = new Uint8Array(10);
    header[0] = 0x0e;
    header[1] = 0x0f;
    header[3] = sectors;
    header[5] = sides - 1;
    header[9] = tracks - 1;
    outChunks.push(header);

    const compressTrackMSA = (trackBytes: Uint8Array): Uint8Array => {
      const out: number[] = [];
      let i = 0;
      while (i < trackBytes.length) {
        let val = trackBytes[i];
        let run = 1;
        while (i + run < trackBytes.length && trackBytes[i + run] === val && run < 65535) {
          run++;
        }
        if (val === 0xe5 || run >= 4) {
          out.push(0xe5);
          out.push(val);
          out.push((run >> 8) & 0xff);
          out.push(run & 0xff);
          i += run;
        } else {
          for (let r = 0; r < run; r++) out.push(val);
          i += run;
        }
      }
      return new Uint8Array(out);
    };

    for (let t = 0; t < tracks; t++) {
      for (let s = 0; s < sides; s++) {
        const offset = (t * sides + s) * bytesPerTrack;
        if (offset + bytesPerTrack > loadedDiskBytes.length) break;

        const trackData = loadedDiskBytes.subarray(offset, offset + bytesPerTrack);
        const compData = compressTrackMSA(trackData);

        const lenBytes = new Uint8Array(2);
        if (compData.length >= bytesPerTrack) {
          lenBytes[0] = (bytesPerTrack >> 8) & 0xff;
          lenBytes[1] = bytesPerTrack & 0xff;
          outChunks.push(lenBytes);
          outChunks.push(trackData);
        } else {
          lenBytes[0] = (compData.length >> 8) & 0xff;
          lenBytes[1] = compData.length & 0xff;
          outChunks.push(lenBytes);
          outChunks.push(compData);
        }
      }
    }

    const totalLength = outChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const finalBytes = new Uint8Array(totalLength);
    let writePtr = 0;
    for (const chunk of outChunks) {
      finalBytes.set(chunk, writePtr);
      writePtr += chunk.length;
    }

    const blob = new Blob([finalBytes], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = currentImageName.replace(/\.[^/.]+$/, '') + '.msa';
    link.click();
    showToast('.MSA floppy archive exported successfully.', 'success');
  };

  // UNDELETE UTILITY RECONSTRUCTION
  const undeleteFile = async (diskOffset: number, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!loadedDiskBytes) return;

    const marker = loadedDiskBytes[diskOffset];
    if (marker !== 0xe5 && marker !== 0x05) {
      showToast('This directory slot is not marked with an active E5 flag.', 'error');
      return;
    }

    const size =
      loadedDiskBytes[diskOffset + 28] |
      (loadedDiskBytes[diskOffset + 29] << 8) |
      (loadedDiskBytes[diskOffset + 30] << 16) |
      (loadedDiskBytes[diskOffset + 31] << 24);
    const startCluster = loadedDiskBytes[diskOffset + 26] | (loadedDiskBytes[diskOffset + 27] << 8);

    if (startCluster < 2 && size > 0) {
      showToast('Reconstruction failed: cluster starting block was recycled.', 'error');
      return;
    }

    const clusNeeded = size > 0 ? Math.ceil(size / geometry.bytesPerCluster) : 0;
    const defaultChar = marker === 0x05 ? 'E' : currentName.charAt(0).toUpperCase() || 'A';

    if (clusNeeded > 0 && startCluster >= 2) {
      for (let i = 0; i < clusNeeded; i++) {
        const c = startCluster + i;
        const fatVal = readFAT12Entry(loadedDiskBytes, c, geometry);
        if (fatVal !== 0x000) {
          showToast(`Reconstruction failed: Cluster ${c} was recycled (FAT=${fatVal.toString(16)}).`, 'error');
          return;
        }
      }
    }

    const inputName = await showCustomDialog(
      'Undelete Character',
      'Enter raw first character of the filename to restore:',
      'prompt',
      defaultChar
    );

    if (inputName === false) return;
    const firstChar = String(inputName).trim().toUpperCase().substring(0, 1);
    if (!firstChar || !/[A-Z0-9_\$!]/.test(firstChar)) {
      showToast('Alphanumeric selector is required.', 'error');
      return;
    }

    const diskCopy = new Uint8Array(loadedDiskBytes);
    diskCopy[diskOffset] = firstChar.charCodeAt(0);

    if (clusNeeded > 0 && startCluster >= 2) {
      for (let i = 0; i < clusNeeded; i++) {
        const currentC = startCluster + i;
        const nextC = i === clusNeeded - 1 ? 0xfff : currentC + 1;
        writeFAT12EntryAllCopies(diskCopy, currentC, nextC, geometry);
      }
    }

    setLoadedDiskBytes(diskCopy);
    showToast(`Restored file item to name: ${firstChar}${currentName.substring(1)}`, 'success');
  };

  // COMPILE FILE TREE LIST
  let fileList: DiskFileInfo[] = [];
  if (loadedDiskBytes) {
    if (navigationMode === 'archive' && archiveContext) {
      const vault = archiveVaults.get(archiveContext.vaultId);
      if (vault) {
        fileList = listArchiveChildren(vault, archiveContext.innerPath).map((child) => ({
          name: child.name,
          name83: child.name,
          ext83: '',
          size: child.size,
          isDir: child.isDir,
          cluster: vault.format.toUpperCase(),
          diskOffset: null,
          stagedStatus: 'ARCHIVE',
          isDeleted: false,
          isHidden: false,
          vaultId: child.vaultId,
          archivePath: child.fullPath,
        }));
      }
    } else {
      const currentCluster = clusterHistory[clusterHistory.length - 1];
      const realEntries = getDiskDirEntries(loadedDiskBytes, currentCluster, geometry);

      for (const ent of realEntries) {
        const isDeleting =
          pendingDeletes.some((d) => d.diskOffset === ent.diskOffset) ||
          pendingDirsToDelete.some((d) => d.diskOffset === ent.diskOffset);
        const isArchive = !ent.isDir && isArchiveFilename(ent.name);

        fileList.push({
          ...ent,
          isArchive,
          stagedStatus: isDeleting ? 'DELETING' : 'NORMAL',
        });
      }

      // Append Adding Folders
      for (const dir of pendingDirs) {
        if (dir.parentCluster === currentCluster) {
          fileList.push({
            name: dir.name,
            name83: dir.name,
            ext83: '',
            size: 0,
            isDir: true,
            cluster: '[NEW]',
            diskOffset: null,
            stagedStatus: 'ADDING',
            isDeleted: false,
            isHidden: false,
          });
        }
      }

      // Append Adding Files
      for (const file of pendingAdds) {
        if (file.parentCluster === currentCluster) {
          fileList.push({
            name: file.name,
            name83: file.name83,
            ext83: file.ext83,
            size: file.bytes.length,
            isDir: false,
            cluster: '[NEW]',
            diskOffset: null,
            stagedStatus: 'ADDING',
            isDeleted: false,
            isHidden: false,
          });
        }
      }
    }
  }

  // Filter List via Search
  if (searchQuery) {
    fileList = fileList.filter((f) => f.name.toUpperCase().includes(searchQuery.toUpperCase()));
  }

  // Sort: Directories First, alphabetized
  fileList.sort((a, b) => {
    const aNav = a.isDir || a.isArchive;
    const bNav = b.isDir || b.isArchive;
    if (aNav && !bNav) return -1;
    if (!aNav && bNav) return 1;
    return a.name.localeCompare(b.name);
  });

  const hasCommittedWorkNeeded =
    pendingAdds.length > 0 ||
    pendingDirs.length > 0 ||
    pendingDeletes.length > 0 ||
    pendingDirsToDelete.length > 0;

  return (
    <div className="relative flex flex-col justify-between h-screen w-screen overflow-hidden text-gem-normal">
      {/* 1. Global Menu Bar */}
      <div className="bg-white border-b-2 border-black h-8 flex items-center px-4 justify-between z-50 text-gem-large select-none">
        <div className="flex h-full items-stretch">
          {/* Desk Dropdown */}
          <div className="dropdown relative cursor-pointer h-full flex items-stretch">
            <span className="menu-label">Desk</span>
            <div className="dropdown-content left-0 top-8 text-gem-medium">
              <button
                onClick={() =>
                  showCustomDialog(
                    'About Floppy Manager',
                    <span className="block text-gem-normal select-text">
                      Atari ST Floppy Image Toolkit{'\n\n'}
                      Created by Fredrik (Ninjabuffy){'\n\n'}
                      GREETZ to:{' '}
                      <a
                        href="https://www.mug-uk.co.uk"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 hover:text-blue-950 underline font-bold"
                        onClick={(e) => e.stopPropagation()}
                        id="mug-hyperlink"
                      >
                        www.mug-uk.co.uk
                      </a>{' '}
                      for beta testing and improvement ideas.
                    </span>,
                    'info'
                  )
                }
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white"
              >
                About Disk Manager...
              </button>
            </div>
          </div>

          {/* File Dropdown */}
          <div className="dropdown relative cursor-pointer h-full flex items-stretch">
            <span className="menu-label">File</span>
            <div className="dropdown-content left-0 top-8 text-gem-medium">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white hover:bg-black hover:text-white"
              >
                Open Disk Image (.ST / .MSA / .ZIP)...
              </button>
              <button
                onClick={saveDiskImageST}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white"
              >
                Save Disk Image (.ST)
              </button>
              <button
                onClick={saveDiskImageMSA}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white"
              >
                Save Disk Image (.MSA)
              </button>
              <button
                onClick={downloadAllAsZip}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white"
              >
                Download All Content as ZIP
              </button>
              <button
                onClick={() => romFileInputRef.current?.click()}
                className="w-full text-left px-4 py-2 border-b border-black hover:bg-black hover:text-white cursor-pointer bg-white"
              >
                Open TOS ROM Image...
              </button>
              <button
                onClick={handleCloseAll}
                className="w-full text-left px-4 py-2 bg-white hover:bg-black hover:text-white cursor-pointer font-bold text-red-600"
              >
                Close All
              </button>
            </div>
          </div>

          {/* View Dropdown representing the customized PRG/ACC launchers matches state - REMOVED per user request to move them to Hard Disk C icon */}

          {/* Templates Dropdown */}
          <div className="dropdown relative cursor-pointer h-full flex items-stretch">
            <span className="menu-label">Templates</span>
            <div className="dropdown-content left-0 top-8 text-gem-medium">
              <button
                onClick={() => initializeDefaultImage(720)}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white"
              >
                720 KB (Double Sided)
              </button>
              <button
                onClick={() => initializeDefaultImage(360)}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white"
              >
                360 KB (Single Sided)
              </button>
              <button
                onClick={() => initializeDefaultImage(400)}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white"
              >
                400 KB (Single Sided 10S)
              </button>
              <button
                onClick={() => initializeDefaultImage(800)}
                className="w-full text-left px-4 py-2 cursor-pointer bg-white"
              >
                800 KB (Double Sided 10S)
              </button>
            </div>
          </div>

          {/* Settings Dropdown */}
          <div className="dropdown relative cursor-pointer h-full flex items-stretch">
            <span className="menu-label">Settings</span>
            <div className="dropdown-content left-0 top-8 text-gem-medium min-w-[200px]">
              <button
                onClick={() => setExpertMode(!expertMode)}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white hover:bg-black hover:text-white flex items-center justify-between"
              >
                <span>Expert Mode</span>
                <span className="font-bold">{expertMode ? '✓' : ''}</span>
              </button>
              <button
                onClick={() => handleMobileModeToggle(!mobileMode)}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white hover:bg-black hover:text-white flex items-center justify-between"
              >
                <span>Mobile Mode</span>
                <span className="font-bold">{mobileMode ? '✓' : ''}</span>
              </button>
              <button
                onClick={() => handleSingleFloppyModeToggle(!singleFloppyMode)}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white hover:bg-black hover:text-white flex items-center justify-between"
              >
                <span>Single Floppy Mode</span>
                <span className="font-bold">{singleFloppyMode ? '✓' : ''}</span>
              </button>
              <button
                onClick={() => setManualDepack(!manualDepack)}
                className="w-full text-left px-4 py-2 border-b border-black cursor-pointer bg-white hover:bg-black hover:text-white flex items-center justify-between"
              >
                <span>Manual Depack</span>
                <span className="font-bold">{manualDepack ? '✓' : ''}</span>
              </button>
              <button
                onClick={() => setSaveWorkbench(!saveWorkbench)}
                className="w-full text-left px-4 py-2 cursor-pointer bg-white hover:bg-black hover:text-white flex items-center justify-between"
              >
                <span>Save Workbench</span>
                <span className="font-bold">{saveWorkbench ? '✓' : ''}</span>
              </button>
            </div>
          </div>

          {/* Help Dropdown */}
          <div className="dropdown relative cursor-pointer h-full flex items-stretch">
            <span className="menu-label">Help</span>
            <div className="dropdown-content left-0 top-8 text-gem-medium">
              <button
                onClick={() => setManualOpen(true)}
                className="w-full text-left px-4 py-2 cursor-pointer bg-white"
              >
                User Manual...
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-gem-medium mr-2 select-none">
          <span className="font-bold tracking-wider hidden sm:block">
            ATARI ST DISK WORKSPACE
          </span>
        </div>
      </div>

      {/* Hidden File uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".st,.msa,.zip"
        onChange={handleDiskUpload}
        className="hidden"
        multiple
      />
      <input
        ref={romFileInputRef}
        type="file"
        accept=".rom,.bin,.img,.tos,*"
        onChange={handleRomUpload}
        className="hidden"
      />
      <input
        ref={soundLocalFileInputRef}
        type="file"
        accept=".ym,.mod,.mym,.snd,*"
        onChange={handleSoundLocalFileChange}
        className="hidden"
      />

      {/* 2. Main Desktop Stage */}
      <main
        onClick={() => setSelectedDrive(null)}
        className="flex-grow w-full relative p-4 overflow-hidden"
      >
        {/* Desk Drive Icons Stack */}
        <div className="absolute left-6 top-6 flex flex-col flex-wrap max-h-[calc(100vh-140px)] gap-y-8 gap-x-8 z-10 select-none items-start content-start">
          {/* Drive A Launch Icons (Dynamic list of floppy disks) */}
          {floppyDisks.map((disk) => {
            const isThisActive = activeDiskId === disk.id;
            const label = getFloppyLabel(disk, floppyDisks.length);
            return (
              <div
                key={disk.id}
                onClick={(e) => {
                  e.stopPropagation();
                  selectActiveDisk(disk.id);
                }}
                onDoubleClick={() => {
                  selectActiveDisk(disk.id);
                  setOpenedWindows((p) => ({ ...p, manager: true }));
                  setActiveWindowId('manager');
                }}
                className="flex flex-col items-center cursor-pointer select-none relative group w-24"
              >
                <div
                  className={`p-1 rounded bg-white border border-black shadow-sm ${
                    selectedDrive === 'A' && isThisActive ? 'gem-selected' : ''
                  }`}
                >
                  <svg
                    className="w-12 h-12 text-black"
                    viewBox="0 0 32 32"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="square"
                  >
                    <rect x="5" y="4" width="22" height="24" rx="1" fill="white" />
                    <line x1="9" y1="4" x2="23" y2="4" />
                    <rect x="10" y="4" width="8" height="7" fill="black" />
                    <rect x="8" y="15" width="16" height="13" fill="white" stroke="black" />
                    <line x1="11" y1="19" x2="21" y2="19" strokeWidth="1" />
                    <line x1="11" y1="23" x2="21" y2="23" strokeWidth="1" />
                  </svg>
                </div>
                <span
                  title={disk.name}
                  className={`text-gem-small font-bold mt-1 bg-white border border-black px-1.5 py-0.5 text-center truncate max-w-full shadow-sm select-none ${
                    selectedDrive === 'A' && isThisActive ? 'gem-selected' : ''
                  }`}
                >
                  {label}
                </span>

                {/* Eject button for floppy images */}
                {floppyDisks.length > 1 && (
                  <button
                    onClick={(e) => ejectFloppyDisk(disk.id, e)}
                    className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-800 text-white font-extrabold w-4 h-4 rounded-full border border-black text-[9px] flex items-center justify-center cursor-pointer shadow-sm z-20"
                    title="Eject floppy disk"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}

          {/* Drive C (Hard disk) Launch Icon */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              setSelectedDrive('C');
            }}
            onDoubleClick={() => {
              setOpenedWindows((p) => ({ ...p, harddrive: true }));
              setActiveWindowId('harddrive');
            }}
            className="flex flex-col items-center cursor-pointer select-none w-24"
          >
            <div
              className={`p-1 rounded bg-white border border-black shadow-sm ${
                selectedDrive === 'C' ? 'gem-selected' : ''
              }`}
            >
              <svg
                className="w-12 h-12 text-black"
                viewBox="0 0 32 32"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="square"
              >
                <rect x="3" y="7" width="26" height="17" fill="white" />
                <line x1="6" y1="11" x2="16" y2="11" />
                <line x1="6" y1="15" x2="26" y2="15" strokeDasharray="2,2" />
                <line x1="6" y1="18" x2="26" y2="18" strokeDasharray="2,2" />
                <rect x="23" y="10" width="2" height="2" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <span
              className={`text-gem-small font-bold mt-1 bg-white border border-black px-1.5 py-0.5 text-center truncate max-w-full shadow-sm ${
                selectedDrive === 'C' ? 'gem-selected' : ''
              }`}
            >
              HARD DISK C
            </span>
          </div>
        </div>

        {/* DRAGGABLE GEM WINDOW A: FLOATING FILE EXPLORER */}
        <GEMSkeletalWindow
          id="manager"
          title={`A: [${currentImageName.length > 14 ? currentImageName.substring(0, 14) + '...' : currentImageName}]\\${currentPath.join('\\')}${currentPath.length ? '\\' : ''}*.*`}
          isOpen={openedWindows.manager}
          onClose={() => setOpenedWindows((p) => ({ ...p, manager: false }))}
          defaultX={140}
          defaultY={40}
          width={700}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('manager')}
          mobileMode={mobileMode}
        >
          {/* Action Header Menu inside directory window */}
          <div className="bg-white border-b border-black px-2 py-1 flex items-center justify-between gap-2 no-drag">
            <div className="flex items-center gap-1.5">
              <button onClick={navigateBack} className="gem-btn text-gem-small py-0.5 px-2 cursor-pointer">
                ▲ BACK
              </button>
              <button
                onClick={() => setDirModalOpen(true)}
                className="gem-btn text-gem-small py-0.5 px-2 cursor-pointer"
              >
                ＋ NEW DIR
              </button>
              <label className="gem-btn text-gem-small py-0.5 px-2 cursor-pointer inline-block">
                ＋ ADD FILES
                <input
                  ref={addFilesRef}
                  type="file"
                  multiple
                  onChange={(e) => handleFileAddStaged(e.target.files)}
                  className="hidden"
                />
              </label>
              <button
                onClick={() => {
                  setOpenedWindows((p) => ({ ...p, emulator: true }));
                  setActiveWindowId('emulator');
                  showToast(`Booting [${currentImageName}] in the emulator...`, 'info');
                }}
                className="gem-btn text-gem-small py-0.5 px-2 cursor-pointer font-bold bg-amber-50 text-amber-900 border-amber-600 hover:bg-amber-100 flex items-center gap-1"
                title="Boot and test this disk image in web emulator"
              >
                <span>💾 BOOT DISK</span>
              </button>
            </div>
            <div>
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border border-black px-2 py-0.5 text-gem-small outline-none w-32 font-mono"
              />
            </div>
          </div>

          {/* Staging Bar visual cues */}
          {hasCommittedWorkNeeded && (
            <div className="bg-black text-white px-3 py-1.5 text-gem-small flex items-center justify-between border-b border-black animate-pulse">
              <span className="font-bold">⚡ UNCOMMITTED CHANGES QUEUED</span>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const confirm = await showCustomDialog(
                      'Discard Changes',
                      'Revert all unstaged additions and deletions?',
                      'confirm'
                    );
                    if (confirm) discardStagedChanges();
                  }}
                  className="bg-white text-black px-2 py-0.5 font-bold text-gem-tiny border border-white cursor-pointer hover:bg-black hover:text-white"
                >
                  Discard
                </button>
                <button
                  onClick={async () => {
                    const confirm = await showCustomDialog(
                      'Write Changes',
                      'Commit staged changes to file allocation tables?',
                      'confirm'
                    );
                    if (confirm) writeChangesToDisk();
                  }}
                  className="bg-white text-black px-2 py-0.5 font-bold text-gem-tiny border border-white cursor-pointer hover:bg-black hover:text-white"
                >
                  Commit & Write
                </button>
              </div>
            </div>
          )}

          {/* Drag & Drop Visual Explorer Files Container */}
          <div
            ref={explorerDropRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="flex flex-row h-[600px] bg-white overflow-hidden relative"
          >
            <div className="flex-grow overflow-y-auto no-drag">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black text-gem-tiny font-bold uppercase tracking-wider sticky top-0 bg-white z-10 select-none">
                    <th className="py-1 px-3 w-[35%] border-r border-black">Name</th>
                    <th className="py-1 px-2 w-[15%] border-r border-black whitespace-nowrap">Size</th>
                    <th className="py-1 px-2 w-[12%] border-r border-black whitespace-nowrap">Cluster</th>
                    <th className="py-1 px-3 w-[38%] text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-gem-small font-mono divide-y divide-gray-200">
                  {fileList.map((item, idx) => {
                    const canNavigate = item.isDir || item.isArchive;
                    const namePrefix = item.isArchive ? '🗜 ' : item.isDir ? '📁 ' : '📄 ';
                    let styledName = item.name;

                    if (item.isDeleted) styledName = '* DELETED * ' + styledName;
                    if (item.isHidden) styledName = '* HIDDEN * ' + styledName;

                    let bgClass = 'hover:bg-gray-100';
                    if (item.isDeleted) {
                      bgClass = 'bg-rose-50/60 hover:bg-rose-100/60 text-gray-400 italic font-medium';
                    } else if (item.stagedStatus === 'ADDING') {
                      bgClass = 'bg-cyan-50 hover:bg-cyan-100 font-bold';
                      styledName += ' [QUEUED]';
                    } else if (item.stagedStatus === 'DELETING') {
                      bgClass = 'bg-red-50 hover:bg-red-100 text-gray-400 line-through';
                    } else if (item.stagedStatus === 'ARCHIVE') {
                      bgClass = 'bg-indigo-50 hover:bg-indigo-100';
                    }

                    return (
                      <tr
                        key={idx}
                        className={`${bgClass} transition ${canNavigate ? 'cursor-pointer' : ''}`}
                        onClick={() => handleRowNavigation(item.name, item.isDir, item.stagedStatus, item.isDeleted)}
                        onMouseEnter={() => handleRowMouseEnter(item.cluster)}
                        onMouseLeave={handleRowMouseLeave}
                      >
                        <td className="py-1.5 px-3 border-r border-gray-200 truncate font-bold">
                          {namePrefix}
                          {styledName}
                        </td>
                        <td className="py-1.5 px-2 border-r border-gray-200 text-gray-600 whitespace-nowrap">
                          {item.isDir || item.isArchive ? '—' : formatSizeBytes(item.size)}
                        </td>
                        <td className="py-1.5 px-2 border-r border-gray-200 text-gray-500 whitespace-nowrap">
                          {item.cluster}
                        </td>
                        <td className="py-1.5 px-3 text-right whitespace-nowrap no-drag">
                          {item.stagedStatus === 'ARCHIVE' ? (
                            <>
                              {!item.isDir && (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      viewArchiveEntry(item.vaultId!, item.archivePath!);
                                    }}
                                    className="text-black font-bold underline mr-3 cursor-pointer"
                                  >
                                    View
                                  </button>
                                  {(item.name.toLowerCase().endsWith('.ym') || item.name.toLowerCase().endsWith('.mod') || item.name.toLowerCase().endsWith('.mym') || item.name.toLowerCase().endsWith('.snd')) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        playArchiveEntry(item.vaultId!, item.archivePath!);
                                      }}
                                      className="text-sky-600 font-bold underline mr-3 cursor-pointer"
                                    >
                                      Play
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      saveFileFromArchive(item.vaultId!, item.archivePath!);
                                    }}
                                    className="text-black font-bold underline cursor-pointer"
                                  >
                                    Extract
                                  </button>
                                </>
                              )}
                            </>
                          ) : item.stagedStatus === 'ADDING' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeAddedStagedFile(item.name);
                              }}
                              className="text-red-600 font-bold underline cursor-pointer"
                            >
                              Cancel
                            </button>
                          ) : item.stagedStatus === 'DELETING' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleDeleteState(item.diskOffset!, item.name, item.isDir);
                              }}
                              className="text-black font-bold underline cursor-pointer"
                            >
                              Undo
                            </button>
                          ) : item.isDeleted ? (
                            <>
                              {!item.isDir && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const bytes = getRawFileBytesFromDisk(item.diskOffset!);
                                    if (bytes) {
                                      setViewingFileName(item.name);
                                      setViewingBytes(bytes);
                                      setOpenedWindows((p) => ({ ...p, viewer: true }));
                                      setActiveWindowId('viewer');
                                    }
                                  }}
                                  className="text-black font-bold underline mr-3 cursor-pointer"
                                >
                                  View
                                </button>
                              )}
                              {!item.isDir && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const chosenName = await showCustomDialog(
                                      'Extract File',
                                      'Enter the filename to save as:',
                                      'prompt',
                                      item.name
                                    );
                                    if (!chosenName) return;
                                    const bytes = getRawFileBytesFromDisk(item.diskOffset!);
                                    if (bytes) {
                                      const blob = new Blob([bytes], { type: 'application/octet-stream' });
                                      const link = document.createElement('a');
                                      link.href = URL.createObjectURL(blob);
                                      link.download = chosenName;
                                      link.click();
                                      URL.revokeObjectURL(link.href);
                                    }
                                  }}
                                  className="text-black font-bold underline mr-3 cursor-pointer"
                                >
                                  Extract
                                </button>
                              )}
                              <button
                                onClick={(e) => undeleteFile(item.diskOffset!, item.name, e)}
                                className="text-emerald-600 font-bold underline cursor-pointer"
                              >
                                Undelete
                              </button>
                            </>
                          ) : (
                            <>
                              {!item.isDir && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const bytes = getRawFileBytesFromDisk(item.diskOffset!);
                                    if (bytes) {
                                      setViewingFileName(item.name);
                                      setViewingBytes(bytes);
                                      setOpenedWindows((p) => ({ ...p, viewer: true }));
                                      setActiveWindowId('viewer');
                                    }
                                  }}
                                  className="text-black font-bold underline mr-3 cursor-pointer"
                                >
                                  View
                                </button>
                              )}
                              {!item.isDir && (item.name.toLowerCase().endsWith('.ym') || item.name.toLowerCase().endsWith('.mod') || item.name.toLowerCase().endsWith('.mym') || item.name.toLowerCase().endsWith('.snd')) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const bytes = getRawFileBytesFromDisk(item.diskOffset!);
                                    if (bytes) {
                                      setSoundPlayBytes(bytes);
                                      setSoundPlayFileName(item.name);
                                      setOpenedWindows((p) => ({ ...p, sound: true }));
                                      setActiveWindowId('sound');
                                    }
                                  }}
                                  className="text-sky-600 font-bold underline mr-3 cursor-pointer animate-pulse-subtle"
                                >
                                  Play
                                </button>
                              )}
                              {!item.isDir && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const chosenName = await showCustomDialog(
                                      'Extract File',
                                      'Enter the filename to save as:',
                                      'prompt',
                                      item.name
                                    );
                                    if (!chosenName) return;
                                    const bytes = getRawFileBytesFromDisk(item.diskOffset!);
                                    if (bytes) {
                                      const blob = new Blob([bytes], { type: 'application/octet-stream' });
                                      const link = document.createElement('a');
                                      link.href = URL.createObjectURL(blob);
                                      link.download = chosenName;
                                      link.click();
                                      URL.revokeObjectURL(link.href);
                                    }
                                  }}
                                  className="text-black font-bold underline mr-3 cursor-pointer"
                                >
                                  Extract
                                </button>
                              )}
                              {!item.isDir && floppyDisks.length > 1 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const bytes = getRawFileBytesFromDisk(item.diskOffset!);
                                    if (bytes) {
                                      setCopyModalFile({
                                        name: item.name,
                                        bytes,
                                      });
                                    }
                                  }}
                                  className="text-emerald-700 font-bold underline mr-3 cursor-pointer"
                                >
                                  Copy To...
                                </button>
                              )}
                              {!item.isArchive && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleDeleteState(item.diskOffset!, item.name, item.isDir);
                                  }}
                                  className="text-red-600 font-bold underline cursor-pointer"
                                >
                                  Delete
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {fileList.length === 0 && (
                <div className="text-center py-12 text-gray-400 italic text-gem-normal">
                  Either this workspace directory is empty, or it could be a raw-data disk.
                </div>
              )}
            </div>

            {/* Custom styled GEM V Scroll bar */}
            <div className="scrollbar-v-track flex flex-col justify-between items-center bg-white shrink-0 select-none">
              <button className="scrollbar-btn">▲</button>
              <div className="flex-grow w-full gem-dither-track relative flex items-center justify-center">
                <div className="absolute top-2 w-[14px] h-10 bg-white border-2 border-black flex flex-col justify-center items-center gap-0.5">
                  <div className="w-2 h-0.5 bg-black" />
                  <div className="w-2 h-0.5 bg-black" />
                </div>
              </div>
              <button className="scrollbar-btn">▼</button>
            </div>

            {/* Drag & drop helper overlays */}
            {dragOverActive && (
              <div className="absolute inset-0 bg-black/10 border-2 border-dashed border-black flex items-center justify-center pointer-events-none z-50 animate-pulse">
                <div className="bg-white border-2 border-black p-4 shadow-md font-bold text-gem-normal">
                  DROP FILES TO QUEUE FOR INSERTION
                </div>
              </div>
            )}
          </div>
        </GEMSkeletalWindow>

        {/* DRAGGABLE GEM WINDOW B: PHYSICAL LAYOUT DATA MAP */}
        <DiskInfoPanel
          isOpen={openedWindows.diskinfo}
          onClose={() => setOpenedWindows((p) => ({ ...p, diskinfo: false }))}
          geometry={geometry}
          bytes={loadedDiskBytes}
          fileName={currentImageName}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('diskinfo')}
          onSetOemId={onSetOemId}
          makeDiskBootable={makeDiskBootable}
          viewBootSector={viewBootSector}
          hoveredCluster={hoveredCluster}
          onHoverCluster={setHoveredCluster}
          highlightedClusters={highlightedClusters}
          onClusterClick={handleClusterClick}
          onBootDisk={() => {
            setOpenedWindows((p) => ({ ...p, emulator: true }));
            setActiveWindowId('emulator');
            showToast(`Booting [${currentImageName}] in the emulator...`, 'info');
          }}
        />

        {/* DRAGGABLE GEM WINDOW C: ATARI DEMO SCREEN RES/TEXT VIEWER */}
        <FileViewerWindow
          isOpen={openedWindows.viewer}
          onClose={() => setOpenedWindows((p) => ({ ...p, viewer: false }))}
          fileName={viewingFileName}
          bytes={viewingBytes}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('viewer')}
          showToast={showToast}
          manualDepack={manualDepack}
          onOpenInDepack={(name, b) => {
            setDepackFileName(name);
            setDepackBytes(b);
            setOpenedWindows((p) => ({ ...p, depacker: true }));
            setActiveWindowId('depacker');
          }}
        />

        {/* DRAGGABLE GEM WINDOW C_HD: HARD DISK EXPLORER C:\*.* */}
        <GEMSkeletalWindow
          id="harddrive"
          title="C:\*.*"
          isOpen={openedWindows.harddrive}
          onClose={() => setOpenedWindows((p) => ({ ...p, harddrive: false }))}
          defaultX={220}
          defaultY={120}
          width={450}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('harddrive')}
          mobileMode={mobileMode}
        >
          <div className="p-1.5 bg-white grid grid-cols-5 gap-x-1 gap-y-2.5 text-center select-none font-mono no-drag min-h-[190px] max-h-[340px] overflow-y-auto">
            {/* SPLIT.PRG Icon */}
            <div
              onDoubleClick={() => {
                setOpenedWindows((p) => ({ ...p, splitter: true }));
                setActiveWindowId('splitter');
              }}
              className="flex flex-col items-center cursor-pointer p-1 hover:bg-gray-100 border border-transparent hover:border-black rounded transition"
            >
              <div className="w-12 h-12 bg-white flex justify-center items-center">
                <svg
                  className="w-11 h-11 text-black"
                  viewBox="0 0 32 32"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <polygon points="6,4 20,4 26,10 26,28 6,28" fill="white" />
                  <rect x="9" y="7" width="11" height="4" fill="currentColor" stroke="none" />
                  <line x1="9" y1="15" x2="23" y2="15" />
                  <line x1="9" y1="19" x2="23" y2="19" />
                  <line x1="9" y1="23" x2="23" y2="23" />
                </svg>
              </div>
              <span className="text-gem-small font-bold mt-1">SPLIT.PRG</span>
              <span className="text-[8px] leading-none text-gray-400 mt-0.5 uppercase">ROM Splitter</span>
            </div>

            {/* MERGE.PRG Icon */}
            <div
              onDoubleClick={() => {
                setOpenedWindows((p) => ({ ...p, merger: true }));
                setActiveWindowId('merger');
              }}
              className="flex flex-col items-center cursor-pointer p-1 hover:bg-gray-100 border border-transparent hover:border-black rounded transition"
            >
              <div className="w-12 h-12 bg-white flex justify-center items-center">
                <svg
                  className="w-11 h-11 text-black"
                  viewBox="0 0 32 32"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <polygon points="6,4 20,4 26,10 26,28 6,28" fill="white" />
                  <rect x="9" y="7" width="11" height="4" fill="currentColor" stroke="none" />
                  <line x1="9" y1="15" x2="23" y2="15" />
                  <line x1="9" y1="19" x2="23" y2="19" />
                  <line x1="9" y1="23" x2="23" y2="23" />
                </svg>
              </div>
              <span className="text-gem-small font-bold mt-1">MERGE.PRG</span>
              <span className="text-[8px] leading-none text-gray-400 mt-0.5 uppercase">ROM Merger</span>
            </div>

            {/* VIEWER.PRG Icon */}
            <div
              onDoubleClick={() => {
                setViewingBytes(null);
                setViewingFileName('');
                setOpenedWindows((p) => ({ ...p, viewer: true }));
                setActiveWindowId('viewer');
              }}
              className="flex flex-col items-center cursor-pointer p-1 hover:bg-gray-100 border border-transparent hover:border-black rounded transition"
            >
              <div className="w-12 h-12 bg-white flex justify-center items-center">
                <svg
                  className="w-11 h-11 text-black"
                  viewBox="0 0 32 32"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <polygon points="6,4 20,4 26,10 26,28 6,28" fill="white" />
                  <rect x="9" y="7" width="14" height="12" strokeDasharray="1,1" />
                  <line x1="11" y1="11" x2="21" y2="11" />
                  <line x1="11" y1="15" x2="21" y2="15" />
                </svg>
              </div>
              <span className="text-gem-small font-bold mt-1">VIEWER.PRG</span>
              <span className="text-[8px] leading-none text-gray-400 mt-0.5 uppercase">File Viewer</span>
            </div>

            {/* VIRUSCAN.PRG Icon */}
            <div
              onDoubleClick={() => {
                setOpenedWindows((p) => ({ ...p, virusscanner: true }));
                setActiveWindowId('virusscanner');
              }}
              className="flex flex-col items-center cursor-pointer p-1 hover:bg-gray-100 border border-transparent hover:border-black rounded transition"
            >
              <div className="w-12 h-12 bg-white flex justify-center items-center">
                <svg
                  className="w-11 h-11 text-rose-600"
                  viewBox="0 0 32 32"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <polygon points="6,4 20,4 26,10 26,28 6,28" fill="white" stroke="black" />
                  <rect x="11" y="11" width="10" height="10" fill="currentColor" stroke="black" />
                  <line x1="16" y1="13" x2="16" y2="19" stroke="white" strokeWidth="2" />
                  <line x1="13" y1="16" x2="19" y2="16" stroke="white" strokeWidth="2" />
                </svg>
              </div>
              <span className="text-gem-small font-bold mt-1">VIRUSCAN.PRG</span>
              <span className="text-[8px] leading-none text-gray-400 mt-0.5 uppercase">Antivirus</span>
            </div>

            {/* SOUND.PRG Icon */}
            <div
              onDoubleClick={() => {
                setOpenedWindows((p) => ({ ...p, sound: true }));
                setActiveWindowId('sound');
              }}
              className="flex flex-col items-center cursor-pointer p-1 hover:bg-gray-100 border border-transparent hover:border-black rounded transition"
            >
              <div className="w-12 h-12 bg-white flex justify-center items-center">
                <svg
                  className="w-11 h-11 text-sky-600"
                  viewBox="0 0 32 32"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <polygon points="6,4 20,4 26,10 26,28 6,28" fill="white" stroke="black" />
                  {/* Speaker waves */}
                  <path d="M11 12 C13 14, 13 18, 11 20 M14 9 C17 12, 17 20, 14 23 M17 6 C21 10, 21 22, 17 26" stroke="currentColor" fill="none" strokeWidth="1.5" />
                  <polygon points="7,13 10,13 13,10 13,22 10,19 7,19" fill="currentColor" stroke="currentColor" />
                </svg>
              </div>
              <span className="text-gem-small font-bold mt-1">SOUND.PRG</span>
              <span className="text-[8px] leading-none text-gray-400 mt-0.5 uppercase">YM Chiptunes</span>
            </div>

            {/* SECTOR.PRG Icon */}
            <div
              onDoubleClick={() => {
                setOpenedWindows((p) => ({ ...p, sectoreditor: true }));
                setActiveWindowId('sectoreditor');
              }}
              className="flex flex-col items-center cursor-pointer p-1 hover:bg-gray-100 border border-transparent hover:border-black rounded transition"
            >
              <div className="w-12 h-12 bg-white flex justify-center items-center">
                <svg
                  className="w-11 h-11 text-black"
                  viewBox="0 0 32 32"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <polygon points="6,4 20,4 26,10 26,28 6,28" fill="white" />
                  <rect x="10" y="8" width="12" height="14" />
                  <line x1="14" y1="8" x2="14" y2="22" strokeDasharray="1,1" />
                  <line x1="18" y1="8" x2="18" y2="22" strokeDasharray="1,1" />
                  <line x1="10" y1="12" x2="22" y2="12" strokeDasharray="1,1" />
                  <line x1="10" y1="17" x2="22" y2="17" strokeDasharray="1,1" />
                </svg>
              </div>
              <span className="text-gem-small font-bold mt-1">SECTOR.PRG</span>
              <span className="text-[8px] leading-none text-gray-400 mt-0.5 uppercase">Sector Editor</span>
            </div>

            {/* BOOTGEN.PRG Icon */}
            <div
              onDoubleClick={() => {
                setOpenedWindows((p) => ({ ...p, bootblockcreator: true }));
                setActiveWindowId('bootblockcreator');
              }}
              className="flex flex-col items-center cursor-pointer p-1 hover:bg-gray-100 border border-transparent hover:border-black rounded transition"
            >
              <div className="w-12 h-12 bg-white flex justify-center items-center">
                <svg
                  className="w-11 h-11 text-black"
                  viewBox="0 0 32 32"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <polygon points="6,4 20,4 26,10 26,28 6,28" fill="white" />
                  <rect x="10" y="9" width="12" height="9" stroke="black" />
                  <line x1="11" y1="21" x2="21" y2="21" />
                  <line x1="16" y1="18" x2="16" y2="21" />
                </svg>
              </div>
              <span className="text-gem-small font-bold mt-1">BOOTGEN.PRG</span>
              <span className="text-[8px] leading-none text-gray-400 mt-0.5 uppercase">Boot Builder</span>
            </div>

            {/* DEPACK.PRG Icon */}
            <div
              onDoubleClick={() => {
                setOpenedWindows((p) => ({ ...p, depacker: true }));
                setActiveWindowId('depacker');
              }}
              className="flex flex-col items-center cursor-pointer p-1 hover:bg-gray-100 border border-transparent hover:border-black rounded transition"
            >
              <div className="w-12 h-12 bg-white flex justify-center items-center">
                <svg
                  className="w-11 h-11 text-emerald-600"
                  viewBox="0 0 32 32"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <polygon points="6,4 20,4 26,10 26,28 6,28" fill="white" stroke="black" />
                  {/* Package Box symbol */}
                  <path d="M10 11 L16 8 L22 11 L16 14 Z M10 11 L10 19 L16 22 L16 14 Z M22 11 L22 19 L16 22 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
              <span className="text-gem-small font-bold mt-1">DEPACK.PRG</span>
              <span className="text-[8px] leading-none text-gray-400 mt-0.5 uppercase">Depacker</span>
            </div>

            {/* LAYOUT.PRG Icon */}
            <div
              onDoubleClick={() => {
                setOpenedWindows((p) => ({ ...p, diskinfo: true }));
                setActiveWindowId('diskinfo');
              }}
              className="flex flex-col items-center cursor-pointer p-1 hover:bg-gray-100 border border-transparent hover:border-black rounded transition"
            >
              <div className="w-12 h-12 bg-white flex justify-center items-center">
                <svg
                  className="w-11 h-11 text-blue-600"
                  viewBox="0 0 32 32"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <polygon points="6,4 20,4 26,10 26,28 6,28" fill="white" stroke="black" />
                  <circle cx="16" cy="17" r="7" stroke="currentColor" fill="none" strokeWidth="1.5" />
                  <circle cx="16" cy="17" r="3.5" stroke="currentColor" strokeDasharray="1,1" strokeWidth="1" />
                  <line x1="16" y1="10" x2="16" y2="24" stroke="currentColor" strokeWidth="1" />
                  <line x1="9" y1="17" x2="23" y2="17" stroke="currentColor" strokeWidth="1" />
                </svg>
              </div>
              <span className="text-gem-small font-bold mt-1">LAYOUT.PRG</span>
              <span className="text-[8px] leading-none text-gray-400 mt-0.5 uppercase">Disk Layout</span>
            </div>
          </div>
          <div className="bg-gray-50 border-t border-black px-3 py-1 text-gem-tiny text-gray-500 font-bold font-mono select-none flex justify-between items-center no-drag">
            <span>9 ITEM(S) | 398,336 BYTES USED</span>
            <span className="text-emerald-700">ONLINE</span>
          </div>
        </GEMSkeletalWindow>

        {/* DRAGGABLE GEM WINDOW D: TOS ROM SPLITTER MODULE */}
        <ROMSplitterWindow
          isOpen={openedWindows.splitter}
          onClose={() => setOpenedWindows((p) => ({ ...p, splitter: false }))}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('splitter')}
          onInspectFile={(name, bytes) => {
            setViewingFileName(name);
            setViewingBytes(bytes);
            setOpenedWindows((p) => ({ ...p, viewer: true }));
            setActiveWindowId('viewer');
          }}
          showToast={showToast}
          onRegisterGeneratedParts={(parts) => setPresetMergeParts(parts)}
          initialRom={activeROM}
        />

        {/* DRAGGABLE GEM WINDOW E: TOS ROM MERGER MODULE */}
        <ROMMergerWindow
          isOpen={openedWindows.merger}
          onClose={() => setOpenedWindows((p) => ({ ...p, merger: false }))}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('merger')}
          onInspectFile={(name, bytes) => {
            setViewingFileName(name);
            setViewingBytes(bytes);
            setOpenedWindows((p) => ({ ...p, viewer: true }));
            setActiveWindowId('viewer');
          }}
          showToast={showToast}
          onLoadAsActiveROM={(name, bytes) => {
            setActiveROM({ name, bytes });
          }}
          presetParts={presetMergeParts}
          onClearPresets={() => setPresetMergeParts([])}
        />

        {/* DRAGGABLE GEM WINDOW F: VIRUS SCANNER */}
        <VirusScannerWindow
          isOpen={openedWindows.virusscanner}
          onClose={() => setOpenedWindows((p) => ({ ...p, virusscanner: false }))}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('virusscanner')}
          mobileMode={mobileMode}
          diskBytes={loadedDiskBytes}
          geometry={geometry}
          onDiskModified={(updatedBytes) => setLoadedDiskBytes(updatedBytes)}
          showToast={showToast}
        />

        {/* DRAGGABLE GEM WINDOW G: SECTOR EDITOR */}
        <SectorEditorWindow
          isOpen={openedWindows.sectoreditor}
          onClose={() => setOpenedWindows((p) => ({ ...p, sectoreditor: false }))}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('sectoreditor')}
          mobileMode={mobileMode}
          diskBytes={loadedDiskBytes}
          geometry={geometry}
          onDiskModified={(updatedBytes) => setLoadedDiskBytes(updatedBytes)}
          showToast={showToast}
          sectorNum={sectorEditorNum}
          onSectorChange={setSectorEditorNum}
          expertMode={expertMode}
        />

        {/* DRAGGABLE GEM WINDOW H: BOOT BLOCK CREATOR */}
        <BootBlockCreatorWindow
          isOpen={openedWindows.bootblockcreator}
          onClose={() => setOpenedWindows((p) => ({ ...p, bootblockcreator: false }))}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('bootblockcreator')}
          mobileMode={mobileMode}
          diskBytes={loadedDiskBytes}
          geometry={geometry}
          onDiskModified={(updatedBytes) => setLoadedDiskBytes(updatedBytes)}
          showToast={showToast}
        />

        {/* DRAGGABLE GEM WINDOW I: SOUND PLAYER */}
        <SoundPlayerWindow
          isOpen={openedWindows.sound}
          onClose={() => setOpenedWindows((p) => ({ ...p, sound: false }))}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('sound')}
          mobileMode={mobileMode}
          importedFileBytes={soundPlayBytes}
          importedFileName={soundPlayFileName}
          onLoadLocalFile={(name, bytes) => {
            setSoundPlayFileName(name);
            setSoundPlayBytes(bytes);
          }}
          showToast={showToast}
        />

        {/* DRAGGABLE GEM WINDOW J: DEPACK.PRG MODULE */}
        <DepackWindow
          isOpen={openedWindows.depacker}
          onClose={() => {
            setOpenedWindows((p) => ({ ...p, depacker: false }));
            setDepackBytes(null);
            setDepackFileName('');
          }}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('depacker')}
          mobileMode={mobileMode}
          fileName={depackFileName}
          bytes={depackBytes}
          onInspectFile={(name, b) => {
            setViewingFileName(name);
            setViewingBytes(b);
            setOpenedWindows((p) => ({ ...p, viewer: true }));
            setActiveWindowId('viewer');
          }}
          showToast={showToast}
          expertMode={expertMode}
        />

        {/* DRAGGABLE GEM WINDOW K: ATARI ST EMULATOR POPUP */}
        <AtariSTEmulatorWindow
          isOpen={openedWindows.emulator}
          onClose={() => setOpenedWindows((p) => ({ ...p, emulator: false }))}
          activeId={activeWindowId}
          onFocus={() => setActiveWindowId('emulator')}
          mobileMode={mobileMode}
          diskBytes={loadedDiskBytes}
          diskName={currentImageName}
          showToast={showToast}
        />

        {/* MANUAL BOOK MODAL */}
        {manualOpen && (
          <div className="fixed inset-0 bg-black/40 z-[10000] flex items-center justify-center p-4">
            <div className="bg-white p-1 gem-double-border w-full max-w-[600px] max-h-[85vh] flex flex-col">
              <div className="border border-black p-4 bg-white flex flex-col gap-3 max-h-[80vh] overflow-hidden">
                <div className="flex items-center justify-between border-b-2 border-black pb-2 select-none">
                  <span className="font-bold uppercase tracking-widest text-gem-medium">
                    Atari ST Disk Manager — Manual
                  </span>
                  <button
                    onClick={() => setManualOpen(false)}
                    className="gem-btn text-gem-tiny py-0 px-2 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-gem-small leading-relaxed text-left overflow-y-auto pr-1 space-y-3 font-mono">
                  <p>
                    <strong>Overview</strong>
                    <br />
                    This tool lets you open, inspect, and edit Atari ST floppy disk images (.ST / .MSA)
                    in the browser. It uses FAT12 layout and a classic GEM-style desktop interface.
                  </p>

                  <p>
                    <strong>Getting Started &amp; Storage</strong>
                    <br />• <strong>File → Open Disk Image</strong> loads multiple floppy disk images (.ST, .MSA, or .ZIP) simultaneously (up to 20 images).
                    <br />• <strong>Templates</strong> creates blank 360–800 KB floppy images.
                    <br />• Double-click any active <strong>FLOPPY DISK</strong> icon to open its directory tree. When only one loaded image remains, it uses the standard **FLOPPY DISK** title; when multiple are loaded, it shortens names to 16 characters for visual spacing.
                    <br />• Click the red <strong>×</strong> on active drive icons to eject any selected floppy from workspace.
                    <br />• Double-click the <strong>HARD DISK C</strong> icon to open the physical C: drive containing preloaded utility programs.
                  </p>

                  <p>
                    <strong>Hard Disk C &amp; Tools</strong>
                    <br />
                    The physical partition features fully functional system-level applications:
                    <br />• <strong>SPLIT.PRG</strong> — Split Atari TOS ROM files into ODD/EVEN LO/HI chip sets.
                    <br />• <strong>MERGE.PRG</strong> — Combine split LO/HI EPROM component files back into a functional ROM.
                    <br />• <strong>VIEWER.PRG</strong> — Inspect active files, archives, and custom ROM segments.
                    <br />• <strong>VIRUSCAN.PRG</strong> — Scans raw floppy drives for boot sector malware (Signum, Ghost, Pluto) & file-level signatures. Runs automatically when loading images if Expert Mode is off, but can be manually triggered on-demand.
                    <br />• <strong>SECTOR.PRG</strong> — Low-level floppy hex editor. Navigate disk sectors (0-1439). Notice: altering sector bytes requires <strong>Expert Mode</strong> to be enabled in Settings, otherwise operates in a secure <strong>Read-Only</strong> mode.
                    <br />• <strong>BOOTGEN.PRG</strong> — Craft and inject boot sectors (standard loaders, custom scrolltexts, or anti-virus resident shields) with correct Atari ST execution checks of word sum matching 0x1234.
                    <br />• <strong>DEPACK.PRG</strong> — Dynamic extraction tool for Pack-Ice (ICE!), Atomik Cruncher (ATM5/ATM3), Rob Northen Compression (RNC Method 1/2), Medway Boys LZ77 and standard RLE archives. Supports standalone desktop runs and seamless integration with the main viewer.
                    <br />• <strong>LAYOUT.PRG</strong> — The Physical Layout Info panel. Maps raw disk geometry, boot block signatures, sector boundaries, and FAT blocks dynamically. Default is open but can be launched on-demand if closed.
                  </p>

                  <p>
                    <strong>Local File Inspection (VIEWER.PRG)</strong>
                    <br />
                    If you launch `VIEWER.PRG` without an active disk file selected, it unlocks a local inspection portal:
                    <br />• Drag-and-drop any file from your computer (e.g. TOS ROMs, graphics, binary code) directly into the zone.
                    <br />• Or click <strong>LOAD LOCAL FILE</strong> to parse, scan for scrolltexts, and decode instantly.
                  </p>

                  <p>
                    <strong>File Manager (Floppy)</strong>
                    <br />• Click a <strong>folder</strong> name to open it; use <strong>▲ BACK</strong> to go up.
                    <br />• <strong>View</strong> opens the built-in viewer (text, hex, or Atari ST graphics modes).
                    <br />• <strong>Extract</strong> downloads the file directly to your system.
                    <br />• <strong>Copy To...</strong> copies a file directly into another loaded floppy disk image, including automatic unique name conflict resolution.
                    <br />• <strong>Delete</strong> queues removal; press <strong>Commit &amp; Write</strong> to apply.
                    <br />• Deleted files can be <strong>Undeleted</strong> if cluster data isn't overwritten.
                    <br />• Drag files onto the manager window or use <strong>＋ ADD FILES</strong> to stage new files.
                    <br />• <strong>＋ NEW DIR</strong> creates a folder (commit required).
                  </p>

                  <p>
                    <strong>Compressed Archives (🗜)</strong>
                    <br />
                    Click an archive name (.ZIP, .LZH, .LHA, .ARC, .ZOO) to open it like a folder. Inside an archive, use <strong>View</strong> or <strong>Extract</strong> on individual files. Use <strong>▲ BACK</strong> to leave the archive.
                  </p>

                  <p>
                    <strong>Sound &amp; Chiptunes (SOUND.PRG)</strong>
                    <br />
                    Features a fully simulated Web Audio synth engine that emulates the Yamaha YM2149 / GI AY-3-8910 PSG soundchip:
                    <br />• Plays retro soundtrack formats (.YM tracker files, .SND, or .MYM) nested inside floppy images.
                    <br />• Select built-in demoscene tracker chords..
                    <br />• Real-time high-contrast green phosphor oscilloscopes, mute channels A/B/C, control frequency register values, and trigger funny retro effects (Infection Sweeps, Disinfect Chirps).
                  </p>

                  <p>
                    <strong>Atari Graphics &amp; Depackers</strong>
                    <br />
                    Supports classic 2/4/16-color formats (PI1/PI2/PI3 Degas, NEO, ART, MUR, DOO) alongside newly added high-fidelity display standards:
                    <br />• <strong>Tiny Stuff (.TN1/.TN2/.TN3/.TNY)</strong> — Decompresses retro "Tiny Stuff" packed pictures across Low, Medium, and High resolutions using Ax of Delight's unpacking routines.
                    <br />• <strong>Degas PC3</strong> — High-resolution 640x400 monochrome 1-plane imaging.
                    <br />• <strong>Spectrum 512 (.SPC/.SPS)</strong> — Decodes multi-packet scanline paletted buffers allowing 512 dynamic colors.
                    <br />• <strong>Neochrome Animation (.ANM)</strong> — Implements dynamic 16-color playback frame players looping frame offsets at standard rates.
                    <br />• <strong>GEM Graphic (.IMG)</strong> — Decompresses GEM Packbits RLE lines into clean white/slate monochrome visual sheets.
                    <br />• <strong>GEM Font Viewer (.FNT/.FNX)</strong> — Character map bento-browsers showing all 256 system bitmap glyphs, including zooms and assembly-compliant 8-byte/16-byte register code exporters (dc.b format).
                    <br />• Auto-depacks ancient compressed executable files (JEK, JAM, Automation, Medway, Thunder, Pack-Ice, Atomik Cruncher, RNC ProPack, RLE, LZ77-backward).
                  </p>

                  <p>
                    <strong>Atari ST Emulator</strong>
                    <br />
                    Run classic TOS configurations or custom virtual hardware environments:
                    <br />• <strong>PNG Screenshots</strong> — Capture and download crystal-clear images of the emulator rendering frame instantly.
                    <br />• <strong>Keyboard Routing</strong> — Full support for routing live, physical keyboard presses directly into the emulation system.
                    <br />• <strong>Keyboard Emulation</strong> — Standard physical keys route automatically. <strong>CONTROL</strong> acts as the Space/Fire key.
                    <br />• <strong>Joystick Emulation</strong> — Press <strong>ARROW KEYS</strong> for Atari cursor-joystick motions.
                    <br />• <strong>Joystick &amp; Storage</strong> — Mouse clicks emulate retro Atari mouse buttons. Stage file modifications in the File Manager first, then trigger <strong>COLD BOOT</strong> to execute the modified disk.
                  </p>

                  <p>
                    <strong>Settings &amp; Workbench State Persistence</strong>
                    <br />• <strong>Expert Mode</strong> — Toggles safe virus scanning thresholds and bypasses introductory notifications.
                    <br />• <strong>Mobile Mode</strong> — Force responsive viewports. Draggable windows maximize to fit the viewport seamlessly and overlay clutter is neutralized.
                    <br />• <strong>Save Workbench</strong> — Automatically caches loaded floppy images, custom code insertions, current files, and window configurations directly inside your browser's persistent modern local storage. Your retro work state is reconstituted immediately upon reloading.
                  </p>

                  <p>
                    <strong>Disk Info Panel</strong>
                    <br />
                    Shows boot sector details, cluster maps, and OEM IDs. <strong>MAKE BOOTABLE</strong> calculations correct the Atari TOS boot checksum. <strong>VIEW BOOT SECTOR</strong> renders sector 0 bytes.
                  </p>

                  <p>
                    <strong>Saving Your Work</strong>
                    <br />• <strong>Save Disk Image (.ST)</strong> — Raw sector image.
                    <br />• <strong>Save Disk Image (.MSA)</strong> — Magic Shadow Archiver version.
                    <br />• <strong>Download All as ZIP</strong> — Bulk-pack disk assets.
                  </p>

                  <p>
                    <strong>Emulation Licensing &amp; Legal Info</strong>
                    <br />
                    This toolkit integrates the <strong>EstyJS</strong> Atari ST emulator (v2.0), developed by Christian "Cyg" Girodit.
                    EstyJS is distributed under the GNU General Public License (GPL). In compliance with legal best practices:
                    <br />• The core emulation logic runs entirely client-side within the sandbox environment.
                    <br />• Full copyright blocks, source files, and dependencies are preserved intact within the code bundle.
                    <br />• Under the GPL, the source remains fully open, auditable, and modifiable for the community.
                  </p>

                  <p className="text-gem-tiny text-gray-600 italic">
                    Tip: Hovering over a file row highlights its respective physical cluster blocks on the sectors allocation map!
                  </p>
                </div>
                <div className="flex justify-center pt-2 border-t border-black select-none">
                  <button
                    onClick={() => setManualOpen(false)}
                    className="gem-btn text-gem-normal px-6 py-1 min-w-[100px] cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CREATE SUBDIR DIALOG */}
        {dirModalOpen && (
          <div className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center p-4">
            <div className="bg-white p-1 gem-double-border w-full max-w-[320px]">
              <div className="border border-black p-4 space-y-4 text-center bg-white">
                <span className="font-bold block text-gem-medium tracking-wide border-b-2 border-black pb-1 uppercase select-none">
                  Create Directory
                </span>
                <p className="text-gem-tiny text-gray-600 text-left select-none">
                  Enter folder name. FAT12 restricts file allocations naming schemas to standard 8 characters.
                </p>
                <input
                  type="text"
                  placeholder="SUBDIR"
                  maxLength={8}
                  value={newDirName}
                  onChange={(e) => setNewDirName(e.target.value.toUpperCase())}
                  className="w-full bg-white border border-black px-2 py-1 text-gem-normal font-mono text-black uppercase outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitAddDirStaged();
                  }}
                  autoFocus
                />
                <div className="flex justify-center space-x-4 pt-1 select-none">
                  <button onClick={commitAddDirStaged} className="gem-btn text-gem-normal px-4 py-0.5 cursor-pointer">
                    OK
                  </button>
                  <button
                    onClick={() => setDirModalOpen(false)}
                    className="gem-btn text-gem-normal px-4 py-0.5 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 3. Global Status Bar Footer */}
      <div className="bg-white border-t-2 border-black h-6 flex items-center justify-between px-4 text-gem-small font-bold z-50 select-none">
        <div>SYSTEM STATUS: READY (OFFLINE)</div>
        <div className="flex items-center space-x-3">
          <span>FILE MANAGER MODULE v1.5</span>
          <span className="bg-black text-white px-1">FAT12</span>
        </div>
      </div>

      {/* Retro-Double-Border GEM Custom Alert Dialog */}
      <GEMAlertDialog
        isOpen={dialogConfig.isOpen}
        type={dialogConfig.type}
        title={dialogConfig.title}
        message={dialogConfig.message}
        promptValue={dialogConfig.promptValue}
        onPromptChange={(val) => setDialogConfig((prev) => ({ ...prev, promptValue: val }))}
        onConfirm={() => dialogConfig.onConfirm(dialogConfig.promptValue)}
        onCancel={dialogConfig.onCancel}
      />

      {/* Elegant Retro GEM Copy File Modal */}
      {copyModalFile && (
        <div className="fixed inset-0 bg-black/40 z-[10000] flex items-center justify-center p-4 animate-fade-in font-sans">
          <div className="bg-white p-1 gem-double-border w-full max-w-md shadow-lg">
            <div className="border border-black p-4 space-y-4 text-center bg-white flex flex-col">
              <div className="flex items-center space-x-3 border-b-2 border-black pb-2.5">
                <div className="w-8 h-8 shrink-0 border-2 border-black flex items-center justify-center font-extrabold text-lg bg-black text-white">
                  ⎘
                </div>
                <span className="font-bold uppercase tracking-widest text-gem-normal text-left w-full truncate">
                  Copy File to Another Disk
                </span>
                <button
                  onClick={() => setCopyModalFile(null)}
                  className="no-drag w-5 h-5 bg-white border border-black flex items-center justify-center font-bold text-xs hover:bg-black hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Content */}
              <div className="text-left space-y-3">
                <div className="text-center font-bold text-gem-normal text-black underline bg-gray-50 py-1.5 border border-black font-mono">
                  "{copyModalFile.name}"
                </div>
                <div className="text-gem-small text-gray-700 leading-snug font-bold">
                  Select the target floppy disk image below to copy this file to. The file will be written into the directory partition table:
                </div>

                {/* List of other Disks */}
                <div className="max-h-56 overflow-y-auto border-2 border-black bg-white p-1 flex flex-col space-y-1">
                  {floppyDisks
                    .filter((d) => d.id !== activeDiskId)
                    .map((d) => {
                      return (
                        <button
                          key={d.id}
                          onClick={() => {
                            try {
                              // Check for duplicates in target
                              const targetEntries = getDiskDirEntries(d.bytes, 0, d.geometry);
                              const isDuplicate = targetEntries.some(
                                (ent) => !ent.isDeleted && ent.name.toLowerCase() === copyModalFile.name.toLowerCase()
                              );

                              let finalTargetName = copyModalFile.name;
                              if (isDuplicate) {
                                const dotIdx = copyModalFile.name.lastIndexOf('.');
                                const base = dotIdx !== -1 ? copyModalFile.name.substring(0, dotIdx) : copyModalFile.name;
                                const ext = dotIdx !== -1 ? copyModalFile.name.substring(dotIdx) : '';
                                // Generate safe name e.g. COPY_1.PRG
                                finalTargetName = `${base.substring(0, 5).replace(/[^a-zA-Z0-9]/g, '')}_1${ext}`;
                              }

                              // Write bytes
                              const newBytes = addFileToDiskStream(
                                d.bytes,
                                finalTargetName,
                                copyModalFile.bytes,
                                d.geometry
                              );

                              // Update floppyDisks state list
                              setFloppyDisks((prevList) =>
                                prevList.map((disk) =>
                                  disk.id === d.id ? { ...disk, bytes: newBytes } : disk
                                )
                              );

                              showToast(
                                `Copied ${copyModalFile.name} successfully to [${d.name}]${
                                  isDuplicate ? ` as "${finalTargetName}" (due to name conflict)` : ''
                                }!`,
                                'success'
                              );
                              setCopyModalFile(null);
                            } catch (err: any) {
                              showToast(`Failed to copy: ${err.message}`, 'error');
                            }
                          }}
                          className="text-left select-none text-gem-normal p-2 border border-transparent hover:border-black hover:bg-gray-100 flex items-center space-x-3 w-full cursor-pointer focus:outline-none focus:bg-gray-100 font-bold"
                        >
                          <svg
                            className="w-5 h-5 text-gray-700 flex-shrink-0"
                            viewBox="0 0 32 32"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <rect x="5" y="4" width="22" height="24" rx="1" fill="none" />
                            <line x1="9" y1="4" x2="23" y2="4" />
                            <rect x="10" y="4" width="8" height="7" fill="black" />
                            <rect x="8" y="15" width="16" height="13" fill="none" stroke="black" />
                          </svg>
                          <span className="truncate">{d.name}</span>
                        </button>
                      );
                    })}
                  {floppyDisks.filter((d) => d.id !== activeDiskId).length === 0 && (
                    <div className="text-center py-6 text-gray-400 italic text-gem-small select-none">
                      No other floppy disk images open.
                    </div>
                  )}
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="pt-2 flex items-center justify-end space-x-2 border-t border-dashed border-gray-200">
                <button
                  onClick={() => setCopyModalFile(null)}
                  className="px-4 py-1.5 border-2 border-black hover:bg-black hover:text-white cursor-pointer text-gem-normal font-bold focus:outline-none transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
