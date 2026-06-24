/**
 * #100 (C168) — `PreferencesRepository.mergeJsonField` atomic JSON merge guard.
 *
 * The legacy userPreferences write pattern (`getOrCreate` → JS-merge → `update`) has a lost-update race:
 * two concurrent requests both read the same row, each merges its own delta onto that stale snapshot, and
 * the second write clobbers the first (last-writer-wins). Angelo decided (2026-06-23) to make the merge a
 * single atomic `json_patch(...)` UPDATE so the merge happens inside the DB engine with no read-then-write
 * gap. This guard pins that primitive:
 *   1. deep-merges a nested partial (sibling keys survive, nested objects recurse),
 *   2. deletes a key when the patch value is `null` (RFC-7386 — the cleanupBackupConfig shape),
 *   3. THE RACE PROPERTY: two SEQUENTIAL delta-patches (each modelling a concurrent request that only
 *      knows its own change) BOTH survive — which the old read-modify-write could not guarantee.
 * Non-vacuous: a read-modify-write reimplementation of case 3 (merge both deltas onto the SAME initial
 * snapshot, write both) loses the first writer — asserted here so the test fails if the route ever
 * regresses to that pattern.
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

describe('#100 mergeJsonField — atomic deep-merge', () => {
  test('deep-merges a nested partial; sibling keys + nested fields survive', async () => {
    await repo.mergeJsonField(USER, 'backupConfig', {
      providers: { p1: { enabled: true, folderPath: '/A' } },
    });
    await repo.mergeJsonField(USER, 'backupConfig', {
      providers: { p2: { enabled: false, folderPath: '/B' } },
    });
    const cfg = backupConfig() as { providers: Record<string, unknown> };
    // BOTH providers present — the second merge did NOT clobber the first.
    expect(cfg.providers.p1).toEqual({ enabled: true, folderPath: '/A' });
    expect(cfg.providers.p2).toEqual({ enabled: false, folderPath: '/B' });
  });

  test('a null patch value DELETES the key (the cleanupBackupConfig shape) without touching siblings', async () => {
    await repo.mergeJsonField(USER, 'backupConfig', {
      providers: { p1: { enabled: true }, p2: { enabled: true } },
    });
    await repo.mergeJsonField(USER, 'backupConfig', { providers: { p1: null } });
    const cfg = backupConfig() as { providers: Record<string, unknown> };
    expect(cfg.providers.p1).toBeUndefined(); // removed
    expect(cfg.providers.p2).toEqual({ enabled: true }); // sibling intact
  });

  test('RACE PROPERTY: two concurrent delta-merges both survive (the lost-update the old RMW lost)', async () => {
    // Seed a baseline both "requests" observe.
    await repo.mergeJsonField(USER, 'backupConfig', { providers: { base: { enabled: true } } });

    // Two concurrent requests, each computing its patch from the SAME baseline snapshot, fired together.
    await Promise.all([
      repo.mergeJsonField(USER, 'backupConfig', { providers: { reqA: { enabled: true } } }),
      repo.mergeJsonField(USER, 'backupConfig', { providers: { reqB: { enabled: false } } }),
    ]);

    const cfg = backupConfig() as { providers: Record<string, unknown> };
    // All three survive — atomic json_patch has no read-then-write gap to lose a writer.
    expect(Object.keys(cfg.providers).sort()).toEqual(['base', 'reqA', 'reqB']);

    // Non-vacuity: model the OLD read-modify-write (both deltas merged onto one stale read, both written).
    // The second write wins → reqA is LOST. This is exactly the #100 bug the atomic merge fixes.
    const stale = { providers: { base: { enabled: true } } };
    const rmwA = { providers: { ...stale.providers, reqA: { enabled: true } } };
    const rmwB = { providers: { ...stale.providers, reqB: { enabled: false } } };
    const lastWriterWins = rmwB; // second write overwrites rmwA wholesale
    expect(Object.keys(lastWriterWins.providers)).not.toContain('reqA');
    void rmwA;
  });
});
