import { isSyncError, PayloadTooLargeError, SyncError, SyncErrorCode } from '../../../../errors';
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
  rawPath?: string;
}

export interface StorageFileInfo {
  key: string;
  name: string;
  size: number;
  createdTime: string;
  lastModified: string;
}

export interface StorageCapabilities {
  delete: boolean;
  list: boolean;
  arbitraryFiles: boolean;
}

export interface DownloadOptions {
  maxBytes?: number;
}

export function assertWithinSize(bytes: number, options: DownloadOptions | undefined): void {
  if (options?.maxBytes === undefined || bytes <= options.maxBytes) return;
  const limitMb = Math.round(options.maxBytes / 1024 / 1024);
  throw new PayloadTooLargeError(`The file is larger than the ${limitMb} MB limit`);
}

export interface StorageProvider {
  readonly type: string;
  readonly capabilities?: StorageCapabilities;

  upload(params: UploadParams): Promise<StorageRef>;
  download(ref: StorageRef, options?: DownloadOptions): Promise<Buffer>;
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

const AUTH_ERROR_NAMES = new Set([
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'ExpiredToken',
  'InvalidToken',
]);

function statusOf(error: Record<string, unknown>): number | undefined {
  const response = error.response as { status?: unknown } | undefined;
  const metadata = error.$metadata as { httpStatusCode?: unknown } | undefined;
  const status = response?.status ?? metadata?.httpStatusCode ?? error.code;
  return typeof status === 'number' ? status : undefined;
}

const THROTTLE_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'storageQuotaExceeded',
  'dailyLimitExceeded',
]);

function isThrottled(error: Record<string, unknown>, text: string): boolean {
  const data = (error.response as { data?: { error?: { errors?: { reason?: unknown }[] } } })?.data;
  const reasons = [
    ...((error.errors as { reason?: unknown }[] | undefined) ?? []),
    ...(data?.error?.errors ?? []),
  ].map((item) => String(item?.reason ?? ''));
  const googleShaped = Array.isArray(error.errors) || data?.error !== undefined;
  return (
    reasons.some((reason) => THROTTLE_REASONS.has(reason)) ||
    (googleShaped && /rate limit|quota/i.test(text))
  );
}

export function credentialFailureOf(error: unknown): SyncError | null {
  if (isSyncError(error)) {
    return error.code === SyncErrorCode.AUTH_INVALID ||
      error.code === SyncErrorCode.PERMISSION_DENIED
      ? error
      : null;
  }
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;
  const status = statusOf(record);
  const text = `${String(record.name ?? '')} ${String(record.message ?? '')}`;
  if (status === 401 || AUTH_ERROR_NAMES.has(String(record.name)) || /invalid_grant/.test(text)) {
    return new SyncError(SyncErrorCode.AUTH_INVALID, 'The provider rejected the saved credentials');
  }
  if (status === 403 && isThrottled(record, text)) return null;
  if (status === 403 || record.name === 'AccessDenied') {
    return new SyncError(SyncErrorCode.PERMISSION_DENIED, 'The provider refused access');
  }
  return null;
}

export function credentialCodeOf(error: unknown): 'auth' | 'permission' | null {
  const failure = credentialFailureOf(error);
  if (!failure) return null;
  return failure.code === SyncErrorCode.PERMISSION_DENIED ? 'permission' : 'auth';
}

const MISSING_OBJECT_NAMES = new Set(['NoSuchKey', 'NotFound']);

export function isMissingBucket(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'NoSuchBucket';
}

export function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || isMissingBucket(error)) return false;
  const record = error as Record<string, unknown>;
  return MISSING_OBJECT_NAMES.has(String(record.name)) || statusOf(record) === 404;
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}
