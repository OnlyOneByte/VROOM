import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import type { BackupStrategyContext, BackupStrategyResult } from '../backup-strategy';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(async () => {
  const { backupStrategyRegistry } = await import('../backup-strategy-registry');
  backupStrategyRegistry.register(FAKE_TYPE, {
    async execute() {
      return { success: true, capabilities: {} };
    },
  });
  ctx.close();
});

const FAKE_TYPE = 'fake-chosen';
let calls: BackupStrategyContext[] = [];

async function registerRecorder(): Promise<void> {
  const { backupStrategyRegistry } = await import('../backup-strategy-registry');
  backupStrategyRegistry.register(FAKE_TYPE, {
    async execute(context): Promise<BackupStrategyResult> {
      calls.push(context);
      return { success: true, capabilities: { zip: { success: true } } };
    },
  });
}

async function seedProvider(
  id: string,
  providerType: string,
  saved: Record<string, unknown> | null
): Promise<void> {
  const { encrypt } = await import('../../../utils/encryption');
  const credentials = encrypt(JSON.stringify({ refreshToken: 'fake' }), {
    rowId: id,
    userId: ctx.user.id,
    domain: 'storage',
  });
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', ?, ?, ?, ?, 'active')`,
    [id, ctx.user.id, providerType, id, credentials, JSON.stringify({})]
  );
  const existing = ctx.sqlite
    .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
    .get(ctx.user.id) as { backup_config: string | null } | null;
  const config = existing?.backup_config
    ? (JSON.parse(existing.backup_config) as { providers: Record<string, unknown> })
    : { providers: {} };
  if (saved) config.providers[id] = saved;
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify(config),
  ]);
}

function savedEnabledFlags(): Record<string, boolean> {
  const row = ctx.sqlite
    .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
    .get(ctx.user.id) as { backup_config: string };
  const config = JSON.parse(row.backup_config) as {
    providers: Record<string, { enabled: boolean }>;
  };
  return Object.fromEntries(Object.entries(config.providers).map(([id, s]) => [id, s.enabled]));
}

describe('Back up now to chosen providers', () => {
  beforeEach(async () => {
    calls = [];
    await registerRecorder();
    await seedProvider('on-a', FAKE_TYPE, { enabled: true, folderPath: 'A', retentionCount: 5 });
    await seedProvider('on-b', FAKE_TYPE, { enabled: true, folderPath: 'B', retentionCount: 5 });
    await seedProvider('off-c', FAKE_TYPE, {
      enabled: false,
      folderPath: 'C',
      retentionCount: 7,
    });
  });

  test('a subset backs up only to the chosen providers and leaves saved settings alone', async () => {
    const before = savedEnabledFlags();
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['on-b'],
    });

    expect(res.status).toBe(200);
    expect(calls.map((call) => call.providerId)).toEqual(['on-b']);
    expect(savedEnabledFlags()).toEqual(before);
  });

  test('a provider whose backups are off can be chosen for one backup, with its saved folder', async () => {
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['off-c'],
    });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.providerConfig).toMatchObject({
      enabled: true,
      folderPath: 'C',
      retentionCount: 7,
    });
    expect(savedEnabledFlags()['off-c']).toBe(false);
  });

  test('a chosen provider with no saved settings gets the app defaults, never a zero retention', async () => {
    await seedProvider('new-d', FAKE_TYPE, null);
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['new-d'],
    });

    expect(res.status).toBe(200);
    expect(calls[0]?.providerConfig).toMatchObject({
      enabled: true,
      folderPath: 'Backups',
      retentionCount: 10,
    });
  });

  test('without providerIds every provider with backups on is used, as before', async () => {
    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'], force: true });

    expect(res.status).toBe(200);
    expect(calls.map((call) => call.providerId).sort()).toEqual(['on-a', 'on-b']);
  });
});

describe('Back up now refuses providers it cannot use', () => {
  test.each([
    ['an empty list', []],
    ['a duplicate id', ['p1', 'p1']],
    ['a non-string id', [42]],
    ['null', null],
    ['a bare string', 'p1'],
    ['an unknown id', ['not-mine']],
  ])('%s → 400 and no backup', async (_label, providerIds) => {
    calls = [];
    await registerRecorder();
    await seedProvider('p1', FAKE_TYPE, { enabled: true, folderPath: 'A', retentionCount: 5 });

    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds,
    });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("another user's provider is refused as unknown", async () => {
    calls = [];
    await registerRecorder();
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('someone-else', 'else@test.com', 'Else')"
    );
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
       VALUES ('theirs', 'someone-else', 'storage', ?, 'Theirs', 'x', '{}', 'active')`,
      [FAKE_TYPE]
    );

    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['theirs'],
    });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('a photo-only provider is refused', async () => {
    calls = [];
    await registerRecorder();
    await seedProvider('photos', 'google-photos', null);
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['photos'],
    });

    expect(res.status).toBe(400);
    const body = await json<{ error?: { message?: string }; message?: string }>(res);
    expect(JSON.stringify(body)).toContain('only keeps photos');
    expect(calls).toHaveLength(0);
  });
});

function lastSyncDate(): string | null {
  const row = ctx.sqlite
    .query('SELECT last_sync_date FROM sync_state WHERE user_id = ?')
    .get(ctx.user.id) as { last_sync_date: string | null } | null;
  return row?.last_sync_date ?? null;
}

function savedConfig(): { providers: Record<string, Record<string, unknown>> } {
  const row = ctx.sqlite
    .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
    .get(ctx.user.id) as { backup_config: string };
  return JSON.parse(row.backup_config);
}

describe('A one-off backup keeps the saved settings usable and the sync anchor honest', () => {
  beforeEach(async () => {
    calls = [];
    await registerRecorder();
    await seedProvider('on-a', FAKE_TYPE, { enabled: true, folderPath: 'A', retentionCount: 5 });
  });

  test('a provider with no saved settings gets a complete entry with backups off, and later saves still work', async () => {
    await seedProvider('new-d', FAKE_TYPE, null);
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['new-d'],
    });
    expect(res.status).toBe(200);

    const config = savedConfig();
    expect(config.providers['new-d']).toMatchObject({
      enabled: false,
      folderPath: 'Backups',
      retentionCount: 10,
    });
    expect(config.providers['new-d']?.lastBackupAt).toEqual(expect.any(String));

    const save = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: {
        providers: { ...config.providers, 'on-a': { ...config.providers['on-a'], enabled: false } },
      },
    });
    expect(save.status).toBe(200);
  });

  test('a backup to only some providers with backups on leaves the last-sync time alone', async () => {
    await seedProvider('on-b', FAKE_TYPE, { enabled: true, folderPath: 'B', retentionCount: 5 });
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['on-b'],
    });

    expect(res.status).toBe(200);
    expect(lastSyncDate()).toBeNull();
  });

  test('a chosen set that covers every provider with backups on moves the last-sync time', async () => {
    await seedProvider('off-c', FAKE_TYPE, { enabled: false, folderPath: 'C', retentionCount: 5 });
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['on-a', 'off-c'],
    });

    expect(res.status).toBe(200);
    expect(lastSyncDate()).not.toBeNull();
  });

  test('a provider with only Sheets on keeps ZIP off when chosen', async () => {
    await seedProvider('sheets-e', FAKE_TYPE, {
      enabled: false,
      folderPath: 'E',
      retentionCount: 5,
      sheetsSyncEnabled: true,
    });
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['sheets-e'],
    });

    expect(res.status).toBe(200);
    expect(calls[0]?.providerConfig).toMatchObject({ enabled: false, sheetsSyncEnabled: true });
  });
});
