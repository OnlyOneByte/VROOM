import { describe, expect, mock, test } from 'bun:test';
import type { UserProvider } from '../../../db/schema';
import type { StorageConfig } from '../../../types';
import { StorageProviderRegistry } from '../domains/storage/registry';

// --- Real encryption (NOT mock.module) ---
// This file previously did `mock.module('../../../utils/encryption', ...)` to stub encrypt/decrypt with
// an `encrypted:`-prefix scheme for fixture convenience. But Bun's mock.module is PROCESS-GLOBAL and
// CANNOT be restored (mock.restore only undoes mock() spies) — so the stub LEAKED into later files: when
// CI's file ordering ran this before providers-routes-http.test.ts, the leaked `encrypt` made the real
// PUT-credentials route store `encrypted:{...plaintext...}`, failing that file's "encrypted at rest, never
// echoes the plaintext secret" security assertion. Per .kiro/steering/TestingExternalAPIs.md
// (inject-don't-mock.module — the same fix the sync-worker suite already adopted), use the REAL encrypt:
// set a deterministic key (mirrors test-helpers/http-client.ts) and build fixture credentials via encrypt().
process.env.PROVIDER_ENCRYPTION_KEY ||= '0'.repeat(64);
const { encrypt } = await import('../../../utils/encryption');

/** Encrypt a credentials object the way the real routes store it (so registry.decrypt round-trips). */
function enc(creds: unknown): string {
  return encrypt(JSON.stringify(creds));
}

// --- Test fixtures ---

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

/**
 * Creates a mock DB that returns pre-configured results for sequential
 * select().from().where().limit() chains. Each call to the chain consumes
 * the next result from the queue.
 */
function createMockDb(resultQueue: unknown[][]) {
  let callIndex = 0;

  const chain = {
    select: mock(() => chain),
    from: mock(() => chain),
    where: mock(() => {
      // For getProvidersByDomain which doesn't call .limit()
      // Return the current result directly
      const idx = callIndex++;
      const result = resultQueue[idx] ?? [];
      // Attach the result so .limit() can also return it
      (chain as Record<string, unknown>)._currentResult = result;
      return chain;
    }),
    limit: mock(() => {
      // Return the result that was set by the preceding .where()
      // But decrement callIndex since where already incremented it
      const result = (chain as Record<string, unknown>)._currentResult ?? [];
      return result;
    }),
  };

  return chain;
}

