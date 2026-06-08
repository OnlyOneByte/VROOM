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

/**
 * What a provider's backend can actually do. Most providers (Drive, S3) support
 * full CRUD and omit this — `capabilitiesOf()` defaults them to FULL_CRUD. A
 * limited backend like Google Photos (append-only, photos-only, no folders)
 * declares reduced capabilities so callers branch BEFORE invoking an operation
 * the API can't perform, instead of catching a thrown error after the fact.
 */
export interface StorageCapabilities {
  /** Backend can remove a stored object (Google Photos cannot — library is append-only). */
  delete: boolean;
  /** Backend can enumerate a folder/album (Google Photos has no folder listing). */
  list: boolean;
  /** Backend can store non-image types like PDF (Google Photos is photos/videos only). */
  arbitraryFiles: boolean;
}

export interface StorageProvider {
  readonly type: string;
  /**
   * Optional. When omitted the provider is assumed full-CRUD (see FULL_CRUD).
   * Drive/S3/fake don't declare it; Google Photos does.
   */
  readonly capabilities?: StorageCapabilities;

  upload(params: UploadParams): Promise<StorageRef>;
  download(ref: StorageRef): Promise<Buffer>;
  delete(ref: StorageRef): Promise<void>;
  getExternalUrl(ref: StorageRef): Promise<string | null>;
  healthCheck(): Promise<boolean>;
  list(folderPath: string): Promise<StorageFileInfo[]>;
}

/** Default capabilities for a provider that doesn't declare any — full CRUD. */
export const FULL_CRUD: StorageCapabilities = { delete: true, list: true, arbitraryFiles: true };

/** Resolve a provider's capabilities, defaulting an undeclared provider to FULL_CRUD. */
export function capabilitiesOf(provider: StorageProvider): StorageCapabilities {
  return provider.capabilities ?? FULL_CRUD;
}

/** True for the image MIME types Google Photos (and similar) can store. */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** Maps entity types to their photo category for provider routing. */
export const ENTITY_TO_CATEGORY: Record<string, PhotoCategory> = {
  vehicle: 'vehicle_photos',
  expense: 'expense_receipts',
  insurance_policy: 'insurance_docs',
  insurance_claim: 'insurance_docs',
  odometer_entry: 'odometer_readings',
};
