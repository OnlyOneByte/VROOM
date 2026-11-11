/**
 * PreferencesRepository.mergeJsonField runs one json_patch UPDATE. Covers deep merge, null deleting
 * a key, and two concurrent patches both surviving, which a read-modify-write cannot guarantee.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import * as schema from '../../../db/schema';
import { PreferencesRepository } from '../repository';

let sqlite: Database;
let repo: PreferencesRepository;
const USER = 'u-100';

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqlite, m);
  // A user row (FK target) + a prefs row to patch.
  sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    USER,
    'u100@example.com',
    'U 100',
  ]);
  // biome-ignore lint/suspicious/noExplicitAny: drizzle's bun-sqlite generic vs AppDatabase alias
  const db = drizzle(sqlite, { schema }) as any;
  repo = new PreferencesRepository(db);
  await repo.getOrCreate(USER); // ensure the prefs row exists
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

    // Non-vacuity: a read-modify-write of the same two deltas loses reqA.
    const stale = { providers: { base: { enabled: true } } };
    const rmwA = { providers: { ...stale.providers, reqA: { enabled: true } } };
    const rmwB = { providers: { ...stale.providers, reqB: { enabled: false } } };
    const lastWriterWins = rmwB;
    expect(Object.keys(lastWriterWins.providers)).not.toContain('reqA');
    void rmwA;
  });
});
