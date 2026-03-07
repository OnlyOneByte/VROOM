/**
 * Storage Provider Interface — decouples photo storage from any single backend.
 *
 * Providers implement this interface to support upload/download/delete of photos
 * to Google Drive, S3-compatible stores, OneDrive, etc.
 */

import type { PhotoCategory } from '../../types';

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
}

export interface StorageProvider {
  readonly type: string;

  upload(params: UploadParams): Promise<StorageRef>;
  download(ref: StorageRef): Promise<Buffer>;
  delete(ref: StorageRef): Promise<void>;
  getExternalUrl(ref: StorageRef): Promise<string | null>;
  healthCheck(): Promise<boolean>;
}

/** Maps entity types to their photo category for provider routing. */
export const ENTITY_TO_CATEGORY: Record<string, PhotoCategory> = {
  vehicle: 'vehicle_photos',
  expense: 'expense_receipts',
  expense_group: 'expense_receipts',
  insurance_policy: 'insurance_docs',
  odometer_entry: 'odometer_readings',
};
