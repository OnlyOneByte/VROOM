import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CONFIG } from '../../../../config';
import { getDb } from '../../../../db/connection';
import type { UserProvider } from '../../../../db/schema';
import { userPreferences, userProviders } from '../../../../db/schema';
import { NotFoundError, ValidationError } from '../../../../errors';
import type { PhotoCategory, StorageConfig } from '../../../../types';
import { DEFAULT_STORAGE_CONFIG } from '../../../../types';
import { decrypt, secretContextOf } from '../../../../utils/encryption';
import { assertSafeOutboundUrl } from '../../../../utils/outbound-url';
import { joinStoragePath, storagePathSchema } from '../../../../utils/paths';
import {
  alwaysAvailable,
  type ProviderDescriptor,
  toCatalogEntries,
  validateProviderConfig,
} from '../../descriptor';
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

const MISSING_REFRESH_TOKEN =
  'Provider has no refresh token. Please re-connect your Google account.';

function refreshTokenOf(credentials: Record<string, unknown>): string {
  const refreshToken = credentials.refreshToken;
  if (typeof refreshToken !== 'string' || refreshToken === '') {
    throw new ValidationError(MISSING_REFRESH_TOKEN);
  }
  return refreshToken;
}

export function decryptRefreshToken(row: UserProvider): string {
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(decrypt(row.credentials, secretContextOf(row))) as Record<
      string,
      unknown
    >;
  } catch {
    throw new ValidationError('Failed to decrypt provider credentials');
  }
  return refreshTokenOf(credentials);
}

function buildGoogleDriveProvider(credentials: Record<string, unknown>): StorageProvider {
  return new GoogleDriveProvider(refreshTokenOf(credentials));
}

function buildGooglePhotosProvider(
  credentials: Record<string, unknown>,
  config: Record<string, unknown> | null
): StorageProvider {
  const albumId = typeof config?.albumId === 'string' ? config.albumId : undefined;
  return new GooglePhotosProvider(refreshTokenOf(credentials), undefined, albumId);
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

const S3_CONFIG_MESSAGE = 'S3 config must include endpoint, bucket, and region';
const requiredS3Text = z.string({ message: S3_CONFIG_MESSAGE }).min(1, S3_CONFIG_MESSAGE);

const storageRoots = {
  providerRootPath: storagePathSchema.optional(),
  photoRootPath: storagePathSchema.optional(),
};
const googleAccount = { accountEmail: z.string().optional() };

const s3ConfigSchema = z
  .strictObject({
    ...storageRoots,
    endpoint: requiredS3Text,
    bucket: requiredS3Text,
    region: requiredS3Text,
  })
  .superRefine((config, ctx) => {
    try {
      assertSafeOutboundUrl(config.endpoint, 'S3 endpoint');
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message, path: ['endpoint'] });
    }
  });

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

export interface StorageFeatures {
  photoOnly: boolean;
  backupSheets: boolean;
  defaultFolders: Record<PhotoCategory, string>;
  defaultPhotoRootPath: string;
}

export type StorageProviderDescriptor = ProviderDescriptor<
  'storage',
  StorageProviderInput,
  StorageProvider,
  StorageFeatures
>;

const GENERIC_FOLDERS: Record<PhotoCategory, string> = {
  vehicle_photos: 'vehicle-photos',
  expense_receipts: 'receipts',
  insurance_docs: 'insurance',
  odometer_readings: 'odometer',
};

