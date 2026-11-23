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
import { isPhotoOnlyProviderType } from '../backup-strategy';
import { backupStrategyRegistry } from '../backup-strategy-registry';
import '../init';

let ctx: TestApp;
let bucket: FakeStorageProvider;
let createInstance: ReturnType<typeof spyOn>;
let encrypt: (plain: string) => string;

function seedProvider(id: string, providerType: string): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', ?, 'My Provider', ?, ?, 'active')`,
    [
      id,
      ctx.user.id,
      providerType,
      encrypt(JSON.stringify({ accessKeyId: 'AKIA', secretAccessKey: 'secret' })),
      JSON.stringify({
        endpoint: 'https://s3.example.com',
        bucket: 'b',
        region: 'us-east-1',
        providerRootPath: 'VROOM',
      }),
    ]
  );
}

function setBackupConfig(providers: Record<string, unknown>): void {
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify({ providers }),
  ]);
}

const zipOn = { enabled: true, folderPath: 'Backups', retentionCount: 5 };

beforeEach(async () => {
  ctx = await createTestApp();
  bucket = new FakeStorageProvider();
  createInstance = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockImplementation(
    () => bucket
  );
  encrypt = (await import('../../../utils/encryption')).encrypt;
  seedProvider('p-s3', 's3');
  setBackupConfig({ 'p-s3': zipOn });
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

async function waitForFiles(folder: string, count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while ((await bucket.list(folder)).length < count) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${count} file(s) in ${folder}`);
    await Bun.sleep(10);
  }
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
    try {
      activityTracker.recordActivity(ctx.user.id, 0);
      await waitForFiles('VROOM/Backups', 1);
    } finally {
      activityTracker.stopTracking(ctx.user.id);
    }

    const files = await bucket.list('VROOM/Backups');
    expect(files[0]?.name).toMatch(/^vroom-backup-.*\.zip$/);
  });

  test('retention prunes the oldest S3 backups past the configured count', async () => {
    bucket = new FakeStorageProvider([
      {
        key: 'VROOM/Backups/vroom-backup-old.zip',
        name: 'vroom-backup-old.zip',
        size: 1,
        createdTime: '1969-12-31T00:00:00.000Z',
        lastModified: '1969-12-31T00:00:00.000Z',
      },
    ]);
    setBackupConfig({ 'p-s3': { ...zipOn, retentionCount: 1 } });

    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'], force: true });
    expect(res.status).toBe(200);

    const names = (await bucket.list('VROOM/Backups')).map((f) => f.name);
    expect(names).toHaveLength(1);
    expect(names[0]).not.toBe('vroom-backup-old.zip');
  });

  test('a stale ZIP setting on a photo-only provider is ignored, so the run still succeeds', async () => {
    seedProvider('p-photos', 'google-photos');
    setBackupConfig({ 'p-s3': zipOn, 'p-photos': zipOn });

    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'], force: true });
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ outcome: string; failedProviders: string[] }>>(res);
    expect(body.data.outcome).toBe('success');
    expect(body.data.failedProviders).toEqual([]);

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
      expect(isPhotoOnlyProviderType(type), type).toBe(false);
      expect(backupStrategyRegistry.get(type), type).toBeDefined();
    }
  });
});
