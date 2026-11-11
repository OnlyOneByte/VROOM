import { describe, expect, mock, test } from 'bun:test';
import type { UserProvider } from '../../../db/schema';
import type { StorageConfig } from '../../../types';
import { StorageProviderRegistry } from '../domains/storage/registry';

process.env.PROVIDER_ENCRYPTION_KEY ||= '0'.repeat(64);
const { encrypt } = await import('../../../utils/encryption');

function enc(creds: unknown): string {
  return encrypt(JSON.stringify(creds));
}

const baseProvider: UserProvider = {
  id: 'provider-1',
  userId: 'user-1',
  domain: 'storage',
  providerType: 'google-drive',
  providerAccountId: null,
  displayName: 'My Google Drive',
  credentials: enc({ refreshToken: 'tok-123' }),
  config: { photoRootPath: 'VROOM/Photos' },
  status: 'active',
  lastSyncAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseStorageConfig: StorageConfig = {
  defaults: {
    vehicle_photos: 'provider-1',
    expense_receipts: 'provider-1',
    insurance_docs: null,
    odometer_readings: null,
  },
  providerCategories: {
    'provider-1': {
      vehicle_photos: { enabled: true, folderPath: 'Vehicle' },
      expense_receipts: { enabled: true, folderPath: 'Receipts' },
      insurance_docs: { enabled: true, folderPath: 'Insurance' },
      odometer_readings: { enabled: true, folderPath: 'Odometer' },
    },
  },
};

function createMockDb(resultQueue: unknown[][]) {
  let callIndex = 0;

  const chain = {
    select: mock(() => chain),
    from: mock(() => chain),
    where: mock(() => {
      const idx = callIndex++;
      const result = resultQueue[idx] ?? [];
      (chain as Record<string, unknown>)._currentResult = result;
      return chain;
    }),
    limit: mock(() => {
      const result = (chain as Record<string, unknown>)._currentResult ?? [];
      return result;
    }),
  };

  return chain;
}

describe('StorageProviderRegistry', () => {
  describe('getDefaultProvider', () => {
    test('returns correct provider with resolved folder path', async () => {
      const db = createMockDb([[{ storageConfig: baseStorageConfig }], [baseProvider]]);

      const registry = new StorageProviderRegistry(db as never);
      const result = await registry.getDefaultProvider('user-1', 'vehicle_photos');

      expect(result.providerId).toBe('provider-1');
      expect(result.folderPath).toBe('VROOM/Photos/Vehicle');
      expect(result.provider.type).toBe('google-drive');
    });

    test('throws ValidationError when no default configured for category', async () => {
      const db = createMockDb([[{ storageConfig: baseStorageConfig }]]);

      const registry = new StorageProviderRegistry(db as never);

      await expect(registry.getDefaultProvider('user-1', 'insurance_docs')).rejects.toThrow(
        'No storage provider configured for this photo category'
      );
    });

    test('throws NotFoundError when provider row does not exist', async () => {
      const db = createMockDb([[{ storageConfig: baseStorageConfig }], []]);

      const registry = new StorageProviderRegistry(db as never);

      await expect(registry.getDefaultProvider('user-1', 'vehicle_photos')).rejects.toThrow(
        'Storage provider not found'
      );
    });

    test('throws ValidationError when provider is not active', async () => {
      const inactiveProvider = { ...baseProvider, status: 'error' };
      const db = createMockDb([[{ storageConfig: baseStorageConfig }], [inactiveProvider]]);

      const registry = new StorageProviderRegistry(db as never);

      await expect(registry.getDefaultProvider('user-1', 'vehicle_photos')).rejects.toThrow(
        'Storage provider is not active'
      );
    });

    test('returns DEFAULT_STORAGE_CONFIG when user has no settings', async () => {
      const db = createMockDb([[]]);

      const registry = new StorageProviderRegistry(db as never);

      await expect(registry.getDefaultProvider('user-1', 'vehicle_photos')).rejects.toThrow(
        'No storage provider configured for this photo category'
      );
    });
  });

  describe('getBackupProviders', () => {
    test('returns backup providers excluding the default', async () => {
      const backupProvider: UserProvider = {
        ...baseProvider,
        id: 'provider-2',
        displayName: 'Backup Drive',
        config: { photoRootPath: 'VROOM/Photos' },
      };

      const configWithBackup: StorageConfig = {
        defaults: {
          vehicle_photos: 'provider-1',
          expense_receipts: 'provider-1',
          insurance_docs: null,
          odometer_readings: null,
        },
        providerCategories: {
          'provider-1': {
            vehicle_photos: { enabled: true, folderPath: 'Vehicle' },
            expense_receipts: { enabled: true, folderPath: 'Receipts' },
            insurance_docs: { enabled: true, folderPath: 'Insurance' },
            odometer_readings: { enabled: true, folderPath: 'Odometer' },
          },
          'provider-2': {
            vehicle_photos: { enabled: true, folderPath: 'Backup/Photos' },
            expense_receipts: { enabled: false, folderPath: 'Backup/Receipts' },
            insurance_docs: { enabled: true, folderPath: 'Backup/Insurance' },
            odometer_readings: { enabled: true, folderPath: 'Backup/Odometer' },
          },
        },
      };

      const db = createMockDb([[{ storageConfig: configWithBackup }], [backupProvider]]);

      const registry = new StorageProviderRegistry(db as never);
      const results = await registry.getBackupProviders('user-1', 'vehicle_photos');

      expect(results).toHaveLength(1);
      expect(results[0].providerId).toBe('provider-2');
      expect(results[0].folderPath).toBe('VROOM/Photos/Backup/Photos');
    });

    test('returns empty array when no backup providers have category enabled', async () => {
      const db = createMockDb([[{ storageConfig: baseStorageConfig }]]);

      const registry = new StorageProviderRegistry(db as never);
      const results = await registry.getBackupProviders('user-1', 'vehicle_photos');

      expect(results).toHaveLength(0);
    });

    test('skips a config-listed provider whose row is NOT owned by the user (tenant isolation)', async () => {
      const configWithForeign: StorageConfig = {
        ...baseStorageConfig,
        providerCategories: {
          ...baseStorageConfig.providerCategories,
          'provider-foreign': {
            vehicle_photos: { enabled: true, folderPath: 'Backup' },
            expense_receipts: { enabled: true, folderPath: 'Backup' },
            insurance_docs: { enabled: true, folderPath: 'Backup' },
            odometer_readings: { enabled: true, folderPath: 'Backup' },
          },
        },
      };

      const db = createMockDb([[{ storageConfig: configWithForeign }], []]);

      const registry = new StorageProviderRegistry(db as never);
      const results = await registry.getBackupProviders('user-1', 'vehicle_photos');

      expect(results).toHaveLength(0);
    });

    test('skips inactive backup providers', async () => {
      const inactiveBackup: UserProvider = {
        ...baseProvider,
        id: 'provider-2',
        status: 'error',
      };

      const configWithBackup: StorageConfig = {
        ...baseStorageConfig,
        providerCategories: {
          ...baseStorageConfig.providerCategories,
          'provider-2': {
            vehicle_photos: { enabled: true, folderPath: 'Backup' },
            expense_receipts: { enabled: true, folderPath: 'Backup' },
            insurance_docs: { enabled: true, folderPath: 'Backup' },
            odometer_readings: { enabled: true, folderPath: 'Backup' },
          },
        },
      };

      const db = createMockDb([[{ storageConfig: configWithBackup }], [inactiveBackup]]);

      const registry = new StorageProviderRegistry(db as never);
      const results = await registry.getBackupProviders('user-1', 'vehicle_photos');

      expect(results).toHaveLength(0);
    });
  });

  describe('getProvider', () => {
    test('loads and instantiates provider by ID with ownership check', async () => {
      const db = createMockDb([[baseProvider]]);

      const registry = new StorageProviderRegistry(db as never);
      const provider = await registry.getProvider('provider-1', 'user-1');

      expect(provider.type).toBe('google-drive');
    });

    test('throws NotFoundError when provider does not exist', async () => {
      const db = createMockDb([[]]);

      const registry = new StorageProviderRegistry(db as never);

      await expect(registry.getProvider('nonexistent', 'user-1')).rejects.toThrow(
        'Storage provider not found'
      );
    });
  });

  describe('getProvidersByDomain', () => {
    test('returns providers filtered by user and domain', async () => {
      const providerList = [baseProvider];
      const domainDb = {
        select: mock(() => domainDb),
        from: mock(() => domainDb),
        where: mock(() => providerList),
      };

      const registry = new StorageProviderRegistry(domainDb as never);
      const results = await registry.getProvidersByDomain('user-1', 'storage');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('provider-1');
    });
  });

  describe('createProviderInstance', () => {
    test('creates GoogleDriveProvider for google-drive type', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);

      const provider = registry.createProviderInstance(baseProvider);
      expect(provider.type).toBe('google-drive');
    });

    test('throws ValidationError for unknown provider type', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);

      const unknownProvider = { ...baseProvider, providerType: 'dropbox' };

      expect(() => registry.createProviderInstance(unknownProvider)).toThrow(
        'Unsupported provider type: dropbox'
      );
    });

    test('throws ValidationError when credentials lack refreshToken', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);

      const badCreds = { ...baseProvider, credentials: enc({ noToken: true }) };

      expect(() => registry.createProviderInstance(badCreds)).toThrow(
        'Invalid Google Drive credentials: missing refreshToken'
      );
    });

    test('creates GooglePhotosProvider for google-photos type (reuses cached albumId from config)', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);
      const row = {
        ...baseProvider,
        providerType: 'google-photos',
        credentials: enc({ refreshToken: 'tok-gp' }),
        config: { albumId: 'album-xyz' },
      };
      expect(registry.createProviderInstance(row).type).toBe('google-photos');
    });

    test('throws when google-photos credentials lack refreshToken', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);
      const row = {
        ...baseProvider,
        providerType: 'google-photos',
        credentials: enc({ noToken: true }),
      };
      expect(() => registry.createProviderInstance(row)).toThrow(
        'Invalid Google Photos credentials: missing refreshToken'
      );
    });

    test('creates S3CompatProvider for s3 type with valid credentials + config', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);
      const row = {
        ...baseProvider,
        providerType: 's3',
        credentials: enc({ accessKeyId: 'AK', secretAccessKey: 'SK' }),
        config: { endpoint: 'https://s3.example.com', bucket: 'b', region: 'us-east-1' },
      };
      expect(registry.createProviderInstance(row).type).toBe('s3');
    });

    test('throws when s3 credentials lack accessKeyId/secretAccessKey', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);
      const row = {
        ...baseProvider,
        providerType: 's3',
        credentials: enc({ accessKeyId: 'AK' }),
        config: { endpoint: 'https://s3.example.com', bucket: 'b', region: 'us-east-1' },
      };
      expect(() => registry.createProviderInstance(row)).toThrow(
        'Invalid S3 credentials: missing accessKeyId or secretAccessKey'
      );
    });

    test('throws when s3 config is missing endpoint/bucket/region', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);
      const row = {
        ...baseProvider,
        providerType: 's3',
        credentials: enc({ accessKeyId: 'AK', secretAccessKey: 'SK' }),
        config: { bucket: 'b' },
      };
      expect(() => registry.createProviderInstance(row)).toThrow(
        'Invalid S3 config: missing endpoint, bucket, or region'
      );
    });

    test('a fake provider is REJECTED when allowFakeStorageProvider is off (the prod-safety default)', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);
      const fakeRow = { ...baseProvider, providerType: 'fake' };

      expect(() => registry.createProviderInstance(fakeRow)).toThrow(
        'Fake storage provider is not enabled'
      );
    });

    test('the fake gate SHORT-CIRCUITS before decrypt (a fake row with garbage creds still throws the GATE error, not a decrypt/parse error)', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);
      const fakeRowBadCreds = {
        ...baseProvider,
        providerType: 'fake',
        credentials: 'not-valid-json{{{',
      };

      expect(() => registry.createProviderInstance(fakeRowBadCreds)).toThrow(
        'Fake storage provider is not enabled'
      );
    });
  });
});
