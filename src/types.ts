/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type NavigationMode = 'disk' | 'archive';

export type StagedStatus = 'NORMAL' | 'ADDING' | 'DELETING' | 'ARCHIVE';

export interface DiskFileInfo {
  name: string;
  name83: string;
  ext83: string;
  isDir: boolean;
  size: number;
  cluster: number | string; // number for real clusters, string like "[NEW]" or "[ARCHIVE]" for virtual
  diskOffset: number | null; // null for newly added queued files
  stagedStatus: StagedStatus;
  isDeleted: boolean;
  isHidden: boolean;
  isArchive?: boolean;
  vaultId?: number;
  archivePath?: string;
}

export interface PendingFileAdd {
  name: string;
  name83: string;
  ext83: string;
  bytes: Uint8Array;
  parentCluster: number;
}

export interface PendingDirAdd {
  name: string;
  parentCluster: number;
}

export interface PendingDelete {
  name: string;
  diskOffset: number;
  parentCluster: number;
}

export interface ArchiveItem {
  path: string;
  isDir: boolean;
  size: number;
  zipPath?: string;
  lhaEntry?: any;
  arcEntry?: any;
  zooEntry?: any;
}

export interface ArchiveVault {
  id: number;
  format: string;
  sourceName: string;
  sourceOffset: number | null;
  rawBytes: Uint8Array;
  items: ArchiveItem[];
  zip?: any;
  arcItems?: any[];
  zooItems?: any[];
}

export interface ArchiveContext {
  vaultId: number;
  innerPath: string;
}

export interface WindowState {
  id: string;
  title: string;
  isOpen: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiskGeometry {
  bytesPerSector: number;
  sectorsPerCluster: number;
  reservedSectors: number;
  numFats: number;
  rootDirEntries: number;
  totalSectors: number;
  sectorsPerFat: number;
  singleFatSize: number;
  fatTableStart: number;
  fatTableSize: number;
  rootDirStart: number;
  rootDirSectors: number;
  dataAreaStart: number;
  bytesPerCluster: number;
  isFallback?: boolean;
}

export interface FloppyDisk {
  id: string;
  name: string;
  bytes: Uint8Array;
  geometry: DiskGeometry;
  currentPath: string[];
  clusterHistory: number[];
  pendingAdds: PendingFileAdd[];
  pendingDirs: PendingDirAdd[];
  pendingDeletes: PendingDelete[];
  pendingDirsToDelete: PendingDelete[];
}

