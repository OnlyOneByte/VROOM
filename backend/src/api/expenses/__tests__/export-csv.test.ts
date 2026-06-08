/**
 * In-process HTTP tests for GET /api/v1/expenses/export (CSV) through the REAL
 * stack. Proves: auth gate, text/csv attachment headers, a header row + data
 * rows with the human vehicle name, the unpaginated path returns ALL rows (not
 * clamped to a page), and the category filter narrows the export.
 *
 * createTestApp() must run before static config/connection imports — keep this
 * file's imports to the harness + bun:test only.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(nickname?: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
    ...(nickname ? { nickname } : {}),
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function createExpense(
  vehicleId: string,
  category: string,
  amount: number,
  description: string,
  date: string
) {
  const fuelFields = category === 'fuel' ? { volume: 10, mileage: 30_000 } : {};
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category,
    expenseAmount: amount,
    date,
    description,
    ...fuelFields,
  });
  expect(res.status, await res.text()).toBeLessThan(300);
}

describe('GET /api/v1/expenses/export (CSV)', () => {
  test('401 without a session', async () => {
    const res = await ctx.anon('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(401);
  });

  test('returns a CSV attachment with a header row and the vehicle name', async () => {
    const vehicleId = await seedVehicle('Daily Driver');
    await createExpense(vehicleId, 'fuel', 52.4, 'Shell top-up', '2024-06-01T00:00:00.000Z');
    await createExpense(vehicleId, 'maintenance', 120, 'Oil change', '2024-06-10T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('.csv');

    const csv = await res.text();
    const lines = csv.trim().split('\n');
    // Header + 2 data rows.
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('date');
    expect(lines[0]).toContain('vehicle');
    expect(lines[0]).toContain('amount');
    // Human vehicle name + the descriptions are present in the body.
    expect(csv).toContain('Daily Driver');
    expect(csv).toContain('Shell top-up');
    expect(csv).toContain('Oil change');
  });

  test('category filter narrows the export', async () => {
    const vehicleId = await seedVehicle();
    await createExpense(vehicleId, 'fuel', 40, 'Fuel A', '2024-06-01T00:00:00.000Z');
    await createExpense(vehicleId, 'fuel', 41, 'Fuel B', '2024-06-02T00:00:00.000Z');
    await createExpense(vehicleId, 'maintenance', 200, 'Brakes', '2024-06-03T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export?category=maintenance');
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2); // header + 1 maintenance row
    expect(csv).toContain('Brakes');
    expect(csv).not.toContain('Fuel A');
  });

  test('search filter narrows the export to matching rows (matches the table)', async () => {
    // Before cycle 186 the export ignored search, so a searched table + Export CSV
    // gave a BROADER file than the user was viewing. Now it matches.
    const vehicleId = await seedVehicle();
    await createExpense(vehicleId, 'maintenance', 120, 'Jiffy Lube oil change', '2024-06-01T00:00:00.000Z');
    await createExpense(vehicleId, 'fuel', 40, 'Shell top-up', '2024-06-02T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export?search=jiffy');
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2); // header + the one matching row
    expect(csv).toContain('Jiffy Lube');
    expect(csv).not.toContain('Shell top-up');
  });

  test('tags filter narrows the export (AND semantics, comma-joined param)', async () => {
    const vehicleId = await seedVehicle();
    // Seed with tags directly (createExpense helper doesn't take tags).
    const mk = async (desc: string, tags: string[]) => {
      const r = await ctx.authed('POST', '/api/v1/expenses', {
        vehicleId,
        category: 'maintenance',
        expenseAmount: 50,
        date: '2024-06-01T00:00:00.000Z',
        description: desc,
        tags,
      });
      expect(r.status, await r.text()).toBeLessThan(300);
    };
    await mk('has both', ['winter', 'tires']);
    await mk('has one', ['winter']);
    await mk('has none', ['summer']);

    // AND semantics: only the row carrying BOTH winter AND tires.
    const res = await ctx.authed('GET', '/api/v1/expenses/export?tags=winter,tires');
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2); // header + 'has both'
    expect(csv).toContain('has both');
    expect(csv).not.toContain('has one');
    expect(csv).not.toContain('has none');
  });

  test('empty export still returns a header-only CSV (200, not an error)', async () => {
    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('date');
    expect(csv.trim().split('\n').length).toBe(1); // header only
  });

  test('neutralizes a formula-injection payload in user free-text (CWE-1236)', async () => {
    // A description that a spreadsheet would EVALUATE if opened raw (the classic
    // DDE payload). The export must prefix it with a single quote so Excel/Sheets
    // treats it as literal text — RFC quoting alone does not stop this. (Quote-
    // free payload so RFC-4180 doesn't double-up embedded `"` and muddy the
    // substring assertions.)
    const vehicleId = await seedVehicle('Daily Driver');
    const payload = "=2+5+cmd|' /C calc'!A0";
    await createExpense(vehicleId, 'misc', 10, payload, '2024-06-01T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    const csv = await res.text();

    // The escaped form is present (leading single quote)...
    expect(csv).toContain(`'${payload}`);
    // ...and no cell OPENS with the raw formula. The CSV quotes every cell, so an
    // un-escaped payload would appear as `"=2+5+...`; the escaped one is `"'=2+5+...`.
    expect(csv).not.toContain(`"${payload}`);
  });

  test('labels amounts in the user’s currency, not a hardcoded USD', async () => {
    // A EUR user's export must say EUR, not USD (the cycle 74-75 hardcoded-USD
    // class). Set the preference through the real settings route, then export.
    const setRes = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'EUR' });
    expect(setRes.status, await setRes.text()).toBe(200);

    const vehicleId = await seedVehicle('Euro Car');
    await createExpense(vehicleId, 'misc', 30, 'Parking', '2024-06-01T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('EUR');
    expect(csv).not.toContain('USD');
  });

  test('defaults the currency column to USD when no preference row exists', async () => {
    // The seeded harness user has no preferences row until something creates one;
    // the export must fall back to USD (and must NOT create a row as a side effect).
    const vehicleId = await seedVehicle('Default Car');
    await createExpense(vehicleId, 'misc', 12, 'Default', '2024-06-01T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    const csv = await res.text();
    expect(csv).toContain('USD');
  });

  test('does not quote a numeric amount end-to-end', async () => {
    // The neutralizer only touches STRING cells, so the numeric amount must
    // reach the CSV un-escaped (no leading quote). (Amounts can't be negative —
    // the create schema enforces min(0) — so the negative-number safety property
    // is pinned at the unit level in csv-safety.test.ts instead.)
    const vehicleId = await seedVehicle('Numbers');
    await createExpense(vehicleId, 'misc', 52.4, 'Plain note', '2024-06-02T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    const csv = await res.text();
    expect(csv).toContain('52.4');
    expect(csv).not.toContain("'52.4");
  });
});
