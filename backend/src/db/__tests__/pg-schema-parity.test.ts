import { describe, expect, test } from 'bun:test';
import { Column, getTableColumns, getTableName, is, SQL, StringChunk } from 'drizzle-orm';
import { PgTable, getTableConfig as pgConfig } from 'drizzle-orm/pg-core';
import { SQLiteTable, getTableConfig as sqliteConfig } from 'drizzle-orm/sqlite-core';
import * as pg from '../pg/schema';
import * as sqlite from '../sqlite/schema';

const PG_TYPE: Record<string, string> = {
  SQLiteText: 'text',
  SQLiteTextJson: 'jsonb',
  SQLiteTimestamp: 'bigint',
  SQLiteBoolean: 'boolean',
  SQLiteInteger: 'bigint',
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

function fingerprint(chunk: unknown): string {
  if (is(chunk, SQL)) return `(${chunk.queryChunks.map(fingerprint).join('')})`;
  if (is(chunk, Column)) return `[${chunk.name}]`;
  if (is(chunk, StringChunk)) return chunk.value.join('');
  return JSON.stringify(chunk);
}

function sqliteColumnsIn(chunk: unknown): string[] {
  if (is(chunk, SQL)) return chunk.queryChunks.flatMap(sqliteColumnsIn);
  if (is(chunk, Column) && is(chunk.table, SQLiteTable)) return [chunk.name];
  return [];
}

interface ColumnFacts {
  name: string;
  notNull: boolean;
  primary: boolean;
  isUnique: boolean;
  uniqueName: string | undefined;
  hasDefault: boolean;
  default: unknown;
  enumValues?: string[] | undefined;
}

const facts = (column: ColumnFacts, type: string) =>
  JSON.stringify({
    name: column.name,
    type,
    notNull: column.notNull,
    primary: column.primary,
    unique: column.isUnique,
    uniqueName: column.uniqueName ?? null,
    hasDefault: column.hasDefault,
    default: is(column.default, SQL) ? fingerprint(column.default) : (column.default ?? null),
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
    const at = `${key}.${columnKey}`;
    const want = facts(column, PG_TYPE[column.columnType] ?? `unmapped ${column.columnType}`);
    const got = twin ? facts(twin, twin.getSQLType()) : 'missing';
    if (want !== got) drift.push(`${at}: want ${want} got ${got}`);
    if (twin && twin.defaultFn !== column.defaultFn) drift.push(`${at}: different $defaultFn`);
    if (twin && twin.onUpdateFn !== column.onUpdateFn) drift.push(`${at}: different $onUpdateFn`);
  }
  return drift;
}

type AnyConfig = ReturnType<typeof sqliteConfig> | ReturnType<typeof pgConfig>;

const shape = (cfg: AnyConfig) => ({
  indexes: cfg.indexes
    .map((i) => ({
      name: i.config.name,
      unique: i.config.unique,
      columns: (i.config.columns as unknown[]).map((c) =>
        is(c, SQL) ? fingerprint(c) : `[${(c as { name: string }).name}]`
      ),
      where:
        i.config.name && i.config.name in pg.PG_INDEX_WHERE
          ? 'replaced by PG_INDEX_WHERE'
          : i.config.where
            ? fingerprint(i.config.where)
            : null,
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

  test('every column has a twin with the mapped type, nullability, keys and the same default', () => {
    expect(sqliteTables.flatMap(([key, table]) => columnDrift(key, table))).toEqual([]);
  });

  test('indexes match by name, columns, expressions and conditions; keys match too', () => {
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

  test('each hand-written condition is the one the Postgres index really uses', () => {
    const applied = Object.keys(pg.PG_INDEX_WHERE).map((name) => {
      const [key] =
        sqliteTables.find(([, table]) =>
          sqliteConfig(table).indexes.some((i) => i.config.name === name)
        ) ?? [];
      const twin = twinOf(String(key));
      const idx = pgConfig(twin).indexes.find((i) => i.config.name === name);
      const expected = pg.PG_INDEX_WHERE[name]?.(getTableColumns(twin));
      return [name, fingerprint(idx?.config.where) === fingerprint(expected)];
    });
    expect(applied.filter(([, same]) => !same)).toEqual([]);
    expect(applied.length).toBeGreaterThan(0);
  });

  test('no Postgres index expression or condition points at a SQLite column, at any depth', () => {
    const stray = sqliteTables.flatMap(([key]) =>
      pgConfig(twinOf(key)).indexes.flatMap((idx) =>
        [...(idx.config.columns as unknown[]), idx.config.where]
          .flatMap(sqliteColumnsIn)
          .map((column) => `${key} ${idx.config.name}: ${column}`)
      )
    );
    expect(stray).toEqual([]);
  });

  test('the scan sees a SQLite column inside nested SQL', () => {
    const nested = new SQL([new SQL([sqlite.users.email])]);
    expect(sqliteColumnsIn(nested)).toEqual(['email']);
    expect(fingerprint(nested)).toBe('(([email]))');
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

  test('Postgres integers are 64-bit like SQLite, so large minor-unit amounts fit', () => {
    const column = pg.insuranceTerms.coverageLimit;
    expect(column.getSQLType()).toBe('bigint');
    expect(column.mapFromDriverValue('10000000000' as unknown as number)).toBe(10_000_000_000);
  });

  test('the SQLite schema still uses only column types that have a Postgres mapping', () => {
    const unmapped = sqliteTables.flatMap(([key, table]) =>
      Object.values(getTableColumns(table))
        .filter((column) => !(column.columnType in PG_TYPE))
        .map((column) => `${key}.${column.name}: ${column.columnType}`)
    );
    expect(unmapped).toEqual([]);
  });
});