export const STORAGE_PROVIDERS = {
  'google-drive': {
    capability: 'storage',
    label: 'Google Drive',
    description: 'Store photos in Google Drive',
    scope: 'user',
    availability: alwaysAvailable,
    config: { schema: z.strictObject({ ...storageRoots, ...googleAccount }), fields: [] },
    secrets: [],
    connect: 'oauth',
    serverState: ['accountEmail'],
    create: ({ credentials }) => buildGoogleDriveProvider(credentials),
    features: {
      photoOnly: false,
      backupSheets: true,
      defaultPhotoRootPath: 'Photos',
      defaultFolders: {
        vehicle_photos: 'Vehicle',
        expense_receipts: 'Receipts',
        insurance_docs: 'Insurance',
        odometer_readings: 'Odometer',
      },
    },
  },
  'google-photos': {
    capability: 'storage',
    label: 'Google Photos',
    description: 'Store photos in Google Photos',
    scope: 'user',
    availability: () => 'hidden',
    config: {
      schema: z.strictObject({ ...storageRoots, ...googleAccount, albumId: z.string().optional() }),
      fields: [],
    },
    secrets: [],
    connect: 'oauth',
    serverState: ['accountEmail', 'albumId'],
    create: ({ credentials, config }) => buildGooglePhotosProvider(credentials, config),
    features: {
      photoOnly: true,
      backupSheets: false,
      defaultPhotoRootPath: 'photos',
      defaultFolders: GENERIC_FOLDERS,
    },
  },
  s3: {
    capability: 'storage',
    label: 'S3 Compatible',
    shortLabel: 'S3 / B2 / R2',
    description: 'S3-compatible storage',
    scope: 'user',
    availability: alwaysAvailable,
    config: {
      schema: s3ConfigSchema,
      fields: [
        {
          key: 'endpoint',
          label: 'Endpoint',
          kind: 'url',
          required: true,
          placeholder: 's3.us-west-002.backblazeb2.com',
        },
        {
          key: 'bucket',
          label: 'Bucket',
          kind: 'text',
          required: true,
          placeholder: 'vroom-photos',
        },
        {
          key: 'region',
          label: 'Region',
          kind: 'text',
          required: true,
          placeholder: 'us-west-002',
        },
      ],
    },
    secrets: [
      { key: 'accessKeyId', label: 'Access Key ID', required: true },
      { key: 'secretAccessKey', label: 'Secret Access Key', required: true },
    ],
    connect: 'form',
    create: ({ credentials, config }) => buildS3Provider(credentials, config),
    features: {
      photoOnly: false,
      backupSheets: false,
      defaultPhotoRootPath: 'vroom/photos',
      defaultFolders: {
        vehicle_photos: 'vehicles',
        expense_receipts: 'receipts',
        insurance_docs: 'insurance',
        odometer_readings: 'odometer',
      },
    },
    identity: (config) =>
      config.endpoint && config.bucket
        ? `s3:${String(config.endpoint)}/${String(config.bucket)}`
        : null,
  },
  fake: {
    capability: 'storage',
    label: 'Fake (testing)',
    description: 'In-memory storage for tests',
    scope: 'user',
    availability: () => (CONFIG.allowFakeStorageProvider ? 'available' : 'hidden'),
    config: { schema: z.strictObject(storageRoots), fields: [] },
    secrets: [],
    connect: 'none',
    create: ({ id }) => getFakeProvider(id),
    features: {
      photoOnly: false,
      backupSheets: false,
      defaultPhotoRootPath: 'photos',
      defaultFolders: GENERIC_FOLDERS,
    },
  },
} satisfies Record<string, StorageProviderDescriptor>;

export type StorageProviderType = keyof typeof STORAGE_PROVIDERS;

export const STORAGE_PROVIDER_TYPES = Object.keys(STORAGE_PROVIDERS) as [
  StorageProviderType,
  ...StorageProviderType[],
];

export function storageCatalog() {
  return toCatalogEntries<'storage', StorageFeatures>(STORAGE_PROVIDERS);
}

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
      descriptor.connect === 'none'
        ? {}
        : (JSON.parse(decrypt(row.credentials, secretContextOf(row))) as Record<string, unknown>);
    const config = row.config as Record<string, unknown> | null;
    const provider = descriptor.create({ id: row.id, credentials, config });
    validateProviderConfig(descriptor, config, Object.keys(config ?? {}));
    return provider;
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
