// Must not import googleapis; tests load this module without that dependency.

import type { DriveFile } from '../../services/google-drive-service';
import type { StorageFileInfo } from './storage-provider';

const EPOCH_ISO = new Date(0).toISOString();

export function coalesceGoogleDriveFile(f: DriveFile): StorageFileInfo {
  return {
    key: f.id,
    name: f.name,
    size: Number(f.size) || 0,
    createdTime: f.createdTime ?? f.modifiedTime ?? EPOCH_ISO,
    lastModified: f.modifiedTime ?? f.createdTime ?? EPOCH_ISO,
  };
}
