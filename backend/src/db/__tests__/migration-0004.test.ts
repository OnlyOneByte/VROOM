import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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
