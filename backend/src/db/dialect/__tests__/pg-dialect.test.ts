import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { type Column, is, type SQL, sql } from 'drizzle-orm';
import { type BunSQLiteDatabase, drizzle as sqliteDrizzle } from 'drizzle-orm/bun-sqlite';
import { bigint, jsonb, PgTable, pgTable, text as pgText } from 'drizzle-orm/pg-core';
import { type PgliteDatabase, drizzle as pgDrizzle } from 'drizzle-orm/pglite';
import { integer, SQLiteTable, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import * as pgSchema from '../../pg/schema';
import * as active from '../../schema';
import * as sqliteSchema from '../../sqlite/schema';
import { ACTIVE_DIALECT, dialectFromUrl } from '../active';
import { classifyDbError, DIALECT_SQL, type DialectSql } from '../index';

const liteProbe = sqliteTable('probe', {
  id: text('id'),
  at: integer('at'),
  tags: text('tags'),
  prefs: text('prefs'),
});
const pgProbe = pgTable('probe', {
  id: pgText('id'),
  at: bigint('at', { mode: 'number' }),
  tags: jsonb('tags'),
  prefs: jsonb('prefs'),
});

type Probe = { id: Column; at: Column; tags: Column; prefs: Column };

const ROWS: [string, number, unknown, unknown][] = [
  ['r1', 1704067199, ['fuel', ''], { a: 1, b: { c: { k: 1 } } }],
  ['r2', 1704067200, [], null],
  ['r3', 1719792000, null, { b: 3 }],
  ['r4', 1717245296, ['maintenance', 'fuel'], {}],
];

let lite: Database;
let liteDb: BunSQLiteDatabase;
let client: PGlite;
let pgDb: PgliteDatabase;

beforeAll(async () => {
  lite = new Database(':memory:');
  liteDb = sqliteDrizzle(lite);
  lite.run('CREATE TABLE probe (id TEXT, at INTEGER, tags TEXT, prefs TEXT)');
  client = new PGlite();
  pgDb = pgDrizzle(client);
  await client.exec("SET TIME ZONE 'Pacific/Auckland'");
  await client.exec('CREATE TABLE probe (id text, at bigint, tags jsonb, prefs jsonb)');
  for (const [id, at, tags, prefs] of ROWS) {
    const json = (v: unknown) => (v === null ? null : JSON.stringify(v));
    lite.run('INSERT INTO probe VALUES (?, ?, ?, ?)', [id, at, json(tags), json(prefs)]);
    await client.query('INSERT INTO probe VALUES ($1, $2, $3, $4)', [
      id,
      at,
      json(tags),
      json(prefs),
    ]);
  }
});

afterAll(async () => {
  lite.close();
  await client.close();
});

const parsed = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);

async function both(build: (d: DialectSql, t: Probe) => SQL): Promise<[unknown[], unknown[]]> {
  const onLite = liteDb.all(build(DIALECT_SQL.sqlite, liteProbe as unknown as Probe));
  const onPg = (await pgDb.execute(build(DIALECT_SQL.pg, pgProbe as unknown as Probe))).rows;
  return [onLite, onPg];
}

const normalize = (rows: unknown[], json: string[] = []) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([k, v]) => [
        k,
        json.includes(k) ? parsed(v) : v === null ? null : String(v),
      ])
    )
  );

