import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

const zipOn = { enabled: true, folderPath: 'Backups', retentionCount: 5 };
const off = { enabled: false, folderPath: 'Backups', retentionCount: 5 };

function seedProvider(id: string, status: string, userId = ctx.user.id): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 's3', 'Bucket', 'unused', '{}', ?)`,
    [id, userId, status]
  );
}

function setBackupConfig(providers: Record<string, unknown>): void {
  ctx.sqlite.run(
    'INSERT OR REPLACE INTO user_preferences (user_id, backup_config, sync_on_inactivity) VALUES (?, ?, 1)',
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
});

afterEach(() => ctx.close());

describe('/sync/status providerNeedsAttention', () => {
  test.each(['needs_reauth', 'error'])(
    'is true for a %s provider with backups on',
    async (status) => {
      seedProvider('p1', status);
      setBackupConfig({ p1: zipOn });
      expect(await providerNeedsAttention()).toBe(true);
    }
  );

  test('is true for an unhealthy provider with only Sheets sync on', async () => {
    seedProvider('p1', 'error');
    setBackupConfig({ p1: { ...off, sheetsSyncEnabled: true } });
    expect(await providerNeedsAttention()).toBe(true);
  });

  test('is false when the unhealthy provider has backups and Sheets sync off', async () => {
    seedProvider('p1', 'error');
    seedProvider('p2', 'active');
    setBackupConfig({ p1: off, p2: zipOn });
    expect(await providerNeedsAttention()).toBe(false);
  });

  test('is false for a healthy or disabled provider, and with no backup config', async () => {
    expect(await providerNeedsAttention()).toBe(false);
    seedProvider('p1', 'active');
    seedProvider('p2', 'disabled');
    setBackupConfig({ p1: zipOn, p2: zipOn });
    expect(await providerNeedsAttention()).toBe(false);
  });
});
