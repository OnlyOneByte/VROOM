/** Resolves storage providers for photo categories from storage_config and user_providers rows. */

import { and, eq } from 'drizzle-orm';
import { CONFIG } from '../../../../config';
import { getDb } from '../../../../db/connection';
import type { UserProvider } from '../../../../db/schema';
import { userPreferences, userProviders } from '../../../../db/schema';
import { NotFoundError, ValidationError } from '../../../../errors';
import type { PhotoCategory, StorageConfig } from '../../../../types';
import { DEFAULT_STORAGE_CONFIG } from '../../../../types';
import { decrypt } from '../../../../utils/encryption';
import { joinStoragePath } from '../../../../utils/paths';
import { FakeStorageProvider } from './fake-provider';
import { GoogleDriveProvider } from './google-drive-provider';
import { GooglePhotosProvider } from './google-photos-provider';
import { S3CompatProvider } from './s3-compat-provider';
import type { StorageProvider } from './storage-provider';

export interface ResolvedProvider {
  provider: StorageProvider;
  providerId: string;
  folderPath: string;
}

function buildGoogleDriveProvider(credentials: Record<string, unknown>): StorageProvider {
  const refreshToken = credentials.refreshToken;
  if (typeof refreshToken !== 'string') {
    throw new ValidationError('Invalid Google Drive credentials: missing refreshToken');
  }
  return new GoogleDriveProvider(refreshToken);
}

function buildGooglePhotosProvider(
  credentials: Record<string, unknown>,
  config: Record<string, unknown> | null
): StorageProvider {
  const refreshToken = credentials.refreshToken;
  if (typeof refreshToken !== 'string') {
    throw new ValidationError('Invalid Google Photos credentials: missing refreshToken');
  }
  // The album id is cached in config after the first upload, skipping a lookup per request.
  const albumId = typeof config?.albumId === 'string' ? config.albumId : undefined;
  return new GooglePhotosProvider(refreshToken, undefined, albumId);
}

function buildS3Provider(credentials: Record<string, unknown>, config: unknown): StorageProvider {
  const accessKeyId = credentials.accessKeyId;
  const secretAccessKey = credentials.secretAccessKey;
  if (typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string') {
    throw new ValidationError('Invalid S3 credentials: missing accessKeyId or secretAccessKey');
  }
  const s3Config = config as { endpoint: string; bucket: string; region: string };
  if (!s3Config?.endpoint || !s3Config?.bucket || !s3Config?.region) {
    throw new ValidationError('Invalid S3 config: missing endpoint, bucket, or region');
  }
  return new S3CompatProvider(
    { accessKeyId, secretAccessKey },
    { endpoint: s3Config.endpoint, bucket: s3Config.bucket, region: s3Config.region }
  );
}

export class StorageProviderRegistry {
  constructor(private db: ReturnType<typeof getDb>) {}

  /** Tenant-scoped lookup on id AND userId; callers decide whether a miss throws or is skipped. */
  private async findOwnedProvider(
    providerId: string,
    userId: string
  ): Promise<UserProvider | null> {
    const row = await this.db
      .select()
      .from(userProviders)
      .where(and(eq(userProviders.id, providerId), eq(userProviders.userId, userId)))
      .limit(1);
    return row[0] ?? null;
  }

  async getDefaultProvider(userId: string, category: PhotoCategory): Promise<ResolvedProvider> {
    const storageConfig = await this.loadStorageConfig(userId);

    const providerId = storageConfig.defaults[category];
    if (!providerId) {
      throw new ValidationError('No storage provider configured for this photo category');
    }

    const providerRow = await this.findOwnedProvider(providerId, userId);
    if (!providerRow) {
      throw new NotFoundError('Storage provider');
    }

    if (providerRow.status !== 'active') {
      throw new ValidationError('Storage provider is not active');
    }

    const provider = this.createProviderInstance(providerRow);
    const folderPath = this.resolveFolderPath(providerRow, storageConfig, providerId, category);

    return { provider, providerId, folderPath };
  }

  async getBackupProviders(userId: string, category: PhotoCategory): Promise<ResolvedProvider[]> {
    const storageConfig = await this.loadStorageConfig(userId);
    const defaultProviderId = storageConfig.defaults[category];

    const results: ResolvedProvider[] = [];

    for (const [providerId, categories] of Object.entries(storageConfig.providerCategories)) {
      if (providerId === defaultProviderId) continue;

      const categorySetting = categories[category];
      if (!categorySetting?.enabled) continue;

      const providerRow = await this.findOwnedProvider(providerId, userId);
      if (providerRow?.status !== 'active') continue;

      const provider = this.createProviderInstance(providerRow);
      const folderPath = this.resolveFolderPath(providerRow, storageConfig, providerId, category);

      results.push({ provider, providerId, folderPath });
    }

    return results;
  }

