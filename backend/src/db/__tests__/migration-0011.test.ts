/**
 * Migration 0011: expenses.created_by (vehicle-sharing T5b; Angelo ruled option (a) owner-stamp +
 * createdBy 2026-06-27).
 *
 * Purely ADDITIVE — a single `ALTER TABLE expenses ADD created_by text REFERENCES users(id)`, the
 * 0003/0007/0008/0010 additive class (no backfill, no table rebuild). The column records the row's
 * actual AUTHOR; it differs from `user_id` only for an editor-created shared row (createdBy = editor,
 * userId = vehicle owner — the owner-stamp model in design.md §2.1). NULL = legacy/self-created.
 *
 * This test is the proof gate that 0011 is additive AND that the column behaves as designed:
 *   - the column exists after the migration and is NULLABLE (legacy rows + the sentinel),
 *   - an existing expense row survives applying 0011 with created_by = NULL (additive, no rebuild,
 *     no __new_* scaffold — the C15/migration-0004 cascade-wipe footgun the 0010 test also pins),
 *   - created_by can be stamped with a DIFFERENT user than user_id (the editor-on-shared-vehicle case),
 *   - created_by is nullable on insert (the standalone/self-created path leaves it NULL).
 *
 * foreign_keys = ON reproduces production.
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

describe('Migration 0011: expenses.created_by (additive provenance column)', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('adds the created_by column to expenses', () => {
    applyMigrationsUpTo(db, migrations, 11);
    expect(getColumnNames(db, 'expenses')).toContain('created_by');
  });

  test('created_by is NULLABLE — an insert may omit it (legacy/self-created sentinel)', () => {
    applyMigrationsUpTo(db, migrations, 11);
    seedCoreData(db); // inserts e1 with NO created_by → must succeed
    const row = db.query("SELECT created_by FROM expenses WHERE id = 'e1'").get() as {
      created_by: string | null;
    };
    expect(row.created_by).toBeNull();
  });

  test('created_by can be stamped with a DIFFERENT user than user_id (editor-on-shared-vehicle)', () => {
    applyMigrationsUpTo(db, migrations, 11);
    // Owner u1 + vehicle v1 (seedCoreData), plus an editor u2 who logs a cost on v1.
    seedCoreData(db);
    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u2', 'editor@example.com', 'Editor')"
    );
    // Owner-stamp model: the row belongs to the OWNER (user_id = u1) but was authored by the editor.
    db.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, created_by, category, date, expense_amount)
       VALUES ('e2', 'v1', 'u1', 'u2', 'fuel', 1700000000, 5000)`
    );
    const row = db.query("SELECT user_id, created_by FROM expenses WHERE id = 'e2'").get() as {
      user_id: string;
      created_by: string;
    };
    expect(row.user_id).toBe('u1'); // owner
    expect(row.created_by).toBe('u2'); // actual author
  });

  test('0011 is additive — applying it preserves existing expense rows (no table rebuild)', () => {
    // Seed at the pre-0011 state (0..10), then apply 0011 and assert the core graph survived.
    applyMigrationsUpTo(db, migrations, 10);
    seedCoreData(db); // u1 + v1 + e1 (no created_by column yet)
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[11]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);
    // The pre-existing row gains created_by = NULL (the additive default), not a dropped/rebuilt row.
    const survived = db.query("SELECT created_by FROM expenses WHERE id = 'e1'").get() as {
      created_by: string | null;
    };
    expect(survived.created_by).toBeNull();
    // No leftover drizzle rebuild scaffolding (the __new_* holding tables a bundled rebuild would leave).
    const scaffold = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__new_%'")
      .all() as { name: string }[];
    expect(scaffold.length).toBe(0);
  });
});
