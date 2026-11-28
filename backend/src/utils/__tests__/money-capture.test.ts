import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedGarage } from '../../db/seed';
import { createTestApp, type TestApp } from '../../test-helpers/http-client';

const FIXTURE = join(import.meta.dir, '__fixtures__', 'money-capture.jsonl');
const UPDATE = process.env.UPDATE_MONEY_CAPTURE === '1';
const NOW = new Date('2026-06-15T12:00:00Z');

const MONEY_COLUMNS: Record<string, string[]> = {
  vehicles: ['purchase_price'],
  vehicle_financing: ['original_amount', 'payment_amount', 'residual_value', 'excess_mileage_fee'],
  insurance_terms: [
    'deductible_amount',
    'coverage_limit',
    'total_cost',
    'monthly_cost',
    'payment_amount',
  ],
  insurance_claims: ['payout_amount'],
  expenses: ['expense_amount', 'group_total'],
  reminders: ['expense_amount'],
};

const VOLATILE_KEY = /^(id|.*Id|.*At|.*Date|createdBy|updatedBy|token|url|.*Url)$/;
const ID_LIKE = /^[a-z0-9]{24,}$/;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(stable);
    const objects = items.every((item) => item !== null && typeof item === 'object');
    return objects
      ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : items;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE_KEY.test(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, stable(v)])
    );
  }
  if (typeof value === 'string' && ID_LIKE.test(value)) return '<id>';
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  return value;
}

async function get(ctx: TestApp, path: string): Promise<unknown> {
  const res = await ctx.authed('GET', `/api/v1${path}`);
  const text = await res.text();
  expect(res.status, `${path}: ${text.slice(0, 200)}`).toBe(200);
  return res.headers.get('content-type')?.includes('json')
    ? stable(JSON.parse(text))
    : text.replace(/\b[a-z0-9]{24,}\b/g, '<id>');
}

async function idsOf(ctx: TestApp, sql: string): Promise<string[]> {
  const rows = (await ctx.sql.all(sql, [ctx.user.id])) as { id: string }[];
  return rows.map((row) => row.id);
}

async function captureGarage(ctx: TestApp): Promise<Record<string, unknown>> {
  const end = Math.floor(NOW.getTime() / 1000);
  const start = end - 365 * 86_400;
  const ytd = Math.floor(Date.UTC(2026, 0, 1) / 1000);
  const range = `startDate=${start}&endDate=${end}&timeZone=UTC`;
  const paths = [
    '/expenses?limit=500',
    '/expenses/summary',
    `/expenses/summary?period=1y`,
    '/insurance',
    '/reminders',
    '/reminders/recurring-cost',
    '/trips/summary',
    '/vehicles',
    `/analytics/summary?${range}&ytdStart=${ytd}`,
    `/analytics/quick-stats?${range}&ytdStart=${ytd}`,
    `/analytics/fuel-stats?${range}`,
    `/analytics/fuel-advanced?${range}`,
    `/analytics/cross-vehicle?${range}`,
    '/analytics/financing?timeZone=UTC',
    '/analytics/insurance?timeZone=UTC',
    '/analytics/year-end?year=2025&timeZone=UTC',
    `/analytics/insights?start=${start}&end=${end}&timeZone=UTC`,
    ...['cost', 'costPerDistance'].flatMap((metric) =>
      ['none', 'vehicle', 'category'].map(
        (groupBy) =>
          `/analytics/query?metric=${metric}&interval=month&groupBy=${groupBy}&include=all&compare=prevYear&energy=fuel&timeZone=UTC`
      )
    ),
  ];
  const out: Record<string, unknown> = {};
  for (const path of paths) out[path] = await get(ctx, path);
  const policies = await idsOf(
    ctx,
    'SELECT id FROM insurance_policies WHERE user_id = ? ORDER BY company'
  );
  for (const [index, id] of policies.entries()) {
    out[`policy ${index} claims`] = await get(ctx, `/insurance/${id}/claims`);
  }
  const vehicles = await idsOf(
    ctx,
    'SELECT id FROM vehicles WHERE user_id = ? ORDER BY make, model, year'
  );
  for (const [index, id] of vehicles.entries()) {
    const routes = {
      stats: `/vehicles/${id}/stats?period=all`,
      financing: `/financing/vehicles/${id}/financing?timeZone=UTC`,
      tco: `/analytics/vehicle-tco?vehicleId=${id}&timeZone=UTC`,
      health: `/analytics/vehicle-health?vehicleId=${id}&timeZone=UTC`,
      expenses: `/analytics/vehicle-expenses?vehicleId=${id}&${range}`,
      export: `/expenses/export?vehicleId=${id}`,
    };
    for (const [name, path] of Object.entries(routes))
      out[`vehicle ${index} ${name}`] = await get(ctx, path);
  }
  return out;
}

async function toWholeYen(ctx: TestApp): Promise<void> {
  await ctx.sql.run('UPDATE user_preferences SET currency_unit = ? WHERE user_id = ?', [
    'JPY',
    ctx.user.id,
  ]);
  for (const [table, columns] of Object.entries(MONEY_COLUMNS)) {
    const set = columns.map((c) => `${c} = CAST(ROUND(${c} / 100.0) AS INTEGER)`).join(', ');
    await ctx.sql.run(`UPDATE ${table} SET ${set}`);
  }
}

let captured: Record<string, Record<string, unknown>>;
const zone = process.env.TZ;

beforeAll(async () => {
  process.env.TZ = 'UTC';
  setSystemTime(NOW);
  captured = {};
  const usd = await createTestApp();
  await seedGarage(usd.user.id);
  captured.USD = await captureGarage(usd);
  usd.close();
  const jpy = await createTestApp();
  await seedGarage(jpy.user.id);
  await toWholeYen(jpy);
  captured.JPY = await captureGarage(jpy);
  jpy.close();
  if (UPDATE) {
    const lines = Object.entries(captured).flatMap(([currency, routes]) =>
      Object.entries(routes).map(([route, body]) => JSON.stringify([currency, route, body]))
    );
    writeFileSync(FIXTURE, `${lines.join('\n')}\n`);
  }
}, 120_000);

afterAll(() => {
  setSystemTime();
  process.env.TZ = zone;
});

describe('money shown by the API on the sample garage', () => {
  test.each(['USD', 'JPY'])('%s matches the committed capture', (currency) => {
    expect(existsSync(FIXTURE), 'Run with UPDATE_MONEY_CAPTURE=1 to write the capture').toBe(true);
    const fixture: Record<string, unknown> = {};
    for (const line of readFileSync(FIXTURE, 'utf-8').trim().split('\n')) {
      const [lineCurrency, route, body] = JSON.parse(line) as [string, string, unknown];
      if (lineCurrency === currency) fixture[route] = body;
    }
    expect(captured[currency]).toEqual(fixture);
  });

  test('the capture holds real amounts for every currency', () => {
    for (const currency of ['USD', 'JPY']) {
      const text = JSON.stringify(captured[currency]);
      expect(Object.keys(captured[currency] ?? {}).length).toBeGreaterThan(30);
      expect(text).toMatch(/"(expenseAmount|totalAmount|amount)":[1-9]/);
    }
  });
});
