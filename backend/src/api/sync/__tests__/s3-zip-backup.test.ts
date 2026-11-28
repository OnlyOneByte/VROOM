import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { GoogleDriveStrategy } from '../../providers/backup-strategies/google-drive-strategy';
import { ZipBackupStrategy } from '../../providers/backup-strategies/zip-strategy';
import { FakeStorageProvider } from '../../providers/domains/storage/fake-provider';
import {
  getStorageProviderRegistry,
  STORAGE_PROVIDER_TYPES,
} from '../../providers/domains/storage/registry';
import { backupFilePrefix } from '../backup';
import { isPhotoOnlyProviderType } from '../backup-strategy';
import { backupStrategyRegistry } from '../backup-strategy-registry';
import '../init';

let ctx: TestApp;
let bucket: FakeStorageProvider;
let createInstance: ReturnType<typeof spyOn>;
let encrypt: typeof import('../../../utils/encryption').encrypt;

async function seedProvider(id: string, providerType: string): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', ?, 'My Provider', ?, ?, 'active')`,
    [
      id,
      ctx.user.id,
      providerType,
      encrypt(JSON.stringify({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }), {
        rowId: id,
        userId: ctx.user.id,
        domain: 'storage',
      }),
      JSON.stringify({
        endpoint: 'https://s3.example.com',
        bucket: 'b',
        region: 'us-east-1',
        providerRootPath: 'VROOM',
      }),
    ]
  );
}

async function setBackupConfig(providers: Record<string, unknown>): Promise<void> {
  await ctx.sql.run(
    'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config',
    [ctx.user.id, JSON.stringify({ providers })]
  );
}

const zipOn = { enabled: true, folderPath: 'Backups', retentionCount: 5 };

beforeEach(async () => {
  ctx = await createTestApp();
  bucket = new FakeStorageProvider();
  createInstance = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockImplementation(
    async () => bucket
  );
  encrypt = (await import('../../../utils/encryption')).encrypt;
  await seedProvider('p-s3', 's3');
  await setBackupConfig({ 'p-s3': zipOn });
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  expect(res.status).toBe(201);
}, SETUP_TIMEOUT_MS);

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

async function lastBackupDate(): Promise<number | null> {
  const row = (await ctx.sql.get('SELECT last_backup_date FROM sync_state WHERE user_id = ?', [
    ctx.user.id,
  ])) as { last_backup_date: number | null } | null;
  return row?.last_backup_date ?? null;
}

async function waitForBackupDate(): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await lastBackupDate())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for last_backup_date');
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
      await waitForBackupDate();
    } finally {
      activityTracker.stopTracking(ctx.user.id);
    }

    const files = await bucket.list('VROOM/Backups');
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toMatch(/^vroom-backup-.*\.zip$/);
  });

  test('retention prunes the oldest S3 backups past the configured count', async () => {
    bucket = new FakeStorageProvider([
      {
        key: `VROOM/Backups/${backupFilePrefix(ctx.user.id)}old.zip`,
        name: `${backupFilePrefix(ctx.user.id)}old.zip`,
        size: 1,
        createdTime: '1969-12-31T00:00:00.000Z',
        lastModified: '1969-12-31T00:00:00.000Z',
      },
    ]);
    await setBackupConfig({ 'p-s3': { ...zipOn, retentionCount: 1 } });

    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'], force: true });
    expect(res.status).toBe(200);

    const names = (await bucket.list('VROOM/Backups')).map((f) => f.name);
    expect(names).toHaveLength(1);
    expect(names[0]).not.toBe(`${backupFilePrefix(ctx.user.id)}old.zip`);
    expect(names[0]?.startsWith(backupFilePrefix(ctx.user.id))).toBe(true);
  });

  test("in a shared folder, retention keeps other accounts' backups and untagged older ones", async () => {
    const file = (name: string) => ({
      key: `VROOM/Backups/${name}`,
      name,
      size: 1,
      createdTime: '1969-12-31T00:00:00.000Z',
      lastModified: '1969-12-31T00:00:00.000Z',
    });
    const otherAccount = `${backupFilePrefix('another-account')}2026-01-01T00-00-00-000Z.zip`;
    const untagged = 'vroom-backup-2025-06-01T10-20-30-400Z.zip';
    bucket = new FakeStorageProvider([file(otherAccount), file(untagged)]);
    await setBackupConfig({ 'p-s3': { ...zipOn, retentionCount: 1 } });

    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'], force: true });
    expect(res.status).toBe(200);

    const names = (await bucket.list('VROOM/Backups')).map((f) => f.name);
    expect(names).toContain(otherAccount);
    expect(names).toContain(untagged);
    expect(names).toHaveLength(3);

    const listed = (await listedBackups()).find((p) => p.providerId === 'p-s3');
    const listedNames = listed?.backups.map((b) => b.fileName) ?? [];
    expect(listedNames).toContain(untagged);
    expect(listedNames).toContain(otherAccount);
    expect(listedNames).toHaveLength(3);
  });

  test('a stale ZIP setting on a photo-only provider is ignored, so the run still succeeds', async () => {
    await seedProvider('p-photos', 'google-photos');
    await setBackupConfig({ 'p-s3': zipOn, 'p-photos': zipOn });

    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'], force: true });
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ outcome: string; failedProviders: string[] }>>(res);
    expect(body.data.outcome).toBe('success');
    expect(body.data.failedProviders).toEqual([]);

    expect(await lastBackupDate()).toBeTruthy();
  });
});

describe('backup strategy registrations', () => {
  test('every storage provider type that offers ZIP backup has a strategy', () => {
    const zipTypes = STORAGE_PROVIDER_TYPES.filter((t) => !isPhotoOnlyProviderType(t));
    expect(zipTypes).toContain('s3');
    expect(zipTypes).not.toContain('google-photos');
    for (const type of zipTypes) {
      expect(backupStrategyRegistry.get(type), type).toBeDefined();
    }
  });

  test('the descriptor picks the strategy, and photo-only types get none', () => {
    expect(backupStrategyRegistry.get('google-drive')).toBeInstanceOf(GoogleDriveStrategy);
    expect(backupStrategyRegistry.get('s3')).toBeInstanceOf(ZipBackupStrategy);
    expect(backupStrategyRegistry.get('google-photos')).toBeUndefined();
  });
});
