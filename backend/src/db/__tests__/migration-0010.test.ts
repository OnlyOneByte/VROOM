import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0010: community stats consent and region', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 9);
  });

  afterEach(() => {
    db.close();
  });

  test('adds the consent columns with every existing user opted out', () => {
    seedCoreData(db);
    db.run("INSERT INTO user_preferences (user_id, currency_unit) VALUES ('u1', 'EUR')");

    applyMigration(db, migrations[10]);

    const columns = getColumnNames(db, 'user_preferences');
    expect(columns).toContain('community_stats_opt_in');
    expect(columns).toContain('community_stats_consented_at');
    expect(columns).toContain('community_region');
    expect(
      db
        .query(
          "SELECT currency_unit, community_stats_opt_in, community_stats_consented_at, community_region FROM user_preferences WHERE user_id = 'u1'"
        )
        .get()
    ).toEqual({
      currency_unit: 'EUR',
      community_stats_opt_in: 0,
      community_stats_consented_at: null,
      community_region: null,
    });
  });
});
