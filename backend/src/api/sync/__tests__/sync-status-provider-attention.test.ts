import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

const zipOn = { enabled: true, folderPath: 'Backups', retentionCount: 5 };
const off = { enabled: false, folderPath: 'Backups', retentionCount: 5 };

async function seedProvider(id: string, status: string, userId = ctx.user.id): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 's3', 'Bucket', 'unused', '{}', ?)`,
    [id, userId, status]
  );
}

async function setBackupConfig(providers: Record<string, unknown>): Promise<void> {
  await ctx.sql.run(
    'INSERT INTO user_preferences (user_id, backup_config, sync_on_inactivity) VALUES (?, ?, TRUE) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config, sync_on_inactivity = excluded.sync_on_inactivity',
    [ctx.user.id, JSON.stringify({ providers })]
  );
}

async function providerNeedsAttention(): Promise<boolean> {
  const res = await ctx.authed('GET', '/api/v1/sync/status');
  expect(res.status).toBe(200);
  const body = await json<DataEnvelope<{ providerNeedsAttention: boolean }>>(res);
  return body.data.providerNeedsAttention;
}

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);

afterEach(() => ctx.close());

describe('/sync/status providerNeedsAttention', () => {
  test.each(['needs_reauth', 'error'])(
    'is true for a %s provider with backups on',
    async (status) => {
      await seedProvider('p1', status);
      await setBackupConfig({ p1: zipOn });
      expect(await providerNeedsAttention()).toBe(true);
    }
  );

  test('is true for an unhealthy provider with only Sheets sync on', async () => {
    await seedProvider('p1', 'error');
    await setBackupConfig({ p1: { ...off, sheetsSyncEnabled: true } });
    expect(await providerNeedsAttention()).toBe(true);
  });

  test('is false when the unhealthy provider has backups and Sheets sync off', async () => {
    await seedProvider('p1', 'error');
    await seedProvider('p2', 'active');
    await setBackupConfig({ p1: off, p2: zipOn });
    expect(await providerNeedsAttention()).toBe(false);
  });

  test('is false for a healthy or disabled provider, and with no backup config', async () => {
    expect(await providerNeedsAttention()).toBe(false);
    await seedProvider('p1', 'active');
    await seedProvider('p2', 'disabled');
    await setBackupConfig({ p1: zipOn, p2: zipOn });
    expect(await providerNeedsAttention()).toBe(false);
  });
});
