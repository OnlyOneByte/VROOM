import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { getTableColumns, getTableName, is, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { AnalyticsInsightsRepository } from '../../api/analytics/insights';
import {
  type AnalyticsQuery,
  AnalyticsQueryRepository,
  isValidQueryCombination,
  QUERY_GROUP_BYS,
  QUERY_METRICS,
} from '../../api/analytics/query-repository';
import { OdometerRepository } from '../../api/odometer/repository';
import { createTestApp } from '../../test-helpers/http-client';
import { openAsyncDatabase } from '../async-sqlite';
import { getDb } from '../connection';
import * as schema from '../schema';
import { seedGarage } from '../seed';

const db = getDb();

const ENABLED = process.env.PG_PORTABILITY === '1';

const EXPECTED_FAILURES: Record<string, string> = {
  'query cost/tag #1': '#1682',
  'query count/tag #1': '#1682',
  'items tag ["fuel",""] #1': '#1682',
  'items tag ["fuel",""] #2': '#1682',
};

const ISSUE_ERRORS: Record<string, RegExp> = {
  '#1682': /function json_each\(text\) does not exist/,
};

interface Captured {
  label: string;
  query: SQL;
  rows: unknown[];
}

async function capture(label: string, run: () => Promise<unknown>): Promise<Captured[]> {
  const target = db as unknown as { all: (query: SQL) => unknown[] };
  const asyncTarget = openAsyncDatabase(db.$client).db as unknown as {
    all: (query: SQL) => Promise<unknown[]>;
  };
  const original = target.all.bind(target);
  const asyncOriginal = asyncTarget.all.bind(asyncTarget);
  const out: Captured[] = [];
  const record = (query: SQL, rows: unknown[]) => {
    out.push({ label: `${label} #${out.length + 1}`, query, rows });
    return rows;
  };
  target.all = (query: SQL) => record(query, original(query));
  asyncTarget.all = async (query: SQL) => record(query, await asyncOriginal(query));
  try {
    await run();
  } finally {
    target.all = original;
    asyncTarget.all = asyncOriginal;
  }
  return out;
}

const BOOLEAN_COLUMNS = new Set(
  Object.values(schema)
    .filter((value) => is(value, SQLiteTable))
    .flatMap((table) =>
      Object.values(getTableColumns(table as SQLiteTable))
        .filter((column) => column.columnType === 'SQLiteBoolean')
        .map((column) => `${getTableName(table as SQLiteTable)}.${column.name}`)
    )
);

function pgType(table: string, column: string, sqliteType: string): string {
  if (BOOLEAN_COLUMNS.has(`${table}.${column}`)) return 'boolean';
  const type = sqliteType.toUpperCase();
  if (type.includes('INT')) return 'bigint';
  if (/REAL|FLOA|DOUB/.test(type)) return 'double precision';
  if (type.includes('BLOB')) return 'bytea';
  return 'text';
}

async function mirrorIntoPostgres(pg: PGlite): Promise<void> {
  const sqlite = (db as unknown as { $client: Database }).$client;
  const tables = sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'"
    )
    .all() as { name: string }[];
  for (const { name } of tables) {
    const columns = sqlite.query(`SELECT name, type FROM pragma_table_info('${name}')`).all() as {
      name: string;
      type: string;
    }[];
    const types = columns.map((c) => pgType(name, c.name, c.type));
    await pg.exec(
      `CREATE TABLE "${name}" (${columns.map((c, i) => `"${c.name}" ${types[i]}`).join(', ')})`
    );
    const rows = sqlite.query(`SELECT * FROM "${name}"`).values();
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    for (const row of rows) {
      const values = row.map((value, i) =>
        types[i] === 'boolean' && value !== null ? Boolean(value) : value
      );
      await pg.query(`INSERT INTO "${name}" VALUES (${placeholders})`, values);
    }
  }
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value)) {
    return normalizeValue(Number(value));
  }
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  return value;
}

function endsInOrderBy(text: string): boolean {
  return /\border\s+by\s[^()]*$/i.test(text.trim());
}

function normalizeRows(rows: unknown[], ordered: boolean): string[] {
  const out = rows.map((row) =>
    JSON.stringify(
      Object.entries(row as Record<string, unknown>)
        .map(([key, value]) => [key, normalizeValue(value)])
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
    )
  );
  return ordered ? out : out.sort();
}

