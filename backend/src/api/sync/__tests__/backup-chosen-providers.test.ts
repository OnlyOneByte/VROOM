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
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', ?, ?, ?, ?, 'active')`,
    [id, ctx.user.id, providerType, id, credentials, JSON.stringify({})]
  );
  const existing = (await ctx.sql.get(
    'SELECT backup_config FROM user_preferences WHERE user_id = ?',
    [ctx.user.id]
  )) as { backup_config: string | null } | null;
  const config = existing?.backup_config
    ? (JSON.parse(existing.backup_config) as { providers: Record<string, unknown> })
    : { providers: {} };
  if (saved) config.providers[id] = saved;
  await ctx.sql.run(
    'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config',
    [ctx.user.id, JSON.stringify(config)]
  );
}

async function savedEnabledFlags(): Promise<Record<string, boolean>> {
  const row = (await ctx.sql.get('SELECT backup_config FROM user_preferences WHERE user_id = ?', [
    ctx.user.id,
  ])) as { backup_config: string };
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
    const before = await savedEnabledFlags();
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['on-b'],
    });

    expect(res.status).toBe(200);
    expect(calls.map((call) => call.providerId)).toEqual(['on-b']);
    expect(await savedEnabledFlags()).toEqual(before);
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
    expect((await savedEnabledFlags())['off-c']).toBe(false);
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
    await ctx.sql.run(
      "INSERT INTO users (id, email, display_name) VALUES ('someone-else', 'else@test.com', 'Else')"
    );
    await ctx.sql.run(
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

async function lastSyncDate(): Promise<string | null> {
  const row = (await ctx.sql.get('SELECT last_sync_date FROM sync_state WHERE user_id = ?', [
    ctx.user.id,
  ])) as { last_sync_date: string | null } | null;
  return row?.last_sync_date ?? null;
}

async function savedConfig(): Promise<{ providers: Record<string, Record<string, unknown>> }> {
  const row = (await ctx.sql.get('SELECT backup_config FROM user_preferences WHERE user_id = ?', [
    ctx.user.id,
  ])) as { backup_config: string };
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

    const config = await savedConfig();
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
    expect(await lastSyncDate()).toBeNull();
  });

  test('a chosen set that covers every provider with backups on moves the last-sync time', async () => {
    await seedProvider('off-c', FAKE_TYPE, { enabled: false, folderPath: 'C', retentionCount: 5 });
    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['on-a', 'off-c'],
    });

    expect(res.status).toBe(200);
    expect(await lastSyncDate()).not.toBeNull();
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

describe('A one-off backup does not undo changes made while it ran', () => {
  async function registerDuring(change: () => void | Promise<void>): Promise<void> {
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    backupStrategyRegistry.register(FAKE_TYPE, {
      async execute(): Promise<BackupStrategyResult> {
        await change();
        return { success: true, capabilities: { zip: { success: true } } };
      },
    });
  }

  test('backups turned on for the provider during its first one-off backup stay on', async () => {
    await seedProvider('new-f', FAKE_TYPE, null);
    await registerDuring(async () => {
      await ctx.sql.run('UPDATE user_preferences SET backup_config = ? WHERE user_id = ?', [
        JSON.stringify({
          providers: { 'new-f': { enabled: true, folderPath: 'Mine', retentionCount: 3 } },
        }),
        ctx.user.id,
      ]);
    });

    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['new-f'],
    });

    expect(res.status).toBe(200);
    expect((await savedConfig()).providers['new-f']).toMatchObject({
      enabled: true,
      folderPath: 'Mine',
      retentionCount: 3,
      lastBackupAt: expect.any(String),
    });
  });

  test('settings saved in the moment before the backup writes its result stay as saved', async () => {
    await seedProvider('new-h', FAKE_TYPE, null);
    await registerDuring(() => undefined);
    const { repos } = await import('../../../app-context');
    const preferences = repos().preferences;
    const write = preferences.mergeJsonField.bind(preferences);
    preferences.mergeJsonField = async (...args) => {
      await write(ctx.user.id, 'backupConfig', {
        providers: { 'new-h': { enabled: true, folderPath: 'Mine', retentionCount: 3 } },
      });
      return write(...args);
    };

    try {
      const res = await ctx.authed('POST', '/api/v1/sync', {
        syncTypes: ['backup'],
        force: true,
        providerIds: ['new-h'],
      });
      expect(res.status).toBe(200);
    } finally {
      preferences.mergeJsonField = write;
    }

    expect((await savedConfig()).providers['new-h']).toMatchObject({
      enabled: true,
      folderPath: 'Mine',
      retentionCount: 3,
      lastBackupAt: expect.any(String),
    });
  });

  test('a provider removed during its backup gets no settings entry', async () => {
    await seedProvider('new-g', FAKE_TYPE, null);
    await registerDuring(async () => {
      await ctx.sql.run('DELETE FROM user_providers WHERE id = ?', ['new-g']);
    });

    const res = await ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['new-g'],
    });

    expect(res.status).toBe(200);
    expect((await savedConfig()).providers['new-g']).toBeUndefined();
  });

  test('a backup that finishes while its provider is being removed leaves no settings entry', async () => {
    await seedProvider('gone-i', FAKE_TYPE, { enabled: true, folderPath: 'I', retentionCount: 5 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    backupStrategyRegistry.register(FAKE_TYPE, {
      async execute(): Promise<BackupStrategyResult> {
        await gate;
        return { success: true, capabilities: { zip: { success: true } } };
      },
    });
    const backup = ctx.authed('POST', '/api/v1/sync', {
      syncTypes: ['backup'],
      force: true,
      providerIds: ['gone-i'],
    });

    const { repos } = await import('../../../app-context');
    const preferences = repos().preferences;
    const write = preferences.mergeJsonField.bind(preferences);
    preferences.mergeJsonField = async (...args) => {
      const result = await write(...args);
      const providers = (args[2] as { providers?: Record<string, unknown> }).providers;
      if (providers?.['gone-i'] === null) {
        release();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return result;
    };

    try {
      const res = await ctx.authed('DELETE', '/api/v1/providers/gone-i');
      expect(res.status).toBe(204);
      expect((await backup).status).toBe(200);
    } finally {
      preferences.mergeJsonField = write;
      release();
    }

    expect((await savedConfig()).providers['gone-i']).toBeUndefined();
  });

  test('a provider removed between the backup check and its write gets no entry', async () => {
    await seedProvider('gone-j', FAKE_TYPE, { enabled: true, folderPath: 'J', retentionCount: 5 });
    await registerDuring(() => undefined);
    const { repos } = await import('../../../app-context');
    const preferences = repos().preferences;
    const write = preferences.mergeJsonField.bind(preferences);
    const outside = (await import('node:async_hooks')).AsyncLocalStorage.snapshot();
    let removal: Promise<Response> | undefined;
    preferences.mergeJsonField = async (...args) => {
      const providers = (args[2] as { providers?: Record<string, unknown> }).providers;
      if (!removal && providers?.['gone-j']) {
        removal = outside(() => ctx.authed('DELETE', '/api/v1/providers/gone-j'));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return write(...args);
    };

    try {
      const res = await ctx.authed('POST', '/api/v1/sync', {
        syncTypes: ['backup'],
        force: true,
        providerIds: ['gone-j'],
      });
      expect(res.status).toBe(200);
      expect((await removal)?.status).toBe(204);
    } finally {
      preferences.mergeJsonField = write;
    }

    expect((await savedConfig()).providers['gone-j']).toBeUndefined();
  });
});
