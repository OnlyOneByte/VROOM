/** Storage backend contract: upload, download, delete and list photos across providers. */

import { PHOTO_CATEGORIES, type PhotoCategory } from '../../../../types';

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
  /** Provider-specific identifier (Drive fileId or S3 key). */
  key: string;
  name: string;
  size: number;
  /** ISO 8601. */
  createdTime: string;
  lastModified: string;
}

/** Declared by limited backends so callers can branch before attempting an unsupported operation. */
export interface StorageCapabilities {
  delete: boolean;
  list: boolean;
  arbitraryFiles: boolean;
}

export interface StorageProvider {
  readonly type: string;
  readonly capabilities?: StorageCapabilities;

  upload(params: UploadParams): Promise<StorageRef>;
  download(ref: StorageRef): Promise<Buffer>;
  delete(ref: StorageRef): Promise<void>;
  getExternalUrl(ref: StorageRef): Promise<string | null>;
  healthCheck(): Promise<boolean>;
  list(folderPath: string): Promise<StorageFileInfo[]>;
}

export const FULL_CRUD: StorageCapabilities = { delete: true, list: true, arbitraryFiles: true };

export function capabilitiesOf(provider: StorageProvider): StorageCapabilities {
  return provider.capabilities ?? FULL_CRUD;
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export const ENTITY_TO_CATEGORY: Record<string, PhotoCategory> = {
  vehicle: 'vehicle_photos',
  expense: 'expense_receipts',
  insurance_policy: 'insurance_docs',
  insurance_claim: 'insurance_docs',
  odometer_entry: 'odometer_readings',
};

export const CATEGORY_TO_ENTITY_TYPES: Record<PhotoCategory, string[]> = Object.fromEntries(
  PHOTO_CATEGORIES.map((category) => [
    category,
    Object.keys(ENTITY_TO_CATEGORY).filter(
      (entityType) => ENTITY_TO_CATEGORY[entityType] === category
    ),
  ])
) as Record<PhotoCategory, string[]>;
