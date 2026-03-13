/**
 * Shared helpers for migration integration tests.
 *
 * Provides utilities to load, apply, and inspect migrations against
 * an in-memory SQLite database.
 */

import type { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '../../../drizzle');

export interface MigrationFile {
  idx: number;
  tag: string;
  path: string;
  sql: string;
}

/** Read and sort all migration SQL files from the drizzle folder. */
export function loadMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  return files
    .map((f) => {
      const match = f.match(/^(\d+)_/);
      return {
        idx: match ? Number.parseInt(match[1], 10) : 0,
        tag: f.replace('.sql', ''),
        path: join(MIGRATIONS_DIR, f),
        sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'),
      };
    })
    .sort((a, b) => a.idx - b.idx);
}

/**
 * Apply a single migration file to the database.
 * Splits on Drizzle's `--> statement-breakpoint` markers.
 */
export function applyMigration(db: Database, migration: MigrationFile): void {
  const statements = migration.sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  db.run('BEGIN');
  try {
    for (const stmt of statements) {
      db.run(stmt);
    }
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw new Error(
      `Migration ${migration.tag} failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Apply migrations 0 through `upToIndex` (inclusive). */
export function applyMigrationsUpTo(
  db: Database,
  migrations: MigrationFile[],
  upToIndex: number
): void {
  for (let i = 0; i <= upToIndex; i++) {
    applyMigration(db, migrations[i]);
  }
}

/** Get all table names in the database. */
export function getTables(db: Database): string[] {
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return rows.map((r) => r.name).sort();
}

/** Get column names for a table. */
export function getColumnNames(db: Database, table: string): string[] {
  const cols = db.query(`PRAGMA table_info('${table}')`).all() as { name: string }[];
  return cols.map((c) => c.name);
}

/** Get index names for a table. */
export function getIndexNames(db: Database, table: string): string[] {
  const indexes = db.query(`PRAGMA index_list('${table}')`).all() as { name: string }[];
  return indexes.map((i) => i.name);
}

/** Count rows in a table. */
export function countRows(db: Database, table: string): number {
  const result = db.query(`SELECT COUNT(*) as count FROM '${table}'`).get() as { count: number };
  return result.count;
}

/** Seed a minimal user + vehicle + expense for data survival tests. */
export function seedCoreData(db: Database): void {
  db.run(
    "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'gid-123')"
  );
  db.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
  );
  db.run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('e1', 'v1', 'u1', 'fuel', 1700000000, 45.50)"
  );
}
