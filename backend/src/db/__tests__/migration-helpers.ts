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

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface SnapshotFile {
  /** Numeric prefix of the snapshot file name (`0012_snapshot.json` -> 12). */
  idx: number;
  file: string;
  id: string;
  prevId: string;
}

/** A table as drizzle-kit records it in a snapshot: tables and columns are keyed by SQL name. */
export interface SnapshotTable {
  name: string;
  columns: Record<string, { name: string; type: string; notNull?: boolean; primaryKey?: boolean }>;
  indexes?: Record<string, unknown>;
}

/** A snapshot with its schema payload, not just its chain links. */
export interface SnapshotContent extends SnapshotFile {
  tables: Record<string, SnapshotTable>;
}

const META_DIR = join(MIGRATIONS_DIR, 'meta');

/**
 * Snapshot file names in the lexicographic order drizzle-kit itself uses: it sorts the directory
 * listing and treats the LAST entry as the baseline for the next diff.
 */
function snapshotFileNames(): string[] {
  return readdirSync(META_DIR)
    .filter((f) => !f.startsWith('_') && f.endsWith('.json'))
    .sort();
}

function snapshotIdx(file: string): number {
  const match = file.match(/^(\d+)_/);
  return match ? Number.parseInt(match[1], 10) : -1;
}

/** Read `drizzle/meta/_journal.json` — the ordered list the runtime migrator walks. */
export function loadJournal(): { version: string; dialect: string; entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(META_DIR, '_journal.json'), 'utf-8'));
}

/** Read every snapshot's chain links (`id`/`prevId`), in drizzle-kit's own order. */
export function loadSnapshots(): SnapshotFile[] {
  return snapshotFileNames().map((file) => {
    const raw = JSON.parse(readFileSync(join(META_DIR, file), 'utf-8')) as {
      id: string;
      prevId: string;
    };
    return { idx: snapshotIdx(file), file, id: raw.id, prevId: raw.prevId };
  });
}

/**
 * Read the snapshot drizzle-kit will diff `schema.ts` against on the next `db:generate`, schema
 * payload included — a stale head snapshot has the right NAME and the wrong CONTENT, so only the
 * content can catch it.
 */
export function loadHeadSnapshot(): SnapshotContent {
  const names = snapshotFileNames();
  const file = names[names.length - 1];
  if (!file) {
    throw new Error(`No snapshot files in ${META_DIR}`);
  }
  const raw = JSON.parse(readFileSync(join(META_DIR, file), 'utf-8')) as {
    id: string;
    prevId: string;
    tables: Record<string, SnapshotTable>;
  };
  return { idx: snapshotIdx(file), file, id: raw.id, prevId: raw.prevId, tables: raw.tables };
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

/** Split a migration into statements on Drizzle's `--> statement-breakpoint` markers. */
export function splitStatements(migration: MigrationFile): string[] {
  return migration.sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Statements that move the schema drizzle-kit snapshots, as opposed to the rows inside it. */
const DDL_STATEMENT =
  /^(CREATE|ALTER|DROP)\s+(UNIQUE\s+|VIRTUAL\s+|TEMP(ORARY)?\s+)*(TABLE|INDEX|VIEW|TRIGGER)\b/i;

/**
 * Does this migration change the schema, or only the rows?
 *
 * Only a schema change needs a snapshot of its own: a data-only migration (0009 is the repo's
 * precedent — fourteen `UPDATE`s, no DDL) leaves the previous snapshot an accurate description of
 * the database, so drizzle-kit neither writes nor needs a new one.
 */
export function migrationChangesSchema(migration: MigrationFile): boolean {
  return splitStatements(migration).some((statement) =>
    DDL_STATEMENT.test(statement.replace(/^(--[^\n]*\n|\s)+/, ''))
  );
}

/**
 * Apply a single migration file to the database.
 * Splits on Drizzle's `--> statement-breakpoint` markers.
 */
export function applyMigration(db: Database, migration: MigrationFile): void {
  const statements = splitStatements(migration);

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
    "INSERT INTO users (id, email, display_name) VALUES ('u1', 'test@example.com', 'Test User')"
  );
  db.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
  );
  db.run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('e1', 'v1', 'u1', 'fuel', 1700000000, 45.50)"
  );
}
