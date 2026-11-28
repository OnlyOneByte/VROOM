import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { activityTracker } from '../activity-tracker';
import { backupService } from '../backup';
import { backupOrchestrator } from '../backup-orchestrator';

let ctx: TestApp;

const zipOn = {
  enabled: true,
  folderPath: 'Backups',
  retentionCount: 5,
  lastBackupAt: '2026-01-01T00:00:00.000Z',
};

async function seedProvider(id: string, providerType: string): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', ?, 'My Provider', 'unused', '{}', 'active')`,
    [id, ctx.user.id, providerType]
  );
}

async function setBackupConfig(providers: Record<string, unknown>): Promise<void> {
  await ctx.sql.run(
    'INSERT INTO user_preferences (user_id, backup_config, sync_on_inactivity) VALUES (?, ?, TRUE) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config, sync_on_inactivity = excluded.sync_on_inactivity',
    [ctx.user.id, JSON.stringify({ providers })]
  );
}

async function getData<T>(path: string): Promise<T> {
  const res = await ctx.authed('GET', path);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<T>>(res)).data;
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedProvider('p-photos', 'google-photos');
  await setBackupConfig({ 'p-photos': zipOn });
}, SETUP_TIMEOUT_MS);

afterEach(() => ctx.close());

describe('a stale ZIP setting left on a Google Photos provider', () => {
  test('/sync/status reports backups as off', async () => {
    const status = await getData<{ backupEnabled: boolean }>('/api/v1/sync/status');
    expect(status.backupEnabled).toBe(false);
  });

  test('/sync/status still reports backups as on for a real ZIP provider', async () => {
    await seedProvider('p-s3', 's3');
    await setBackupConfig({ 'p-photos': zipOn, 'p-s3': zipOn });
    const status = await getData<{ backupEnabled: boolean }>('/api/v1/sync/status');
    expect(status.backupEnabled).toBe(true);
  });

  test('the restore list has no Google Photos group', async () => {
    const groups = await getData<{ providerId: string }[]>('/api/v1/sync/backups/providers');
    expect(groups.map((g) => g.providerId)).not.toContain('p-photos');
  });

  test('the restore provider picker does not offer it as a ZIP source', async () => {
    const providers = await getData<{ providerId: string }[]>('/api/v1/sync/restore/providers');
    expect(providers.map((p) => p.providerId)).not.toContain('p-photos');
  });

  describe('the inactivity timer', () => {
    let record: ReturnType<typeof spyOn>;

    beforeEach(() => {
      record = spyOn(activityTracker, 'recordActivity').mockImplementation(() => {});
    });

    afterEach(() => record.mockRestore());

    async function createVehicle(): Promise<void> {
      const res = await ctx.authed('POST', '/api/v1/vehicles', {
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
      });
      expect(res.status).toBe(201);
    }

    test('is not armed by the stale entry alone', async () => {
      await createVehicle();
      expect(record).not.toHaveBeenCalled();
    });

    test('is armed when a real ZIP provider is enabled', async () => {
      await seedProvider('p-s3', 's3');
      await setBackupConfig({ 'p-photos': zipOn, 'p-s3': zipOn });
      await createVehicle();
      expect(record).toHaveBeenCalled();
    });
  });

  test('a backup run builds no ZIP', async () => {
    const exportZip = spyOn(backupService, 'exportAsZip');
    try {
      const result = await backupOrchestrator.execute(ctx.user.id, 'Test User', true);
      expect(result.outcome).toBe('noop');
      expect(exportZip).not.toHaveBeenCalled();
    } finally {
      exportZip.mockRestore();
    }
  });
});
