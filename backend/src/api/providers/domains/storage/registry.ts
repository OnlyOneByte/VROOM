import { and, eq } from 'drizzle-orm';
import { CONFIG } from '../../../../config';
import { getDb } from '../../../../db/connection';
import type { UserProvider } from '../../../../db/schema';
import { userPreferences, userProviders } from '../../../../db/schema';
import { NotFoundError, ValidationError } from '../../../../errors';
import type { PhotoCategory, StorageConfig } from '../../../../types';
import { DEFAULT_STORAGE_CONFIG } from '../../../../types';
import { decrypt } from '../../../../utils/encryption';
import { assertSafeOutboundUrl } from '../../../../utils/outbound-url';
import { joinStoragePath } from '../../../../utils/paths';
import { FakeStorageProvider } from './fake-provider';
import { GoogleDriveProvider } from './google-drive-provider';
import { GooglePhotosProvider } from './google-photos-provider';
import { S3CompatProvider } from './s3-compat-provider';
import type { StorageProvider } from './storage-provider';

const fakeProviders = new Map<string, FakeStorageProvider>();

interface ResolvedProvider {
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
  assertSafeOutboundUrl(s3Config.endpoint, 'S3 endpoint');
  return new S3CompatProvider(
    { accessKeyId, secretAccessKey },
    { endpoint: s3Config.endpoint, bucket: s3Config.bucket, region: s3Config.region }
  );
}

function validateS3Config(config: Record<string, unknown> | null): void {
  const c = config ?? {};
  if (!c.endpoint || !c.bucket || !c.region) {
    throw new ValidationError('S3 config must include endpoint, bucket, and region');
  }
  assertSafeOutboundUrl(String(c.endpoint), 'S3 endpoint');
}

function getFakeProvider(providerId: string): StorageProvider {
  // Fakes are double-gated: only outside production and only when explicitly opted in.
  if (!CONFIG.allowFakeStorageProvider) {
    throw new ValidationError('Fake storage provider is not enabled in this environment');
  }
  let fake = fakeProviders.get(providerId);
  if (!fake) {
    fake = new FakeStorageProvider();
    fakeProviders.set(providerId, fake);
  }
  return fake;
}

export interface StorageProviderInput {
  id: string;
  credentials: Record<string, unknown>;
  config: Record<string, unknown> | null;
}

export interface StorageProviderDescriptor {
  credentialKind: 'google-oauth' | 'keys' | 'none';
  create: (input: StorageProviderInput) => StorageProvider;
  validateConfig?: (config: Record<string, unknown> | null) => void;
  defaultFolders: Record<PhotoCategory, string>;
  identity?: (config: Record<string, unknown>) => string | null;
  creatable?: false;
}

const GENERIC_FOLDERS: Record<PhotoCategory, string> = {
  vehicle_photos: 'vehicle-photos',
  expense_receipts: 'receipts',
  insurance_docs: 'insurance',
  odometer_readings: 'odometer',
};

export const STORAGE_PROVIDERS = {
  'google-drive': {
    credentialKind: 'google-oauth',
    create: ({ credentials }) => buildGoogleDriveProvider(credentials),
    defaultFolders: {
      vehicle_photos: 'Vehicle',
      expense_receipts: 'Receipts',
      insurance_docs: 'Insurance',
      odometer_readings: 'Odometer',
    },
  },
  'google-photos': {
    credentialKind: 'google-oauth',
    create: ({ credentials, config }) => buildGooglePhotosProvider(credentials, config),
    defaultFolders: GENERIC_FOLDERS,
    creatable: false,
  },
  s3: {
    credentialKind: 'keys',
    create: ({ credentials, config }) => buildS3Provider(credentials, config),
    validateConfig: validateS3Config,
    defaultFolders: {
      vehicle_photos: 'vehicles',
      expense_receipts: 'receipts',
      insurance_docs: 'insurance',
      odometer_readings: 'odometer',
    },
    identity: (config) =>
      config.endpoint && config.bucket
        ? `s3:${String(config.endpoint)}/${String(config.bucket)}`
        : null,
  },
  fake: {
    credentialKind: 'none',
    create: ({ id }) => getFakeProvider(id),
    defaultFolders: GENERIC_FOLDERS,
  },
} satisfies Record<string, StorageProviderDescriptor>;

export type StorageProviderType = keyof typeof STORAGE_PROVIDERS;

export const STORAGE_PROVIDER_TYPES = Object.keys(STORAGE_PROVIDERS) as [
  StorageProviderType,
  ...StorageProviderType[],
];

export const CREATABLE_STORAGE_PROVIDER_TYPES = STORAGE_PROVIDER_TYPES.filter(
  (type) => (STORAGE_PROVIDERS[type] as StorageProviderDescriptor).creatable !== false
) as [StorageProviderType, ...StorageProviderType[]];

export function storageProviderDescriptor(
  providerType: string
): StorageProviderDescriptor | undefined {
  return Object.hasOwn(STORAGE_PROVIDERS, providerType)
    ? STORAGE_PROVIDERS[providerType as StorageProviderType]
    : undefined;
}

export class StorageProviderRegistry {
  constructor(private db: ReturnType<typeof getDb>) {}

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

  async getProvider(providerId: string, userId: string): Promise<StorageProvider> {
    const providerRow = await this.findOwnedProvider(providerId, userId);
    if (!providerRow) {
      throw new NotFoundError('Storage provider');
    }

    return this.createProviderInstance(providerRow);
  }

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
    const descriptor = storageProviderDescriptor(row.providerType);
    if (!descriptor) {
      throw new ValidationError(`Unsupported provider type: ${row.providerType}`);
    }
    const credentials =
      descriptor.credentialKind === 'none'
        ? {}
        : (JSON.parse(decrypt(row.credentials)) as Record<string, unknown>);
    return descriptor.create({
      id: row.id,
      credentials,
      config: row.config as Record<string, unknown> | null,
    });
  }

  // Merge with defaults: older rows predate newer categories.
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

let _registryInstance: StorageProviderRegistry | null = null;
export function getStorageProviderRegistry(): StorageProviderRegistry {
  if (!_registryInstance) {
    _registryInstance = new StorageProviderRegistry(getDb());
  }
  return _registryInstance;
}

// Keep this lazy: getDb() must not run at import time.
export const storageProviderRegistry: StorageProviderRegistry = new Proxy(
  {} as StorageProviderRegistry,
  {
    get(_target, prop, receiver) {
      return Reflect.get(getStorageProviderRegistry(), prop, receiver);
    },
  }
);
