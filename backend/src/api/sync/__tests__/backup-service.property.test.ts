import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fc from 'fast-check';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import type { StorageFileInfo } from '../../providers/domains/storage/storage-provider';

const PROVIDER_ID = 'prov-listing';
const BASE_MS = Date.UTC(2024, 0, 1);

type FakeProvider = {
  type: string;
  list: (folder: string) => Promise<StorageFileInfo[]>;
  delete: (ref: { externalId: string }) => Promise<void>;
};

let ctx: TestApp;
let storageSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(async () => {
  ctx = await createTestApp();
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'google-drive', 'Drive', 'enc', '{}', 'active')`,
    [PROVIDER_ID, ctx.user.id]
  );
});
afterEach(() => {
  storageSpy?.mockRestore();
  storageSpy = undefined;
  ctx.close();
});

function seedRetention(retentionCount: number): void {
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify({
      providers: { [PROVIDER_ID]: { enabled: true, folderPath: 'B', retentionCount } },
    }),
  ]);
}

async function stubStorage(files: StorageFileInfo[]): Promise<string[]> {
  const { getStorageProviderRegistry } = await import('../../providers/domains/storage/registry');
  const deleted: string[] = [];
  const fake: FakeProvider = {
    type: 'google-drive',
    list: async () => files,
    delete: async ({ externalId }) => {
      deleted.push(externalId);
    },
  };
  storageSpy ??= spyOn(getStorageProviderRegistry(), 'getProvider');
  storageSpy.mockResolvedValue(fake as never);
  return deleted;
}

function uniqueFiles(files: StorageFileInfo[]): StorageFileInfo[] {
  return files.map((f, i) => ({
    ...f,
    key: `key-${i}`,
    lastModified: new Date(BASE_MS + ((i * 7919) % 100_000) * 1000).toISOString(),
  }));
}

const backupFileArb: fc.Arbitrary<StorageFileInfo> = fc
  .record({
    name: fc
      .stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}$/)
      .map((ts) => `vroom-backup-${ts}.zip`),
    size: fc.nat({ max: 100_000_000 }),
  })
  .map(({ name, size }) => ({
    key: 'unused',
    name,
    size,
    createdTime: new Date(BASE_MS).toISOString(),
    lastModified: new Date(BASE_MS).toISOString(),
  }));

const nonBackupFileArb: fc.Arbitrary<StorageFileInfo> = fc
  .oneof(
    fc.stringMatching(/^photo-[a-z0-9]{4,8}\.(jpg|png)$/),
    fc.stringMatching(/^document-[a-z0-9]{4,8}\.pdf$/),
    fc.constant('readme.txt'),
    fc.constant('vroom-backup-incomplete'),
    fc.constant('vroom-backup-.txt')
  )
  .map((name) => ({
    key: 'unused',
    name,
    size: 1,
    createdTime: new Date(BASE_MS).toISOString(),
    lastModified: new Date(BASE_MS).toISOString(),
  }));

const retentionCountArb = fc.integer({ min: 1, max: 100 });

describe('listBackups: the backup listing', () => {
  test('lists only vroom-backup-*.zip files, newest first, with exactly one marked latest', async () => {
    const { backupService } = await import('../backup');
    await fc.assert(
      fc.asyncProperty(
        fc.array(backupFileArb, { minLength: 0, maxLength: 12 }),
        fc.array(nonBackupFileArb, { minLength: 0, maxLength: 12 }),
        async (backups, nonBackups) => {
          const files = uniqueFiles([...backups, ...nonBackups]);
          const backupKeys = new Set(files.slice(0, backups.length).map((f) => f.key));
          const lastModifiedByKey = new Map(files.map((f) => [f.key, f.lastModified]));
          seedRetention(10);
          await stubStorage(files);

          const result = await backupService.listBackups(ctx.user.id, PROVIDER_ID);

          const expectedKeys = files
            .filter((f) => backupKeys.has(f.key))
            .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
            .map((f) => f.key);
          expect(result.map((r) => r.fileRef)).toEqual(expectedKeys);
          for (let i = 1; i < result.length; i++) {
            const prev = lastModifiedByKey.get(result[i - 1].fileRef) ?? '';
            const curr = lastModifiedByKey.get(result[i].fileRef) ?? '';
            expect(prev >= curr).toBe(true);
          }
          expect(result.filter((r) => r.isLatest).length).toBe(result.length > 0 ? 1 : 0);
          expect(result[0]?.isLatest ?? false).toBe(result.length > 0);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('enforceRetention: the retention sweep', () => {
  test('deletes exactly the backups beyond the retention count, oldest first, and no other file', async () => {
    const { backupService } = await import('../backup');
    await fc.assert(
      fc.asyncProperty(
        fc.array(backupFileArb, { minLength: 0, maxLength: 20 }),
        fc.array(nonBackupFileArb, { minLength: 0, maxLength: 6 }),
        retentionCountArb,
        async (backups, nonBackups, retentionCount) => {
          const files = uniqueFiles([...backups, ...nonBackups]);
          const backupKeys = new Set(files.slice(0, backups.length).map((f) => f.key));
          const nonBackupKeys = new Set(files.slice(backups.length).map((f) => f.key));
          const newestFirst = files
            .filter((f) => backupKeys.has(f.key))
            .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
          seedRetention(retentionCount);
          const deleted = await stubStorage(files);

          const count = await backupService.enforceRetention(ctx.user.id, PROVIDER_ID);

          expect(count).toBe(deleted.length);
          expect(deleted).toEqual(newestFirst.slice(retentionCount).map((f) => f.key));
          for (const key of deleted) {
            expect(nonBackupKeys.has(key)).toBe(false);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
