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
import { db } from '../connection';
import * as schema from '../schema';
import { seedGarage } from '../seed';

const ENABLED = process.env.PG_PORTABILITY === '1';

const EXPECTED_FAILURES: Record<string, string> = {
  'query cost/none #2': '#1681',
  'query cost/category #2': '#1681',
  'query cost/vehicle #2': '#1681',
  'query cost/fuelType #1': '#1681',
  'query cost/fuelType #2': '#1681',
  'query cost/tag #1': '#1682',
  'query cost/tag #2': '#1681',
  'query costPerDistance/none #2': '#1681',
  'query costPerDistance/category #2': '#1681',
  'query costPerDistance/vehicle #2': '#1681',
  'query distance/none #2': '#1681',
  'query distance/vehicle #2': '#1681',
  'query volume/none #1': '#1681',
  'query volume/none #2': '#1681',
  'query volume/vehicle #1': '#1681',
  'query volume/vehicle #2': '#1681',
  'query volume/fuelType #1': '#1681',
  'query volume/fuelType #2': '#1681',
  'query efficiency/none #1': '#1681',
  'query efficiency/none #2': '#1681',
  'query efficiency/vehicle #1': '#1681',
  'query efficiency/vehicle #2': '#1681',
  'query efficiency/fuelType #1': '#1681',
  'query efficiency/fuelType #2': '#1681',
  'query count/none #2': '#1681',
  'query count/category #2': '#1681',
  'query count/vehicle #2': '#1681',
  'query count/fuelType #1': '#1681',
  'query count/fuelType #2': '#1681',
  'query count/tag #1': '#1682',
  'query count/tag #2': '#1681',
  'query cost weekly vs previous year #2': '#1681',
  'query volume electric #1': '#1681',
  'query volume electric #2': '#1681',
  'items tag ["fuel",""] #1': '#1682',
  'items tag ["fuel",""] #2': '#1682',
  'items fuelType [] #1': '#1681',
  'items fuelType [] #2': '#1681',
  'insights #5': '#1681',
  'insights #7': '#1681',
};

interface Captured {
  label: string;
  query: SQL;
  rows: unknown[];
}

async function capture(label: string, run: () => Promise<unknown>): Promise<Captured[]> {
  const target = db as unknown as { all: (query: SQL) => unknown[] };
  const original = target.all.bind(target);
  const out: Captured[] = [];
  target.all = (query: SQL) => {
    const rows = original(query);
    out.push({ label: `${label} #${out.length + 1}`, query, rows });
    return rows;
  };
  try {
    await run();
  } finally {
    target.all = original;
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

function normalizeRows(rows: unknown[]): string[] {
  return rows
    .map((row) =>
      JSON.stringify(
        Object.entries(row as Record<string, unknown>)
          .map(([key, value]) => [key.toLowerCase(), normalizeValue(value)])
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
      )
    )
    .sort();
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
        if (JSON.stringify(normalizeRows(result.rows)) !== JSON.stringify(normalizeRows(rows))) {
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
      .filter(([label]) => !(label in EXPECTED_FAILURES))
      .map(([label, why]) => `${label}: ${why}`);
    expect(
      unexpected,
      'New Postgres failures (fix them, or list them with the issue that fixes them):'
    ).toEqual([]);
    const stale = Object.keys(EXPECTED_FAILURES).filter((label) => !failures.has(label));
    expect(stale, 'These now pass on Postgres; delete them from EXPECTED_FAILURES:').toEqual([]);
  }, 120_000);
});
