import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import { openAsyncDatabase } from '../../../db/async-sqlite';
import { NotFoundError } from '../../../errors';
import { StorageProviderRegistry } from '../domains/storage/registry';

const OWNER = 'u-owner';
const OTHER = 'u-other';
const PROVIDER = 'p-owner';

let sqlite: Database;
let registry: StorageProviderRegistry;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqlite, m);
  for (const id of [OWNER, OTHER]) {
    sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      id,
      `${id}@test.com`,
      id,
    ]);
  }
  sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'fake', 'Fake', '', ?, 'active')`,
    [PROVIDER, OWNER, JSON.stringify({ providerRootPath: 'VROOM' })]
  );
  sqlite.run('INSERT INTO user_preferences (user_id, storage_config) VALUES (?, ?)', [
    OWNER,
    JSON.stringify({
      defaults: {},
      providerCategories: { [PROVIDER]: { vehicle_photos: { enabled: true, folderPath: 'Cars' } } },
    }),
  ]);
  registry = new StorageProviderRegistry(openAsyncDatabase(sqlite).db);
});
afterEach(() => sqlite.close());

describe('provider lookups are scoped to the owning user', () => {
  test("another user's id finds no provider", async () => {
    const config = CONFIG as { allowFakeStorageProvider: boolean };
    const previous = config.allowFakeStorageProvider;
    config.allowFakeStorageProvider = true;
    try {
      expect((await registry.getProvider(PROVIDER, OWNER)).type).toBe('fake');
      await expect(registry.getProvider(PROVIDER, OTHER)).rejects.toThrow(NotFoundError);
    } finally {
      config.allowFakeStorageProvider = previous;
    }
  });

  test("another user's id resolves no folder path", async () => {
    expect(await registry.resolveProviderFolderPath(PROVIDER, OWNER, 'vehicle_photos')).toBe(
      'VROOM/Cars'
    );
    expect(await registry.resolveProviderFolderPath(PROVIDER, OTHER, 'vehicle_photos')).toBe('');
  });
});
