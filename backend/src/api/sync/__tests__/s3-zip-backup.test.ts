import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { FakeStorageProvider } from '../../providers/domains/storage/fake-provider';
import { getStorageProviderRegistry } from '../../providers/domains/storage/registry';
import { MODEL_PROVIDER_TYPES, SUPPORTED_PROVIDER_TYPES } from '../../providers/routes';
import { backupStrategyRegistry } from '../backup-strategy-registry';
import '../init';

let ctx: TestApp;
let bucket: FakeStorageProvider;
let createInstance: ReturnType<typeof spyOn>;

beforeEach(async () => {
  ctx = await createTestApp();
  bucket = new FakeStorageProvider();
  createInstance = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockImplementation(
    () => bucket
  );
  const { encrypt } = await import('../../../utils/encryption');
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 's3', 'My Bucket', ?, ?, 'active')`,
    [
      'p-s3',
      ctx.user.id,
      encrypt(JSON.stringify({ accessKeyId: 'AKIA', secretAccessKey: 'secret' })),
      JSON.stringify({
        endpoint: 'https://s3.example.com',
        bucket: 'b',
        region: 'us-east-1',
        providerRootPath: 'VROOM',
      }),
    ]
  );
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify({
      providers: { 'p-s3': { enabled: true, folderPath: 'Backups', retentionCount: 5 } },
    }),
  ]);
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  expect(res.status).toBe(201);
});

afterEach(() => {
  createInstance.mockRestore();
  ctx.close();
});

interface ProviderBackups {
  providerId: string;
  backups: { fileName: string; fileRef: string }[];
}

async function listedBackups(): Promise<ProviderBackups[]> {
  const res = await ctx.authed('GET', '/api/v1/sync/backups/providers');
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<ProviderBackups[]>>(res)).data;
}

describe('ZIP backups to an S3 provider', () => {
  test('a manual sync writes a ZIP that the backup list then shows', async () => {
    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'], force: true });
    expect(res.status).toBe(200);

    const files = await bucket.list('VROOM/Backups');
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toMatch(/^vroom-backup-.*\.zip$/);
    expect(files[0]?.size).toBeGreaterThan(0);

    const lists = await listedBackups();
    expect(lists).toHaveLength(1);
    expect(lists[0]?.providerId).toBe('p-s3');
    expect(lists[0]?.backups.map((b) => b.fileName)).toEqual([files[0]?.name]);
  });

  test('the inactivity auto-sync writes a ZIP to the S3 provider', async () => {
    const { activityTracker } = await import('../activity-tracker');
    activityTracker.recordActivity(ctx.user.id, 999);
    try {
      await (
        activityTracker as unknown as { handleInactivity: (userId: string) => Promise<void> }
      ).handleInactivity(ctx.user.id);
    } finally {
      activityTracker.stopTracking(ctx.user.id);
    }

    const files = await bucket.list('VROOM/Backups');
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toMatch(/^vroom-backup-.*\.zip$/);
    const lastBackup = ctx.sqlite
      .query('SELECT last_backup_date FROM sync_state WHERE user_id = ?')
      .get(ctx.user.id) as { last_backup_date: number | null } | null;
    expect(lastBackup?.last_backup_date).toBeTruthy();
  });
});

describe('backup strategy registrations', () => {
  test('every storage provider type that offers ZIP backup has a strategy', () => {
    const storageTypes = SUPPORTED_PROVIDER_TYPES.filter(
      (t) => !(MODEL_PROVIDER_TYPES as readonly string[]).includes(t)
    );
    expect(storageTypes).toContain('s3');
    for (const type of storageTypes) {
      expect(backupStrategyRegistry.get(type), type).toBeDefined();
    }
  });
});
