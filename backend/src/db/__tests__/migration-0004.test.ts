import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0004: user emails are stored lowercased', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 3);
  });

  afterEach(() => {
    db.close();
  });

  function emails(): string[] {
    return (db.query('SELECT email FROM users ORDER BY id').all() as { email: string }[]).map(
      (row) => row.email
    );
  }

  test('lowercases every email and keeps the rest of the data', () => {
    seedCoreData(db);
    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u2', 'Mixed.Case@Example.com', 'B')"
    );
    const before = countRows(db, 'expenses');

    applyMigration(db, migrations[4]);

    expect(emails()).toEqual([expect.any(String), 'mixed.case@example.com']);
    expect(emails().every((email) => email === email.toLowerCase())).toBe(true);
    expect(countRows(db, 'users')).toBe(2);
    expect(countRows(db, 'expenses')).toBe(before);
  });

  test('stops with a clear message and changes nothing when two emails differ only by case', () => {
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'twin@example.com', 'A')");
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'Twin@Example.com', 'B')");
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u3', 'Other@Example.com', 'C')");

    expect(() => applyMigration(db, migrations[4])).toThrow(
      /some accounts have emails that differ only by letter case\. Nothing was changed/
    );

    expect(emails()).toEqual(['twin@example.com', 'Twin@Example.com', 'Other@Example.com']);
    expect(
      db.query("SELECT name FROM sqlite_temp_master WHERE name LIKE '__email_case%'").all()
    ).toEqual([]);
  });

  test('runs cleanly on an empty users table', () => {
    applyMigration(db, migrations[4]);
    expect(countRows(db, 'users')).toBe(0);
  });
});

describe('Migration 0004 through the drizzle migrator', () => {
  const MIGRATIONS_FOLDER = join(import.meta.dir, '../../../drizzle');
  let workDir: string;
  let sqlite: Database;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'vroom-migration-0004-'));
    sqlite = new Database(join(workDir, 'vroom.db'));
    sqlite.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    sqlite.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  function migrationsStoppingAt(lastIdx: number): string {
    const folder = join(workDir, 'drizzle');
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, lastIdx + 1);
    writeFileSync(journalPath, JSON.stringify(journal));
    return folder;
  }

  test('refuses case-variant emails, rolls back cleanly, and applies once one is renamed', () => {
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsStoppingAt(3) });
    expect(countRows(sqlite, '__drizzle_migrations')).toBe(4);
    sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u1', 'pair@example.com', 'A')"
    );
    sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u2', 'Pair@Example.com', 'B')"
    );

    let failure: unknown;
    try {
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(`${(failure as Error).message} ${(failure as Error).cause}`).toContain(
      'Migration 0004_lowercase_user_emails stopped'
    );
    expect(countRows(sqlite, '__drizzle_migrations')).toBe(4);
    expect(
      sqlite.query("SELECT name FROM sqlite_temp_master WHERE name LIKE '__email_case%'").all()
    ).toEqual([]);

    sqlite.run("UPDATE users SET email = 'pair.two@example.com' WHERE id = 'u2'");
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(countRows(sqlite, '__drizzle_migrations')).toBe(loadMigrations().length);
  });
});