async function captureWorkload(userId: string): Promise<Captured[]> {
  const queries = new AnalyticsQueryRepository(db);
  const insights = new AnalyticsInsightsRepository(db, queries);
  const odometer = new OdometerRepository(db);
  const base: AnalyticsQuery = {
    metric: 'cost',
    interval: 'month',
    groupBy: 'none',
    include: 'all',
    compare: 'none',
    energy: 'fuel',
    timeZone: 'UTC',
  };
  const out: Captured[] = [];
  for (const metric of QUERY_METRICS) {
    for (const groupBy of QUERY_GROUP_BYS) {
      if (!isValidQueryCombination(metric, groupBy)) continue;
      out.push(
        ...(await capture(`query ${metric}/${groupBy}`, () =>
          queries.query(userId, { ...base, metric, groupBy, annotations: ['services', 'trips'] })
        ))
      );
    }
  }
  out.push(
    ...(await capture('query cost weekly vs previous year', () =>
      queries.query(userId, { ...base, interval: 'week', compare: 'prevYear' })
    )),
    ...(await capture('query volume electric', () =>
      queries.query(userId, { ...base, metric: 'volume', energy: 'electric' })
    ))
  );
  const range = { start: 0, end: Math.floor(Date.now() / 1000) + 86_400 };
  for (const [groupBy, keys] of [
    ['tag', ['fuel', '']],
    ['fuelType', ['Regular']],
    ['fuelType', []],
    ['category', ['maintenance']],
  ] as const) {
    out.push(
      ...(await capture(`items ${groupBy} ${JSON.stringify(keys)}`, () =>
        queries.items(userId, { ...range, include: 'all', groupBy, keys: [...keys] })
      ))
    );
  }
  out.push(
    ...(await capture('insights', () => insights.insights(userId, { ...range, timeZone: 'UTC' })))
  );
  const vehicles = db.$client
    .query('SELECT id FROM vehicles WHERE user_id = ? ORDER BY id')
    .all(userId) as { id: string }[];
  for (const [index, { id }] of vehicles.entries()) {
    out.push(
      ...(await capture(`odometer history ${index}`, () => odometer.getHistory(id, userId))),
      ...(await capture(`odometer history ${index} without expenses`, () =>
        odometer.getHistory(id, userId, { includeExpenses: false })
      )),
      ...(await capture(`odometer history ${index} without financials`, () =>
        odometer.getHistory(id, userId, { hideFinancials: true })
      )),
      ...(await capture(`odometer current ${index}`, () => odometer.getCurrentOdometer(id, userId)))
    );
  }
  return out;
}

describe.skipIf(!ENABLED)('raw SQL runs the same on Postgres', () => {
  test('every captured query returns the same rows, or is a listed expected failure', async () => {
    const ctx = await createTestApp();
    await seedGarage(ctx.user.id);
    const captured = await captureWorkload(ctx.user.id);
    expect(captured.length).toBeGreaterThan(30);
    expect(captured.some((c) => c.rows.length > 0)).toBe(true);

    const pg = new PGlite();
    await mirrorIntoPostgres(pg);
    const dialect = new PgDialect();
    const failures = new Map<string, string>();
    for (const { label, query, rows } of captured) {
      const { sql: text, params } = dialect.sqlToQuery(query);
      try {
        const result = await pg.query(text, params as unknown[]);
        const ordered = endsInOrderBy(text);
        const same =
          JSON.stringify(normalizeRows(result.rows, ordered)) ===
          JSON.stringify(normalizeRows(rows, ordered));
        if (!same) {
          failures.set(label, 'different rows from SQLite');
        }
      } catch (error) {
        failures.set(label, error instanceof Error ? error.message : String(error));
      }
    }
    await pg.close();

    const passed = captured.length - failures.size;
    const summary = [
      '### Postgres portability (PGlite)',
      '',
      `${captured.length} queries: ${passed} pass, ${failures.size} fail (${Object.keys(EXPECTED_FAILURES).length} expected).`,
      '',
      ...[...failures].map(([label, why]) => `- \`${label}\`: ${why}`),
    ].join('\n');
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);

    const unexpected = [...failures]
      .filter(([label, why]) => {
        const issue = EXPECTED_FAILURES[label];
        return !issue || !ISSUE_ERRORS[issue]?.test(why);
      })
      .map(([label, why]) => `${label}: ${why}`);
    expect(
      unexpected,
      'New Postgres failures (fix them, or list them with the issue that fixes them):'
    ).toEqual([]);
    const stale = Object.keys(EXPECTED_FAILURES).filter((label) => !failures.has(label));
    expect(stale, 'These now pass on Postgres; delete them from EXPECTED_FAILURES:').toEqual([]);
  }, 120_000);
});
