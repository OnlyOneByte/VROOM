/**
 * StorageProviderRegistry — resolves storage providers for photo operations.
 *
 * Reads user_settings.storage_config to determine which provider serves each
 * photo category, loads provider rows from user_providers, decrypts credentials,
 * and instantiates the correct StorageProvider implementation.
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../db/connection';
import type { UserProvider } from '../../../../db/schema';
import { userProviders, userSettings } from '../../../../db/schema';
import { NotFoundError, ValidationError } from '../../../../errors';
import type { PhotoCategory, StorageConfig } from '../../../../types';
import { DEFAULT_STORAGE_CONFIG } from '../../../../types';
import { decrypt } from '../../../../utils/encryption';
import { joinStoragePath } from '../../../../utils/paths';
import { GoogleDriveProvider } from './google-drive-provider';
import { S3CompatProvider } from './s3-compat-provider';
import type { StorageProvider } from './storage-provider';

export interface ResolvedProvider {
  provider: StorageProvider;
  providerId: string;
  folderPath: string;
}

export class StorageProviderRegistry {
  constructor(private db: ReturnType<typeof getDb>) {}

  /**
   * Get the user's default provider for a photo category.
   * Reads storage_config.defaults, loads the provider, resolves the full folder path.
   */
  async getDefaultProvider(userId: string, category: PhotoCategory): Promise<ResolvedProvider> {
    const storageConfig = await this.loadStorageConfig(userId);

    const providerId = storageConfig.defaults[category];
    if (!providerId) {
      throw new ValidationError('No storage provider configured for this photo category');
    }

    const row = await this.db
      .select()
      .from(userProviders)
      .where(and(eq(userProviders.id, providerId), eq(userProviders.userId, userId)))
      .limit(1);

    const providerRow = row[0];
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

  /**
   * Get all backup providers for a category (providers with category enabled, excluding the default).
   */
  async getBackupProviders(userId: string, category: PhotoCategory): Promise<ResolvedProvider[]> {
    const storageConfig = await this.loadStorageConfig(userId);
    const defaultProviderId = storageConfig.defaults[category];

    const results: ResolvedProvider[] = [];

    for (const [providerId, categories] of Object.entries(storageConfig.providerCategories)) {
      // Skip the default provider
      if (providerId === defaultProviderId) continue;

      const categorySetting = categories[category];
      if (!categorySetting?.enabled) continue;

      const row = await this.db
        .select()
        .from(userProviders)
        .where(and(eq(userProviders.id, providerId), eq(userProviders.userId, userId)))
        .limit(1);

      const providerRow = row[0];
      if (!providerRow || providerRow.status !== 'active') continue;

      const provider = this.createProviderInstance(providerRow);
      const folderPath = this.resolveFolderPath(providerRow, storageConfig, providerId, category);

      results.push({ provider, providerId, folderPath });
    }

    return results;
  }

  /**
   * Get a specific provider by ID with user ownership check.
   * Use this from user-facing code paths (routes, photo-service).
   */
  async getProvider(providerId: string, userId: string): Promise<StorageProvider> {
    const row = await this.db
      .select()
      .from(userProviders)
      .where(and(eq(userProviders.id, providerId), eq(userProviders.userId, userId)))
      .limit(1);

    const providerRow = row[0];
    if (!providerRow) {
      throw new NotFoundError('Storage provider');
    }

    return this.createProviderInstance(providerRow);
  }

  /**
   * Get a specific provider by ID without ownership check.
   * Only for trusted server-side code (sync worker) where userId is unavailable.
   * @internal — Do NOT use from route handlers. Use `getProvider()` with userId instead.
   */
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

  /**
   * Get all providers for a user in a given domain (for settings UI).
   */
  async getProvidersByDomain(userId: string, domain: string): Promise<UserProvider[]> {
    return this.db
      .select()
      .from(userProviders)
      .where(and(eq(userProviders.userId, userId), eq(userProviders.domain, domain)));
  }

  /**
   * Resolve the full folder path for a provider and category.
   * Used by the sync worker to determine where to upload files.
   */
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

  /**
   * Factory: instantiate a StorageProvider from a user_providers row.
   * Decrypts credentials and switches on providerType.
   */
  createProviderInstance(row: UserProvider): StorageProvider {
    const decrypted = decrypt(row.credentials);
    const credentials = JSON.parse(decrypted) as Record<string, unknown>;

    switch (row.providerType) {
      case 'google-drive': {
        const refreshToken = credentials.refreshToken;
        if (typeof refreshToken !== 'string') {
          throw new ValidationError('Invalid Google Drive credentials: missing refreshToken');
        }
        return new GoogleDriveProvider(refreshToken);
      }
      case 's3': {
        const accessKeyId = credentials.accessKeyId;
        const secretAccessKey = credentials.secretAccessKey;
        if (typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string') {
          throw new ValidationError(
            'Invalid S3 credentials: missing accessKeyId or secretAccessKey'
          );
        }
        const config = row.config as { endpoint: string; bucket: string; region: string };
        if (!config?.endpoint || !config?.bucket || !config?.region) {
          throw new ValidationError('Invalid S3 config: missing endpoint, bucket, or region');
        }
        return new S3CompatProvider(
          { accessKeyId, secretAccessKey },
          { endpoint: config.endpoint, bucket: config.bucket, region: config.region }
        );
      }
      default:
        throw new ValidationError(`Unsupported provider type: ${row.providerType}`);
    }
  }

  /**
   * Load the storage config from user_settings for a given user.
   * Defensively merges with DEFAULT_STORAGE_CONFIG to handle rows created by
   * the migration SQL default which is missing `odometer_readings`.
   */
  private async loadStorageConfig(userId: string): Promise<StorageConfig> {
    const row = await this.db
      .select({ storageConfig: userSettings.storageConfig })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
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

  /**
   * Resolve the full folder path: providerRootPath + photoRootPath + category folderPath.
   */
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

/**
 * Direct singleton for backward compat with existing import sites.
 * Uses a Proxy to defer getDb() until first property access.
 */
export const storageProviderRegistry: StorageProviderRegistry = new Proxy(
  {} as StorageProviderRegistry,
  {
    get(_target, prop, receiver) {
      return Reflect.get(getStorageProviderRegistry(), prop, receiver);
    },
  }
);
