import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '../schema';
import {
  applyMigration,
  countRows,
  getTables,
  loadHeadSnapshot,
  loadJournal,
  loadMigrations,
  loadSnapshots,
  migrationChangesSchema,
  seedCoreData,
} from './migration-helpers';

const schemaColumns = new Map(
  Object.values<unknown>(schema)
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .map((table) => {
      const { name, columns } = getTableConfig(table);
      return [name, columns.map((column) => column.name).sort()] as const;
    })
);
const schemaTables = [...schemaColumns.keys()].sort();

// Type drift makes drizzle-kit emit a table rebuild that drops rows; index drift emits a CREATE INDEX that fails on existing installs.
const schemaShapes = new Map(
  Object.values<unknown>(schema)
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .map((table) => {
      const { name, columns, indexes } = getTableConfig(table);
      return [
        name,
        {
          columns: Object.fromEntries(
            columns.map((column) => [
              column.name,
              { type: column.getSQLType(), notNull: column.notNull, primaryKey: column.primary },
            ])
          ),
          indexes: [
            ...indexes.map((index) => index.config.name),
            ...columns.filter((column) => column.isUnique).map((column) => column.uniqueName),
          ]
            .filter((indexName): indexName is string => Boolean(indexName))
            .sort(),
        },
      ] as const;
    })
);

// Frozen: the migrator replays entries whose `when` exceeds the newest recorded one, so shipped rows must not change.
const SHIPPED_JOURNAL: readonly { idx: number; tag: string; when: number }[] = [
  { idx: 0, tag: '0000_baseline', when: 1794413530056 },
];

describe('Migrations: General', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('all migration files are loadable and non-empty', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    for (const m of migrations) {
      expect(m.sql.length).toBeGreaterThan(0);
    }
  });

  test('the schema-derived table and column lists are populated', () => {
    expect(schemaTables.length).toBeGreaterThanOrEqual(21);
    expect(schemaTables).toContain('users');
    expect(schemaColumns.get('users')).toContain('email');
  });

  test('all migrations apply cleanly in sequence and produce exactly the schema tables', () => {
    for (const migration of migrations) {
      applyMigration(db, migration);
    }

    expect(getTables(db)).toEqual(schemaTables);
  });

  test('every migration has its own migration-NNNN test file', () => {
    const covered = new Set(
      readdirSync(import.meta.dir)
        .map((file) => file.match(/^migration-(\d+)\.test\.ts$/))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => Number.parseInt(match[1], 10))
    );
    const uncovered = migrations.filter((m) => !covered.has(m.idx)).map((m) => m.tag);
    expect(uncovered).toEqual([]);
  });

  test('journal entries are contiguous and their `when` timestamps increase with idx', () => {
    const { entries } = loadJournal();
    expect(entries.length).toBe(migrations.length);

    let previousWhen = -1;
    entries.forEach((entry, position) => {
      expect(entry.idx).toBe(position);
      expect(entry.tag).toBe(migrations[position].tag);
      expect(entry.when).toBeGreaterThan(previousWhen);
      previousWhen = entry.when;
    });
  });

  test('no shipped migration has had its tag or `when` edited', () => {
    const { entries } = loadJournal();
    expect(entries.length).toBeGreaterThanOrEqual(SHIPPED_JOURNAL.length);

    const shipped = entries
      .slice(0, SHIPPED_JOURNAL.length)
      .map(({ idx, tag, when }) => ({ idx, tag, when }));
    expect(shipped).toEqual([...SHIPPED_JOURNAL]);
  });

  test('the newest snapshot belongs to the newest schema-changing migration', () => {
    const { entries } = loadJournal();
    const snapshots = loadSnapshots();
    const schemaChanging = migrations.filter(migrationChangesSchema);

    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(schemaChanging.map((m) => m.tag)).toContain(migrations[0].tag);

    const journalIdxs = new Set(entries.map((entry) => entry.idx));
    expect(snapshots.filter((s) => !journalIdxs.has(s.idx)).map((s) => s.file)).toEqual([]);

    expect(snapshots[snapshots.length - 1].idx).toBe(schemaChanging[schemaChanging.length - 1].idx);
  });

  test('the snapshot prevId chain is unbroken and collision-free', () => {
    const snapshots = loadSnapshots();

    expect(snapshots[0].prevId).toBe('00000000-0000-0000-0000-000000000000');
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].prevId).toBe(snapshots[i - 1].id);
    }
    expect(new Set(snapshots.map((s) => s.prevId)).size).toBe(snapshots.length);
  });

  test('the head snapshot content still matches schema.ts, table by table and column by column', () => {
    const head = loadHeadSnapshot();

    expect(Object.keys(head.tables).sort()).toEqual(schemaTables);

    const snapshotColumns = Object.fromEntries(
      Object.entries(head.tables).map(([table, { columns }]) => [
        table,
        Object.keys(columns).sort(),
      ])
    );
    expect(snapshotColumns).toEqual(Object.fromEntries(schemaColumns));
  });

  test('the head snapshot matches each column SQL TYPE, nullability and the index set', () => {
    const head = loadHeadSnapshot();

    const snapshotShapes = Object.fromEntries(
      Object.entries(head.tables).map(([table, { columns, indexes }]) => [
        table,
        {
          columns: Object.fromEntries(
            Object.entries(columns).map(([columnName, column]) => [
              columnName,
              {
                type: column.type,
                notNull: Boolean(column.notNull),
                primaryKey: Boolean(column.primaryKey),
              },
            ])
          ),
          indexes: Object.keys(indexes ?? {}).sort(),
        },
      ])
    );

    expect(snapshotShapes).toEqual(Object.fromEntries(schemaShapes));
  });

  test('foreign key cascade: deleting a user cascades to vehicles and expenses', () => {
    for (const migration of migrations) {
      applyMigration(db, migration);
    }

    seedCoreData(db);

    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    db.run("DELETE FROM users WHERE id = 'u1'");

    expect(countRows(db, 'users')).toBe(0);
    expect(countRows(db, 'vehicles')).toBe(0);
    expect(countRows(db, 'expenses')).toBe(0);
  });
});
