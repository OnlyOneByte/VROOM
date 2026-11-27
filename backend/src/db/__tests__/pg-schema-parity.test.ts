import { describe, expect, test } from 'bun:test';
import { getTableColumns, getTableName, is, type SQL } from 'drizzle-orm';
import { PgTable, getTableConfig as pgConfig } from 'drizzle-orm/pg-core';
import { SQLiteTable, getTableConfig as sqliteConfig } from 'drizzle-orm/sqlite-core';
import * as pg from '../pg/schema';
import * as sqlite from '../schema';

const PG_TYPE: Record<string, string> = {
  SQLiteText: 'text',
  SQLiteTextJson: 'jsonb',
  SQLiteTimestamp: 'bigint',
  SQLiteBoolean: 'boolean',
  SQLiteInteger: 'integer',
  SQLiteReal: 'double precision',
};

const sqliteExports = sqlite as unknown as Record<string, unknown>;
const sqliteTables = Object.entries(sqliteExports).filter((entry): entry is [string, SQLiteTable] =>
  is(entry[1], SQLiteTable)
);
const pgTables = pg as unknown as Record<string, unknown>;

function twinOf(key: string): PgTable {
  const twin = pgTables[key];
  if (!is(twin, PgTable)) throw new Error(`No Postgres table exported as ${key}`);
  return twin;
}

const names = (columns: { name: string }[]) => columns.map((c) => c.name);
const exprOrName = (c: unknown) => (c && typeof c === 'object' && 'name' in c ? c.name : 'sql');

interface ColumnFacts {
  name: string;
  notNull: boolean;
  primary: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  enumValues?: string[] | undefined;
}

const facts = (column: ColumnFacts, type: string) =>
  JSON.stringify({
    name: column.name,
    type,
    notNull: column.notNull,
    primary: column.primary,
    unique: column.isUnique,
    hasDefault: column.hasDefault,
    enumValues: column.enumValues ?? [],
  });

function columnDrift(key: string, table: SQLiteTable): string[] {
  const columns = getTableColumns(table);
  const twinColumns = getTableColumns(twinOf(key));
  const drift = Object.keys(twinColumns)
    .filter((k) => !(k in columns))
    .map((k) => `${key}.${k}: only in Postgres`);
  for (const [columnKey, column] of Object.entries(columns)) {
    const twin = twinColumns[columnKey];
    const want = facts(column, PG_TYPE[column.columnType] ?? `unmapped ${column.columnType}`);
    const got = twin ? facts(twin, twin.getSQLType()) : 'missing';
    if (want !== got) drift.push(`${key}.${columnKey}: want ${want} got ${got}`);
  }
  return drift;
}

describe('the Postgres schema mirrors the SQLite schema', () => {
  test('every SQLite table has a Postgres twin under the same export and table name', () => {
    expect(sqliteTables.length).toBeGreaterThan(30);
    const missing = sqliteTables.filter(([key]) => !is(pgTables[key], PgTable)).map(([k]) => k);
    expect(missing).toEqual([]);
    for (const [key, table] of sqliteTables) {
      expect(getTableName(twinOf(key)), key).toBe(getTableName(table));
    }
    const extra = Object.entries(pgTables)
      .filter(([key, value]) => is(value, PgTable) && !is(sqliteExports[key], SQLiteTable))
      .map(([key]) => key);
    expect(extra).toEqual([]);
  });

  test('every column has a twin with the mapped type, nullability, key and default', () => {
    expect(sqliteTables.flatMap(([key, table]) => columnDrift(key, table))).toEqual([]);
  });

  test('indexes, primary keys and foreign keys match by name and columns', () => {
    const shape = (cfg: ReturnType<typeof sqliteConfig> | ReturnType<typeof pgConfig>) => ({
      indexes: cfg.indexes
        .map((i) => ({
          name: i.config.name,
          unique: i.config.unique,
          columns: (i.config.columns as unknown[]).map(exprOrName),
          partial: Boolean(i.config.where),
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      primaryKeys: cfg.primaryKeys.map((p) => ({ name: p.getName(), columns: names(p.columns) })),
      foreignKeys: cfg.foreignKeys
        .map((fk) => {
          const ref = fk.reference();
          return {
            name: fk.getName(),
            columns: names(ref.columns),
            target: getTableName(ref.foreignTable),
            targetColumns: names(ref.foreignColumns),
            onDelete: fk.onDelete ?? 'no action',
            onUpdate: fk.onUpdate ?? 'no action',
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
    for (const [key, table] of sqliteTables) {
      expect(shape(pgConfig(twinOf(key))), key).toEqual(shape(sqliteConfig(table)));
    }
  });

  test('each hand-written Postgres index condition replaces a SQLite partial index', () => {
    const partial = new Set(
      sqliteTables.flatMap(([, table]) =>
        sqliteConfig(table)
          .indexes.filter((i) => i.config.where)
          .map((i) => i.config.name)
      )
    );
    expect(Object.keys(pg.PG_INDEX_WHERE).filter((name) => !partial.has(name))).toEqual([]);
  });

  test('a Postgres timestamp is stored as whole epoch seconds, like SQLite', () => {
    const column = pg.users.createdAt;
    const at = new Date('2024-06-01T12:34:56.789Z');
    expect(column.mapToDriverValue(at)).toBe(Math.floor(at.getTime() / 1000));
    expect(column.mapFromDriverValue('1717245296')).toEqual(new Date('2024-06-01T12:34:56.000Z'));
    expect(column.mapFromDriverValue(1717245296n as unknown as number)).toEqual(
      new Date('2024-06-01T12:34:56.000Z')
    );
  });

  test('the SQLite schema still uses only column types that have a Postgres mapping', () => {
    const unmapped = sqliteTables.flatMap(([key, table]) =>
      Object.values(getTableColumns(table))
        .filter((column) => !(column.columnType in PG_TYPE))
        .map((column) => `${key}.${column.name}: ${column.columnType}`)
    );
    expect(unmapped).toEqual([]);
  });

  test('partial index conditions name the Postgres columns, not the SQLite ones', () => {
    for (const [key] of sqliteTables) {
      for (const idx of pgConfig(twinOf(key)).indexes) {
        const where = idx.config.where as SQL | undefined;
        const chunks = (where?.queryChunks ?? []) as unknown[];
        const foreign = chunks.filter(
          (chunk) =>
            chunk &&
            typeof chunk === 'object' &&
            'table' in chunk &&
            is((chunk as { table: unknown }).table, SQLiteTable)
        );
        expect(foreign, `${key} ${idx.config.name}`).toEqual([]);
      }
    }
  });
});