describe('StorageProviderRegistry', () => {
  describe('getDefaultProvider', () => {
    test('returns correct provider with resolved folder path', async () => {
      // Call 1: loadStorageConfig → settings row
      // Call 2: provider lookup → provider row
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
      const db = createMockDb([
        [{ storageConfig: baseStorageConfig }],
        [], // no provider found
      ]);

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
      const db = createMockDb([
        [], // no settings row → falls back to DEFAULT_STORAGE_CONFIG
      ]);

      const registry = new StorageProviderRegistry(db as never);

      // DEFAULT_STORAGE_CONFIG has all defaults as null
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

      // Call 1: loadStorageConfig
      // Call 2: provider-2 lookup (provider-1 is skipped as default)
      const db = createMockDb([[{ storageConfig: configWithBackup }], [backupProvider]]);

      const registry = new StorageProviderRegistry(db as never);
      const results = await registry.getBackupProviders('user-1', 'vehicle_photos');

      expect(results).toHaveLength(1);
      expect(results[0].providerId).toBe('provider-2');
      expect(results[0].folderPath).toBe('VROOM/Photos/Backup/Photos');
    });

    test('returns empty array when no backup providers have category enabled', async () => {
      // Only provider-1 exists and it's the default — no backups
      const db = createMockDb([[{ storageConfig: baseStorageConfig }]]);

      const registry = new StorageProviderRegistry(db as never);
      const results = await registry.getBackupProviders('user-1', 'vehicle_photos');

      expect(results).toHaveLength(0);
    });

    // C387 (ARCC SAX-05 Outcome-2: "validate tenant context at every data-access boundary; missing
    // tenant validation in background jobs"): a providerId listed in the user's storageConfig whose
    // ACTUAL row is NOT owned by them (findOwnedProvider's userId-scoped query → []) must be SKIPPED,
    // never returned as a backup target. This is the tenant-isolation invariant that makes the sync
    // worker's id-only getProviderInternal safe: every photo_ref reaching the worker was created from a
    // getBackupProviders result, so its providerId is provably co-owned with the photo. A regression
    // dropping the userId leg of findOwnedProvider would let a config-referenced foreign provider become
    // a backup target → a photo synced via ANOTHER user's credentials (the ARCC cross-tenant breach).
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

      // Call 1: loadStorageConfig. Call 2: findOwnedProvider('provider-foreign', 'user-1') — the
      // userId-scoped query returns [] because the row isn't owned by user-1 → the provider is skipped.
      const db = createMockDb([
        [{ storageConfig: configWithForeign }],
        [], // findOwnedProvider → not owned → null
      ]);

      const registry = new StorageProviderRegistry(db as never);
      const results = await registry.getBackupProviders('user-1', 'vehicle_photos');

      // The foreign provider is NOT a backup target — no cross-tenant ref can be created.
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

      const db = createMockDb([
        [{ storageConfig: configWithBackup }],
        [inactiveBackup], // inactive — should be skipped
      ]);

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
      const db = createMockDb([
        [], // no provider found
      ]);

      const registry = new StorageProviderRegistry(db as never);

      await expect(registry.getProvider('nonexistent', 'user-1')).rejects.toThrow(
        'Storage provider not found'
      );
    });
  });

  describe('getProvidersByDomain', () => {
    test('returns providers filtered by user and domain', async () => {
      // getProvidersByDomain calls select().from().where() without .limit()
      // We need a special mock where .where() returns the array directly
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

    // C254: the google-photos + s3 builder validation throws (registry.ts buildGooglePhotosProvider /
    // buildS3Provider) were the uncovered createProviderInstance branches — credential/config integrity
    // gates. createProviderInstance only CONSTRUCTS (no network), so these are pure-input tests.
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
        credentials: enc({ accessKeyId: 'AK' }), // missing secretAccessKey
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
        config: { bucket: 'b' }, // missing endpoint + region
      };
      expect(() => registry.createProviderInstance(row)).toThrow(
        'Invalid S3 config: missing endpoint, bucket, or region'
      );
    });

    // C60 deep-review (CERTIFIED CLEAN — pins an unguarded PRODUCTION-SAFETY gate). createProviderInstance
    // double-gates the `fake` storage provider (registry.ts): it instantiates a FakeStorageProvider ONLY
    // when CONFIG.allowFakeStorageProvider is true (= ALLOW_FAKE_STORAGE set AND NODE_ENV !== production),
    // else throws. The FakeStorageProvider bypasses real storage (in-memory, no bytes leave the process), so
    // a `fake` row reaching production would silently swallow every backup/photo upload — a NORTH_STAR #1
    // data-loss footgun. The route-create gate is pinned (providers-routes-http.test.ts), but this REGISTRY
    // instantiation gate (a different layer — restore/sync resolve a live provider here, not via the route)
    // was unpinned. The test env has allowFakeStorageProvider=false (NODE_ENV=test, ALLOW_FAKE_STORAGE
    // unset), so this pins the SECURITY-DEFAULT branch directly — no CONFIG mock needed.
    test('C60: a fake provider is REJECTED when allowFakeStorageProvider is off (the prod-safety default)', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);
      const fakeRow = { ...baseProvider, providerType: 'fake' };

      expect(() => registry.createProviderInstance(fakeRow)).toThrow(
        'Fake storage provider is not enabled'
      );
    });

    test('C60: the fake gate SHORT-CIRCUITS before decrypt (a fake row with garbage creds still throws the GATE error, not a decrypt/parse error)', () => {
      const db = createMockDb([]);
      const registry = new StorageProviderRegistry(db as never);
      // Credentials that would throw on JSON.parse if decrypt ran — proving the gate check runs FIRST,
      // so a fake row never even reaches the credential decrypt path (the ordering in registry.ts:217-224).
      const fakeRowBadCreds = {
        ...baseProvider,
        providerType: 'fake',
        credentials: enc('not-valid-json{{{'),
      };

      expect(() => registry.createProviderInstance(fakeRowBadCreds)).toThrow(
        'Fake storage provider is not enabled'
      );
    });
  });
});
