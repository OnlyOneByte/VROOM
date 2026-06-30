/**
 * Migration 0006: add `user_preferences.theme_preference` (theming-engine spec T1, D2).
 *
 * A fully ADDITIVE column: `text NOT NULL DEFAULT 'default'`. The theming engine's contract is that
 * `'default'` reproduces today's look byte-for-byte, so an existing user's row must backfill to
 * `'default'` (no visual change, no NULL, no NOT-NULL violation on the rebuild-free ALTER). These tests
 * are the T1 proof gate: the column exists with the right shape on a fresh apply, and a pre-0006
 * user_preferences row survives the migration with the new column backfilled to 'default'.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0006: user_preferences.theme_preference (theming-engine T1)', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('adds theme_preference to user_preferences', () => {
    applyMigrationsUpTo(db, migrations, 6);
    expect(getColumnNames(db, 'user_preferences')).toContain('theme_preference');
  });

  test('theme_preference is NOT NULL with default "default"', () => {
    applyMigrationsUpTo(db, migrations, 6);
    const col = (
      db.query(`PRAGMA table_info('user_preferences')`).all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[]
    ).find((c) => c.name === 'theme_preference');
    expect(col?.notnull).toBe(1); // NOT NULL
    expect(col?.dflt_value).toBe("'default'"); // SQLite reports the default literal with quotes
  });

  test("an existing user_preferences row backfills theme_preference to 'default'", () => {
    // Seed at the pre-0006 state (migrations 0..5), insert a prefs row (only user_id is required —
    // every other column has a default), then apply 0006 and assert the new column backfilled.
    applyMigrationsUpTo(db, migrations, 5);
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };
    db.run('INSERT INTO user_preferences (user_id) VALUES (?)', [user.id]);
    expect(countRows(db, 'user_preferences')).toBe(1);

    applyMigration(db, migrations[6]);

    // The row survives and the additive column is backfilled to the engine's identity theme.
    expect(countRows(db, 'user_preferences')).toBe(1);
    const row = db
      .query('SELECT user_id, theme_preference FROM user_preferences WHERE user_id = ?')
      .get(user.id) as { user_id: string; theme_preference: string };
    expect(row.user_id).toBe(user.id);
    expect(row.theme_preference).toBe('default');
  });

  test("a new insert after 0006 omitting theme_preference takes the 'default'", () => {
    applyMigrationsUpTo(db, migrations, 6);
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };
    db.run('INSERT INTO user_preferences (user_id) VALUES (?)', [user.id]);
    const row = db
      .query('SELECT theme_preference FROM user_preferences WHERE user_id = ?')
      .get(user.id) as { theme_preference: string };
    expect(row.theme_preference).toBe('default');
  });
});
