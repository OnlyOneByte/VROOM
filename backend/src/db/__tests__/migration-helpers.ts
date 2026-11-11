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
  idx: number;
  file: string;
  id: string;
  prevId: string;
}

export interface SnapshotTable {
  name: string;
  columns: Record<string, { name: string; type: string; notNull?: boolean; primaryKey?: boolean }>;
  indexes?: Record<string, unknown>;
}

export interface SnapshotContent extends SnapshotFile {
  tables: Record<string, SnapshotTable>;
}

const META_DIR = join(MIGRATIONS_DIR, 'meta');

// drizzle-kit sorts snapshot names and diffs against the last one, so this order is load-bearing.
function snapshotFileNames(): string[] {
  return readdirSync(META_DIR)
    .filter((f) => !f.startsWith('_') && f.endsWith('.json'))
    .sort();
}

function snapshotIdx(file: string): number {
  const match = file.match(/^(\d+)_/);
  return match ? Number.parseInt(match[1], 10) : -1;
}

export function loadJournal(): { version: string; dialect: string; entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(META_DIR, '_journal.json'), 'utf-8'));
}

export function loadSnapshots(): SnapshotFile[] {
  return snapshotFileNames().map((file) => {
    const raw = JSON.parse(readFileSync(join(META_DIR, file), 'utf-8')) as {
      id: string;
      prevId: string;
    };
    return { idx: snapshotIdx(file), file, id: raw.id, prevId: raw.prevId };
  });
}

// Content matters here: a stale head snapshot keeps the right file name and only the payload reveals it.
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

export function splitStatements(migration: MigrationFile): string[] {
  return migration.sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

const DDL_STATEMENT =
  /^(CREATE|ALTER|DROP)\s+(UNIQUE\s+|VIRTUAL\s+|TEMP(ORARY)?\s+)*(TABLE|INDEX|VIEW|TRIGGER)\b/i;

// Only DDL changes the snapshotted schema. Data-only migrations need no snapshot of their own.
export function migrationChangesSchema(migration: MigrationFile): boolean {
  return splitStatements(migration).some((statement) =>
    DDL_STATEMENT.test(statement.replace(/^(--[^\n]*\n|\s)+/, ''))
  );
}

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

export function applyMigrationsUpTo(
  db: Database,
  migrations: MigrationFile[],
  upToIndex: number
): void {
  for (let i = 0; i <= upToIndex; i++) {
    applyMigration(db, migrations[i]);
  }
}

export function getTables(db: Database): string[] {
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return rows.map((r) => r.name).sort();
}

export function getColumnNames(db: Database, table: string): string[] {
  const cols = db.query(`PRAGMA table_info('${table}')`).all() as { name: string }[];
  return cols.map((c) => c.name);
}

export function getIndexNames(db: Database, table: string): string[] {
  const indexes = db.query(`PRAGMA index_list('${table}')`).all() as { name: string }[];
  return indexes.map((i) => i.name);
}

export function countRows(db: Database, table: string): number {
  const result = db.query(`SELECT COUNT(*) as count FROM '${table}'`).get() as { count: number };
  return result.count;
}

// expense_amount is integer cents (4550 = $45.50). A float would be stored as REAL without error.
export function seedCoreData(db: Database): void {
  db.run(
    "INSERT INTO users (id, email, display_name) VALUES ('u1', 'test@example.com', 'Test User')"
  );
  db.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
  );
  db.run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('e1', 'v1', 'u1', 'fuel', 1700000000, 4550)"
  );
}
