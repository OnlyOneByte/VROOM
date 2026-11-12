import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const seedCivic = (nickname?: string): Promise<string> =>
  seedVehicle(ctx, {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
    ...(nickname ? { nickname } : {}),
  });

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
    const vehicleId = await seedCivic('Daily Driver');
    await createExpense(vehicleId, 'fuel', 52.4, 'Shell top-up', '2024-06-01T00:00:00.000Z');
    await createExpense(vehicleId, 'maintenance', 120, 'Oil change', '2024-06-10T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('.csv');

    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('date');
    expect(lines[0]).toContain('vehicle');
    expect(lines[0]).toContain('amount');
    expect(csv).toContain('Daily Driver');
    expect(csv).toContain('Shell top-up');
    expect(csv).toContain('Oil change');
  });

  test('category filter narrows the export', async () => {
    const vehicleId = await seedCivic();
    await createExpense(vehicleId, 'fuel', 40, 'Fuel A', '2024-06-01T00:00:00.000Z');
    await createExpense(vehicleId, 'fuel', 41, 'Fuel B', '2024-06-02T00:00:00.000Z');
    await createExpense(vehicleId, 'maintenance', 200, 'Brakes', '2024-06-03T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export?category=maintenance');
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(csv).toContain('Brakes');
    expect(csv).not.toContain('Fuel A');
  });

  test('search filter narrows the export to matching rows (matches the table)', async () => {
    const vehicleId = await seedCivic();
    await createExpense(
      vehicleId,
      'maintenance',
      120,
      'Jiffy Lube oil change',
      '2024-06-01T00:00:00.000Z'
    );
    await createExpense(vehicleId, 'fuel', 40, 'Shell top-up', '2024-06-02T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export?search=jiffy');
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(csv).toContain('Jiffy Lube');
    expect(csv).not.toContain('Shell top-up');
  });

  test('tags filter narrows the export (AND semantics, comma-joined param)', async () => {
    const vehicleId = await seedCivic();
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

    const res = await ctx.authed('GET', '/api/v1/expenses/export?tags=winter,tires');
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(csv).toContain('has both');
    expect(csv).not.toContain('has one');
    expect(csv).not.toContain('has none');
  });

  test('empty export still returns a header-only CSV (200, not an error)', async () => {
    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('date');
    expect(csv.trim().split('\n').length).toBe(1);
  });

  test('neutralizes a formula-injection payload in user free-text (CWE-1236)', async () => {
    const vehicleId = await seedCivic('Daily Driver');
    const payload = "=2+5+cmd|' /C calc'!A0";
    await createExpense(vehicleId, 'misc', 10, payload, '2024-06-01T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    const csv = await res.text();

    expect(csv).toContain(`'${payload}`);
    expect(csv).not.toContain(`"${payload}`);
  });

  test('labels amounts in the user’s currency, not a hardcoded USD', async () => {
    const setRes = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'EUR' });
    expect(setRes.status, await setRes.text()).toBe(200);

    const vehicleId = await seedCivic('Euro Car');
    await createExpense(vehicleId, 'misc', 30, 'Parking', '2024-06-01T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('EUR');
    expect(csv).not.toContain('USD');
  });

  test('defaults the currency column to USD when no preference row exists', async () => {
    const vehicleId = await seedCivic('Default Car');
    await createExpense(vehicleId, 'misc', 12, 'Default', '2024-06-01T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    const csv = await res.text();
    expect(csv).toContain('USD');
  });

  test('does not quote a numeric amount end-to-end', async () => {
    const vehicleId = await seedCivic('Numbers');
    await createExpense(vehicleId, 'misc', 52.4, 'Plain note', '2024-06-02T00:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    const csv = await res.text();
    expect(csv).toContain('52.4');
    expect(csv).not.toContain("'52.4");
  });
});
