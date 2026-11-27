import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import { openAsyncDatabase } from '../../../db/async-sqlite';
import { PreferencesRepository } from '../repository';

let sqlite: Database;
let repo: PreferencesRepository;
const USER = 'u-100';

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqlite, m);
  sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    USER,
    'u100@example.com',
    'U 100',
  ]);
  repo = new PreferencesRepository(openAsyncDatabase(sqlite).db);
  await repo.getOrCreate(USER);
});
afterEach(() => sqlite.close());

function backupConfig(): Record<string, unknown> {
  const row = sqlite
    .query('SELECT backup_config AS c FROM user_preferences WHERE user_id = ?')
    .get(USER) as { c: string | null };
  return row.c ? JSON.parse(row.c) : {};
}

describe('mergeJsonField — atomic deep-merge', () => {
  test('deep-merges a nested partial; sibling keys and nested fields survive', async () => {
    await repo.mergeJsonField(USER, 'backupConfig', {
      providers: { p1: { enabled: true, folderPath: '/A' } },
    });
    await repo.mergeJsonField(USER, 'backupConfig', {
      providers: { p2: { enabled: false, folderPath: '/B' } },
    });
    const cfg = backupConfig() as { providers: Record<string, unknown> };
    expect(cfg.providers.p1).toEqual({ enabled: true, folderPath: '/A' });
    expect(cfg.providers.p2).toEqual({ enabled: false, folderPath: '/B' });
  });

  test('a null patch value deletes the key without touching siblings', async () => {
    await repo.mergeJsonField(USER, 'backupConfig', {
      providers: { p1: { enabled: true }, p2: { enabled: true } },
    });
    await repo.mergeJsonField(USER, 'backupConfig', { providers: { p1: null } });
    const cfg = backupConfig() as { providers: Record<string, unknown> };
    expect(cfg.providers.p1).toBeUndefined();
    expect(cfg.providers.p2).toEqual({ enabled: true });
  });

  test('two concurrent delta-merges both survive', async () => {
    await repo.mergeJsonField(USER, 'backupConfig', { providers: { base: { enabled: true } } });

    await Promise.all([
      repo.mergeJsonField(USER, 'backupConfig', { providers: { reqA: { enabled: true } } }),
      repo.mergeJsonField(USER, 'backupConfig', { providers: { reqB: { enabled: false } } }),
    ]);

    const cfg = backupConfig() as { providers: Record<string, unknown> };
    expect(Object.keys(cfg.providers).sort()).toEqual(['base', 'reqA', 'reqB']);

    const stale = { providers: { base: { enabled: true } } };
    const rmwA = { providers: { ...stale.providers, reqA: { enabled: true } } };
    const rmwB = { providers: { ...stale.providers, reqB: { enabled: false } } };
    const lastWriterWins = rmwB;
    expect(Object.keys(lastWriterWins.providers)).not.toContain('reqA');
    void rmwA;
  });
});

describe('mergeJsonField — defaults only for missing entries', () => {
  const defaults = { enabled: false, folderPath: 'Backups', retentionCount: 10 };
  const addMissing = (ids: string[]) => ({
    parent: 'providers',
    entries: Object.fromEntries(ids.map((id) => [id, defaults])),
  });

  test('a missing entry gets the defaults under the patch; a saved one keeps its own values', async () => {
    await repo.mergeJsonField(USER, 'backupConfig', {
      providers: { saved: { enabled: true, folderPath: 'Mine', retentionCount: 3 } },
    });

    await repo.mergeJsonField(
      USER,
      'backupConfig',
      { providers: { saved: { lastBackupAt: 't1' }, fresh: { lastBackupAt: 't1' } } },
      addMissing(['saved', 'fresh'])
    );

    const cfg = backupConfig() as { providers: Record<string, unknown> };
    expect(cfg.providers.saved).toEqual({
      enabled: true,
      folderPath: 'Mine',
      retentionCount: 3,
      lastBackupAt: 't1',
    });
    expect(cfg.providers.fresh).toEqual({ ...defaults, lastBackupAt: 't1' });
  });

  test('works when nothing has been saved yet, and with ids that need quoting', async () => {
    const odd = 'a."b\'c';
    await repo.mergeJsonField(
      USER,
      'backupConfig',
      { providers: { [odd]: { lastBackupAt: 't1' } } },
      addMissing([odd])
    );

    const cfg = backupConfig() as { providers: Record<string, unknown> };
    expect(cfg.providers).toEqual({ [odd]: { ...defaults, lastBackupAt: 't1' } });
  });

  test('a settings save landing just before or just after the backup write is kept', async () => {
    const mine = { enabled: true, folderPath: 'Mine', retentionCount: 3 };
    const backup = () =>
      repo.mergeJsonField(
        USER,
        'backupConfig',
        { providers: { p: { lastBackupAt: 't1' } } },
        addMissing(['p'])
      );
    const save = () => repo.mergeJsonField(USER, 'backupConfig', { providers: { p: mine } });

    await Promise.all([save(), backup()]);
    expect((backupConfig() as { providers: Record<string, unknown> }).providers.p).toEqual({
      ...mine,
      lastBackupAt: 't1',
    });

    await repo.mergeJsonField(USER, 'backupConfig', { providers: { p: null } });
    await Promise.all([backup(), save()]);
    expect((backupConfig() as { providers: Record<string, unknown> }).providers.p).toEqual({
      ...mine,
      lastBackupAt: 't1',
    });
  });
});