describe('each Postgres dialect helper gives the same result as its SQLite twin', () => {
  test('month, year-month and date-time of epoch seconds, read in UTC', async () => {
    const [onLite, onPg] = await both(
      (d, t) =>
        sql`SELECT ${t.id} AS id, ${d.extractMonth(t.at)} AS m, ${d.formatYearMonth(t.at)} AS ym, ${d.toDateTimeString(t.at)} AS dt FROM probe ORDER BY id`
    );
    expect(normalize(onPg)).toEqual(normalize(onLite));
    expect(normalize(onLite)[0]).toEqual({
      id: 'r1',
      m: '12',
      ym: '2023-12',
      dt: '2023-12-31 23:59:59',
    });
  });

  test('a JSON array has an element, is empty, and joins to its elements', async () => {
    const some = await both(
      (d, t) =>
        sql`SELECT ${t.id} AS id FROM probe WHERE ${d.jsonArraySome(t.tags, (e) => sql`${e} = 'fuel'`)} ORDER BY id`
    );
    expect(some[1]).toEqual(some[0]);
    expect(some[0]).toEqual([{ id: 'r1' }, { id: 'r4' }]);
    const empty = await both(
      (d, t) => sql`SELECT ${t.id} AS id FROM probe WHERE ${d.jsonArrayIsEmpty(t.tags)} ORDER BY id`
    );
    expect(empty[1]).toEqual(empty[0]);
    expect(empty[0]).toEqual([{ id: 'r2' }, { id: 'r3' }]);
    const joined = await both((d, t) => {
      const { join, element } = d.leftJoinJsonArrayElements(t.tags, 'tag');
      return sql`SELECT ${t.id} AS id, ${element} AS tag FROM probe ${join} ORDER BY id, tag`;
    });
    expect(joined[1]).toEqual(joined[0]);
    expect(joined[0]).toHaveLength(6);
  });

  test('typed parameters', async () => {
    const [onLite, onPg] = await both(
      (d) =>
        sql`SELECT ${d.typedParam(9007199254740991, 'bigint')} AS a, ${d.typedParam(1.5, 'real')} AS b, ${d.typedParam('x', 'text')} AS c`
    );
    expect(normalize(onPg)).toEqual(normalize(onLite));
    expect(() => DIALECT_SQL.pg.typedParam(1.5, 'bigint')).toThrow(TypeError);
  });

  test('a JSON merge patch: null removes, objects merge, a scalar becomes an object', async () => {
    const patch = { a: null, b: { d: 4 }, e: 'x' };
    const [onLite, onPg] = await both(
      (d, t) =>
        sql`SELECT ${t.id} AS id, ${d.jsonMergePatch(t.prefs, patch)} AS merged FROM probe ORDER BY id`
    );
    expect(normalize(onPg, ['merged'])).toEqual(normalize(onLite, ['merged']));
    expect(normalize(onLite, ['merged'])[0]).toEqual({
      id: 'r1',
      merged: { b: { c: { k: 1 }, d: 4 }, e: 'x' },
    });
  });

  test('missing entries are added under a parent and present ones are kept', async () => {
    const entries = { c: { k: 9 }, z: { y: 2 } };
    const [onLite, onPg] = await both(
      (d, t) =>
        sql`SELECT ${t.id} AS id, ${d.jsonAddMissingEntries(t.prefs, 'b', entries)} AS merged FROM probe ORDER BY id`
    );
    expect(normalize(onPg, ['merged'])).toEqual(normalize(onLite, ['merged']));
    expect(normalize(onLite, ['merged'])[0]).toEqual({
      id: 'r1',
      merged: { a: 1, b: { c: { k: 1 }, z: { y: 2 } } },
    });
    expect(() => DIALECT_SQL.pg.jsonAddMissingEntries(sql`'{}'`, 'bad key', {})).toThrow(TypeError);
  });
});

describe('database errors are classified the same on both drivers', () => {
  test('unique, foreign key and not-null violations', async () => {
    lite.run('CREATE TABLE u (id TEXT PRIMARY KEY, n TEXT NOT NULL, p TEXT REFERENCES u(id))');
    lite.run('PRAGMA foreign_keys = ON');
    await client.exec(
      'CREATE TABLE u (id text PRIMARY KEY, n text NOT NULL, p text REFERENCES u(id))'
    );
    const statements = [
      "INSERT INTO u (id, n) VALUES ('a', 'x')",
      "INSERT INTO u (id, n) VALUES ('a', 'y')",
      "INSERT INTO u (id, n, p) VALUES ('b', 'x', 'missing')",
      "INSERT INTO u (id) VALUES ('c')",
    ];
    const kinds = async (run: (q: SQL) => Promise<unknown>) => {
      const out: (string | null)[] = [];
      for (const statement of statements) {
        out.push(
          await run(sql.raw(statement)).then(
            () => 'ok',
            (e: unknown) => classifyDbError(e)
          )
        );
      }
      return out;
    };
    const onLite = await kinds(async (q) => liteDb.run(q));
    const onPg = await kinds((q) => pgDb.execute(q));
    expect(onLite).toEqual(['ok', 'unique', 'foreign_key', 'not_null']);
    expect(onPg).toEqual(onLite);
  });
});

describe('the active dialect', () => {
  test('is chosen from DATABASE_URL', () => {
    expect(dialectFromUrl(undefined)).toBe('sqlite');
    expect(dialectFromUrl(':memory:')).toBe('sqlite');
    expect(dialectFromUrl('./data/vroom.db')).toBe('sqlite');
    expect(dialectFromUrl('postgres://u@h/db')).toBe('pg');
    expect(dialectFromUrl('POSTGRESQL://u@h/db')).toBe('pg');
  });

  test('is SQLite in the test run, and db/schema exports the SQLite tables', () => {
    expect(ACTIVE_DIALECT).toBe('sqlite');
    expect(active.expenses).toBe(sqliteSchema.expenses);
    expect(is(active.users, SQLiteTable)).toBe(true);
  });

  test('a Postgres URL switches db/schema to the Postgres tables and the connection refuses it', () => {
    const script = [
      "const schema = await import('./src/db/schema.ts');",
      "const pg = await import('./src/db/pg/schema.ts');",
      "const conn = await import('./src/db/connection.ts');",
      'let refused = "";',
      'try { conn.getDb(); } catch (e) { refused = e.message; }',
      'console.log(JSON.stringify({ same: schema.expenses === pg.expenses, refused }));',
    ].join('\n');
    const run = Bun.spawnSync(['bun', '-e', script], {
      cwd: join(import.meta.dir, '../../../..'),
      env: { ...process.env, DATABASE_URL: 'postgres://user@127.0.0.1:1/vroom', NODE_ENV: 'test' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = JSON.parse(run.stdout.toString().trim().split('\n').at(-1) ?? '{}');
    expect(out.same, run.stderr.toString()).toBe(true);
    expect(out.refused).toContain('cannot connect to yet (#1635)');
    expect(is(pgSchema.expenses, PgTable)).toBe(true);
  });
});
