import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { createTestApp } from '../../test-helpers/http-client';
import { foldUserEmailCase, runMigrations } from '../connection';
import * as schema from '../schema';
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

describe('startup email case fold', () => {
  function migratedDb() {
    const sqlite = freshDb();
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return { sqlite, db };
  }

  function addUser(sqlite: Database, id: string, email: string): void {
    sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [id, email, id]);
  }

  function emails(sqlite: Database): string[] {
    return (sqlite.query('SELECT email FROM users ORDER BY id').all() as { email: string }[]).map(
      (row) => row.email
    );
  }

  test('a non-ASCII case clash stops startup, lists the user ids, and changes nothing', () => {
    const { sqlite, db } = migratedDb();
    addUser(sqlite, 'u1', 'élüse@example.com');
    addUser(sqlite, 'u2', 'Élüse@example.com');
    addUser(sqlite, 'u3', 'ÖMER@example.com');
    addUser(sqlite, 'u4', 'élÜse@example.com');

    expect(() => foldUserEmailCase(db)).toThrow(
      /differ only by letter case\. No email was changed.*all but one id.*u1, u2, u4/
    );
    expect(emails(sqlite)).toEqual([
      'élüse@example.com',
      'Élüse@example.com',
      'ÖMER@example.com',
      'élÜse@example.com',
    ]);
    sqlite.close();
  });

  test('without a clash, every email is folded the way signup folds it, in one transaction', () => {
    const { sqlite, db } = migratedDb();
    addUser(sqlite, 'u1', 'ÉLODIE@example.com');
    addUser(sqlite, 'u2', 'ÖMER@example.com');
    addUser(sqlite, 'u3', 'plain@example.com');

    foldUserEmailCase(db);
    expect(emails(sqlite)).toEqual(['élodie@example.com', 'ömer@example.com', 'plain@example.com']);

    addUser(sqlite, 'u4', 'ZOË@example.com');
    addUser(sqlite, 'u5', 'ŁUKASZ@example.com');
    sqlite.run(
      "CREATE TEMP TRIGGER reject_u5 BEFORE UPDATE ON users WHEN OLD.id = 'u5' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END"
    );
    expect(() => foldUserEmailCase(db)).toThrow(/simulated failure/);
    expect(emails(sqlite).slice(3)).toEqual(['ZOË@example.com', 'ŁUKASZ@example.com']);
    sqlite.close();
  });

  test('running it twice changes nothing the second time', () => {
    const { sqlite, db } = migratedDb();
    addUser(sqlite, 'u1', 'ÉLODIE@example.com');
    foldUserEmailCase(db);
    const once = sqlite.query('SELECT id, email, updated_at FROM users ORDER BY id').all();
    const changesBefore = sqlite.query('SELECT total_changes() AS n').get();

    foldUserEmailCase(db);

    expect(sqlite.query('SELECT id, email, updated_at FROM users ORDER BY id').all()).toEqual(once);
    expect(sqlite.query('SELECT total_changes() AS n').get()).toEqual(changesBefore);
    sqlite.close();
  });

  test('runMigrations runs the fold on the app database, and refuses to start on a clash', async () => {
    const ctx = await createTestApp();
    try {
      addUser(ctx.sqlite, 'fold-a', 'ÉMILE@example.com');
      runMigrations();
      expect(
        ctx.sqlite.query("SELECT email FROM users WHERE id = 'fold-a'").get() as { email: string }
      ).toEqual({ email: 'émile@example.com' });

      addUser(ctx.sqlite, 'fold-b', 'Émile@example.com');
      expect(() => runMigrations()).toThrow(/differ only by letter case.*fold-a, fold-b/);
    } finally {
      ctx.sqlite.run("DELETE FROM users WHERE id IN ('fold-a', 'fold-b')");
      ctx.close();
    }
  });
});
