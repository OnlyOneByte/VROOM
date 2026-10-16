/**
 * General migration tests — applies to the full migration set.
 *
 * Three jobs:
 *  1. The SQL applies in sequence on a fresh database and lands on the schema `schema.ts` declares
 *     (every table, nothing extra) with working foreign-key cascades.
 *  2. Each migration keeps its own `migration-NNNN` test, so a new one cannot ship unpinned.
 *  3. The `drizzle/` bookkeeping stays self-consistent, which is what keeps the next
 *     `bun run db:generate` honest:
 *       - `meta/_journal.json` `when` values must INCREASE with `idx`, and the rows of already
 *         shipped migrations must not change at all. The runtime migrator reads MAX(created_at)
 *         from `__drizzle_migrations` ONCE, then applies every journal entry whose `when` exceeds
 *         it — so a later migration carrying an earlier `when` than one already recorded is
 *         skipped FOREVER on a database that stopped in between, and a shipped migration whose
 *         `when` is raised above a value some database already recorded is re-applied on its next
 *         boot (which throws the moment it re-adds an existing column).
 *       - the newest snapshot in `meta/` must describe the newest migration that actually changed
 *         the schema, and its CONTENT must still match `schema.ts`. drizzle-kit diffs `schema.ts`
 *         against the lexicographically last snapshot file, so a missing OR stale head snapshot
 *         makes the next generate re-emit work that already shipped. A data-only migration needs
 *         no snapshot of its own — the previous one still describes the database.
 *       - the snapshot `prevId` chain must be unbroken and collision-free (drizzle-kit aborts on
 *         two snapshots sharing a parent).
 */

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

/**
 * The tables and columns `schema.ts` declares, derived from the schema itself: a hand-written list
 * silently stops covering tables added later, which is the one failure this test exists to catch.
 */
const schemaColumns = new Map(
  Object.values<unknown>(schema)
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .map((table) => {
      const { name, columns } = getTableConfig(table);
      return [name, columns.map((column) => column.name).sort()] as const;
    })
);
const schemaTables = [...schemaColumns.keys()].sort();

/**
 * The same tables with each column's full SQL shape, plus the index names, in the vocabulary a
 * drizzle snapshot uses.
 *
 * A name-only comparison catches the BENIGN kind of snapshot staleness: a missing column makes the
 * next `db:generate` re-emit an additive `ADD COLUMN`. The kinds that are destructive are a column
 * whose TYPE or nullability drifted — SQLite cannot alter a column in place, so drizzle-kit emits a
 * 12-step table rebuild whose `DROP TABLE` takes the rows with it — and a drifted index set, which
 * re-emits a `CREATE INDEX` that throws inside the migrator's transaction and stops an existing
 * install from booting. Both are invisible unless the shape itself is compared, and the real
 * incident was exactly this: migration 0009 flipped the money columns real -> integer in schema.ts
 * without writing a snapshot, so the stale 0008 snapshot still said `real` and the next generate
 * emitted six table rebuilds.
 */
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
          // A column-level `.unique()` is not a table index in drizzle's schema API, but
          // drizzle-kit records it as one in the snapshot, so fold those in or the two sides
          // cannot be compared.
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

/**
 * The journal rows exactly as they ship today — frozen here, not derived from the journal.
 *
 * `when` is the migrator's only ordering key: it is what lands in `__drizzle_migrations`, and the
 * migrator replays every entry whose `when` exceeds the newest value recorded there. Editing a
 * shipped row therefore rewrites history on every database that already ran it. Raising a `when`
 * replays that migration (the replay dies on the first re-added column); lowering one hides it from
 * a database that stopped just before it. Append a row when a migration ships; never edit one.
 */
const SHIPPED_JOURNAL: readonly { idx: number; tag: string; when: number }[] = [
  { idx: 0, tag: '0000_tiresome_skrulls', when: 1773718943289 },
  { idx: 1, tag: '0001_blushing_juggernaut', when: 1780689548990 },
  { idx: 2, tag: '0002_medical_the_phantom', when: 1780798332385 },
  { idx: 3, tag: '0003_many_jean_grey', when: 1780892459335 },
  { idx: 4, tag: '0004_marvelous_the_fury', when: 1780930491804 },
  { idx: 5, tag: '0005_license_plate_per_user', when: 1781000000000 },
  { idx: 6, tag: '0006_mixed_zarek', when: 1782318187087 },
  { idx: 7, tag: '0007_previous_ikaris', when: 1782340462679 },
  { idx: 8, tag: '0008_awesome_avengers', when: 1782503441067 },
  { idx: 9, tag: '0009_money_to_cents', when: 1782510000000 },
  { idx: 10, tag: '0010_absurd_clint_barton', when: 1782520918582 },
  { idx: 11, tag: '0011_quick_red_hulk', when: 1782534527999 },
  { idx: 12, tag: '0012_expense_location', when: 1782600100000 },
  { idx: 13, tag: '0013_push_subscriptions', when: 1782700000000 },
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
    // Guards the derivation itself: a broken filter would yield [] and silently pass the set checks.
    expect(schemaTables.length).toBeGreaterThanOrEqual(21);
    expect(schemaTables).toContain('users');
    expect(schemaColumns.get('users')).toContain('email');
  });

  test('all migrations apply cleanly in sequence and produce exactly the schema tables', () => {
    for (const migration of migrations) {
      applyMigration(db, migration);
    }

    // Set equality in both directions: a table the migrations forget to create fails, and so does a
    // table the migrations create that nobody declared in schema.ts.
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
    // Guards the DDL classifier: if it called everything data-only the comparison below would
    // compare the head snapshot against the wrong end of an empty list.
    expect(schemaChanging.map((m) => m.tag)).toContain(migrations[0].tag);

    // No snapshot may name a migration the journal does not have — drizzle-kit would diff against
    // a state the migrator never reaches.
    const journalIdxs = new Set(entries.map((entry) => entry.idx));
    expect(snapshots.filter((s) => !journalIdxs.has(s.idx)).map((s) => s.file)).toEqual([]);

    // drizzle-kit diffs against the LAST snapshot in this order, so it must describe the newest
    // migration that actually moved the schema — a data-only head migration (0009's class) has no
    // snapshot of its own, and correctly needs none.
    expect(snapshots[snapshots.length - 1].idx).toBe(schemaChanging[schemaChanging.length - 1].idx);
  });

  test('the snapshot prevId chain is unbroken and collision-free', () => {
    const snapshots = loadSnapshots();

    expect(snapshots[0].prevId).toBe('00000000-0000-0000-0000-000000000000');
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].prevId).toBe(snapshots[i - 1].id);
    }
    // A shared parent is the "collision" drizzle-kit refuses to generate against.
    expect(new Set(snapshots.map((s) => s.prevId)).size).toBe(snapshots.length);
  });

  test('the head snapshot content still matches schema.ts, table by table and column by column', () => {
    const head = loadHeadSnapshot();

    expect(Object.keys(head.tables).sort()).toEqual(schemaTables);

    // Content, not just the file name: a snapshot that exists but has drifted from schema.ts is
    // exactly what makes `bun run db:generate` re-emit DDL that already shipped.
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

    // The destructive half of snapshot staleness — see schemaShapes. A type or notNull drift makes
    // the next generate emit a table rebuild (DROP included); an index drift makes it re-emit a
    // CREATE INDEX that throws mid-migration on an existing install.
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
