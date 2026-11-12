import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { applyMigration, countRows, getTables, loadMigrations } from './migration-helpers';

const MIGRATIONS_FOLDER = join(import.meta.dir, '../../../drizzle');

function freshDb(): Database {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  return sqlite;
}

describe('startup migrations', () => {
  test('re-running migrations on an up-to-date database is a no-op', () => {
    const sqlite = freshDb();
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const appliedOnce = countRows(sqlite, '__drizzle_migrations');
    const tablesOnce = getTables(sqlite);

    expect(() => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })).not.toThrow();
    expect(countRows(sqlite, '__drizzle_migrations')).toBe(appliedOnce);
    expect(getTables(sqlite)).toEqual(tablesOnce);
    sqlite.close();
  });

  test('a database with tables but no migration history fails instead of being accepted', () => {
    const sqlite = freshDb();
    const [baseline] = loadMigrations();
    if (!baseline) throw new Error('no baseline migration found');
    applyMigration(sqlite, baseline);

    let failure: unknown;
    try {
      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error).cause)).toContain('already exists');
    sqlite.close();
  });
});
