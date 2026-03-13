/**
 * Pure utility functions for Google Drive file metadata coalescing.
 *
 * Extracted into a separate module so tests can import these without
 * transitively pulling in `googleapis` (which can fail in CI environments).
 */

import type { DriveFile } from '../../services/google-drive-service';
import type { StorageFileInfo } from './storage-provider';

const EPOCH_ISO = new Date(0).toISOString();

/**
 * Coalesce a Google Drive file into a StorageFileInfo, handling null/undefined
 * `createdTime`, `modifiedTime`, and `size` fields with safe fallbacks.
 */
export function coalesceGoogleDriveFile(f: DriveFile): StorageFileInfo {
  return {
    key: f.id,
    name: f.name,
    size: Number(f.size) || 0,
    createdTime: f.createdTime ?? f.modifiedTime ?? EPOCH_ISO,
    lastModified: f.modifiedTime ?? f.createdTime ?? EPOCH_ISO,
  };
}
