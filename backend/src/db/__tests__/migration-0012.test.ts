/**
 * Migration 0012: add `expenses.location`.
 *
 * A single additive, nullable `text` column — no backfill, no table rebuild. The test pins the
 * column's shape (nullable, no default, so existing rows read NULL rather than an empty string) and
 * that applying it over populated data preserves every row.
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

describe('Migration 0012: expenses.location', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('adds location to expenses', () => {
    applyMigrationsUpTo(db, migrations, 12);
    expect(getColumnNames(db, 'expenses')).toContain('location');
  });

  test('location is nullable text with no default', () => {
    applyMigrationsUpTo(db, migrations, 12);
    const col = (
      db.query("PRAGMA table_info('expenses')").all() as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }[]
    ).find((c) => c.name === 'location');
    expect(col?.type.toUpperCase()).toBe('TEXT');
    expect(col?.notnull).toBe(0);
    expect(col?.dflt_value).toBeNull();
  });

  test('a pre-0012 expense survives and reads NULL for location', () => {
    applyMigrationsUpTo(db, migrations, 11);
    seedCoreData(db); // u1 + v1 + e1
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[12]);

    expect(countRows(db, 'expenses')).toBe(1);
    const row = db.query("SELECT expense_amount, location FROM expenses WHERE id = 'e1'").get() as {
      expense_amount: number;
      location: string | null;
    };
    expect(row.location).toBeNull();
    expect(row.expense_amount).toBe(45.5); // the row is untouched, not rebuilt

    const scaffold = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__new_%'")
      .all() as { name: string }[];
    expect(scaffold.length).toBe(0);
  });

  test('a location can be written and read back', () => {
    applyMigrationsUpTo(db, migrations, 12);
    seedCoreData(db);
    db.run("UPDATE expenses SET location = 'Shell, 5th & Main' WHERE id = 'e1'");
    const row = db.query("SELECT location FROM expenses WHERE id = 'e1'").get() as {
      location: string;
    };
    expect(row.location).toBe('Shell, 5th & Main');
  });
});
