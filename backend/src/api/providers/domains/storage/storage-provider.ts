/**
 * Storage Provider Interface — decouples photo storage from any single backend.
 *
 * Providers implement this interface to support upload/download/delete of photos
 * to Google Drive, S3-compatible stores, OneDrive, etc.
 */

import type { PhotoCategory } from '../../../../types';

export type { PhotoCategory };

export interface StorageRef {
  providerType: string;
  externalId: string;
  externalUrl?: string;
}

export interface UploadParams {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  entityType: string;
  entityId: string;
  pathHint: string;
  rawPath?: string; // If set, key = rawPath/fileName (bypasses buildKey)
}

export interface StorageFileInfo {
  key: string; // Provider-specific file identifier (Drive fileId or S3 key)
  name: string; // Human-readable filename
  size: number; // File size in bytes
  createdTime: string; // ISO 8601
  lastModified: string; // ISO 8601
}

export interface StorageProvider {
  readonly type: string;

  upload(params: UploadParams): Promise<StorageRef>;
  download(ref: StorageRef): Promise<Buffer>;
  delete(ref: StorageRef): Promise<void>;
  getExternalUrl(ref: StorageRef): Promise<string | null>;
  healthCheck(): Promise<boolean>;
  list(folderPath: string): Promise<StorageFileInfo[]>;
}

/** Maps entity types to their photo category for provider routing. */
export const ENTITY_TO_CATEGORY: Record<string, PhotoCategory> = {
  vehicle: 'vehicle_photos',
  expense: 'expense_receipts',
  insurance_policy: 'insurance_docs',
  odometer_entry: 'odometer_readings',
};