  /** Use from user-facing code; getProviderInternal skips the ownership check. */
  async getProvider(providerId: string, userId: string): Promise<StorageProvider> {
    const providerRow = await this.findOwnedProvider(providerId, userId);
    if (!providerRow) {
      throw new NotFoundError('Storage provider');
    }

    return this.createProviderInstance(providerRow);
  }

  /** No ownership check: for trusted server-side callers such as the sync worker only. */
  async getProviderInternal(providerId: string): Promise<StorageProvider> {
    const row = await this.db
      .select()
      .from(userProviders)
      .where(eq(userProviders.id, providerId))
      .limit(1);

    const providerRow = row[0];
    if (!providerRow) {
      throw new NotFoundError('Storage provider');
    }

    return this.createProviderInstance(providerRow);
  }

  async getProvidersByDomain(userId: string, domain: string): Promise<UserProvider[]> {
    return this.db
      .select()
      .from(userProviders)
      .where(and(eq(userProviders.userId, userId), eq(userProviders.domain, domain)));
  }

  async resolveProviderFolderPath(providerId: string, category: PhotoCategory): Promise<string> {
    const row = await this.db
      .select()
      .from(userProviders)
      .where(eq(userProviders.id, providerId))
      .limit(1);

    const providerRow = row[0];
    if (!providerRow) return '';

    const storageConfig = await this.loadStorageConfig(providerRow.userId);
    return this.resolveFolderPath(providerRow, storageConfig, providerId, category);
  }

  createProviderInstance(row: UserProvider): StorageProvider {
    // Fakes are double-gated: only outside production and only when explicitly opted in.
    if (row.providerType === 'fake') {
      if (!CONFIG.allowFakeStorageProvider) {
        throw new ValidationError('Fake storage provider is not enabled in this environment');
      }
      return new FakeStorageProvider();
    }

    const decrypted = decrypt(row.credentials);
    const credentials = JSON.parse(decrypted) as Record<string, unknown>;

    switch (row.providerType) {
      case 'google-drive':
        return buildGoogleDriveProvider(credentials);
      case 'google-photos':
        return buildGooglePhotosProvider(credentials, row.config as Record<string, unknown> | null);
      case 's3':
        return buildS3Provider(credentials, row.config);
      default:
        throw new ValidationError(`Unsupported provider type: ${row.providerType}`);
    }
  }

  /** Merged with defaults because older rows may predate newer categories such as odometer_readings. */
  private async loadStorageConfig(userId: string): Promise<StorageConfig> {
    const row = await this.db
      .select({ storageConfig: userPreferences.storageConfig })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    const settings = row[0];
    if (!settings?.storageConfig) {
      return DEFAULT_STORAGE_CONFIG;
    }

    return {
      defaults: { ...DEFAULT_STORAGE_CONFIG.defaults, ...settings.storageConfig.defaults },
      providerCategories: settings.storageConfig.providerCategories ?? {},
    };
  }

  private resolveFolderPath(
    providerRow: UserProvider,
    storageConfig: StorageConfig,
    providerId: string,
    category: PhotoCategory
  ): string {
    const config = providerRow.config as Record<string, unknown> | null;
    const providerRootPath = (config?.providerRootPath as string) ?? '';
    const photoRootPath = (config?.photoRootPath as string) ?? '';

    const categorySettings = storageConfig.providerCategories[providerId];
    const categorySetting = categorySettings?.[category];
    const folderPath = categorySetting?.folderPath ?? '';

    return joinStoragePath(providerRootPath, photoRootPath, folderPath);
  }
}

/** Lazy singleton registry instance — avoids calling getDb() at module scope. */
let _registryInstance: StorageProviderRegistry | null = null;
export function getStorageProviderRegistry(): StorageProviderRegistry {
  if (!_registryInstance) {
    _registryInstance = new StorageProviderRegistry(getDb());
  }
  return _registryInstance;
}

/** Proxy defers getDb() until the first property access. */
export const storageProviderRegistry: StorageProviderRegistry = new Proxy(
  {} as StorageProviderRegistry,
  {
    get(_target, prop, receiver) {
      return Reflect.get(getStorageProviderRegistry(), prop, receiver);
    },
  }
);
