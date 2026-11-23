import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0009: users can pick a default provider per capability', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 8);
  });

  afterEach(() => {
    db.close();
  });

  test('adds provider_defaults and keeps existing preferences', () => {
    seedCoreData(db);
    db.run("INSERT INTO user_preferences (user_id, currency_unit) VALUES ('u1', 'EUR')");

    applyMigration(db, migrations[9]);

    expect(getColumnNames(db, 'user_preferences')).toContain('provider_defaults');
    expect(
      db
        .query("SELECT currency_unit, provider_defaults FROM user_preferences WHERE user_id = 'u1'")
        .get()
    ).toEqual({ currency_unit: 'EUR', provider_defaults: '{}' });
  });
});
