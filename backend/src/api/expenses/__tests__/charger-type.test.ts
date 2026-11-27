import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, {
    make: 'Tesla',
    model: 'Model 3',
    year: 2022,
  });
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface Row {
  id: string;
  chargerType: string | null;
}

const charge = (chargerType: unknown, fuelType = 'Electric') => ({
  vehicleId,
  category: 'fuel',
  expenseAmount: 12,
  date: '2024-06-01T00:00:00.000Z',
  mileage: 1000,
  volume: 40,
  fuelType,
  chargerType,
});

async function create(body: object): Promise<Row> {
  const res = await ctx.authed('POST', '/api/v1/expenses', body);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await json<DataEnvelope<Row>>(res)).data;
}

describe('charger type on charging expenses', () => {
  test.each(['home', 'workplace', 'public_l2', 'dc_fast'])('a charge records %s', async (type) => {
    const row = await create(charge(type));
    expect(row.chargerType).toBe(type);
    const read = await ctx.authed('GET', `/api/v1/expenses/${row.id}`);
    expect((await json<DataEnvelope<Row>>(read)).data.chargerType).toBe(type);
  });

  test('is optional and stays empty when not given', async () => {
    const { chargerType: _omit, ...body } = charge(undefined);
    expect((await create(body)).chargerType).toBeNull();
  });

  test('an unknown charger type is refused', async () => {
    const res = await ctx.authed('POST', '/api/v1/expenses', charge('garage'));
    expect(res.status).toBe(400);
  });

  test('is cleared on a fill-up that is not a charge, and on a non-fuel expense', async () => {
    expect((await create(charge('home', 'Regular'))).chargerType).toBeNull();
    const misc = await create({
      vehicleId,
      category: 'maintenance',
      expenseAmount: 50,
      date: '2024-06-02T00:00:00.000Z',
      chargerType: 'home',
    });
    expect(misc.chargerType).toBeNull();
  });

  test('a CSV export carries it and re-imports it', async () => {
    await create(charge('home'));
    const exported = await ctx.authed('GET', '/api/v1/expenses/export');
    const csv = await exported.text();
    expect(csv.split('\n')[0]).toContain('"chargerType"');
    expect(csv).toContain('"home"');

    ctx.sqlite.run('DELETE FROM expenses');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    expect(res.status).toBe(200);
    const row = ctx.sqlite.query('SELECT charger_type FROM expenses').get();
    expect(row).toEqual({ charger_type: 'home' });
  });

  test('a CSV row with an unknown charger type is an error on that row', async () => {
    const csv = [
      'date,vehicle,category,amount,mileage,volume,fuelType,chargerType',
      '2024-06-01T00:00:00.000Z,2022 Tesla Model 3,fuel,10,1000,30,Electric,DC_Fast',
      '2024-06-02T00:00:00.000Z,2022 Tesla Model 3,fuel,10,1010,30,Electric,garage',
    ].join('\n');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: true });
    const body = await json<{
      data: { rows: { row: number; status: string; message?: string }[] };
    }>(res);
    expect(body.data.rows.map((r) => r.status)).toEqual(['ready', 'error']);
    expect(body.data.rows[1]?.message).toMatch(/Charger type must be one of/);
  });

  test('an update can set and clear it, and switching to gas clears it', async () => {
    const row = await create(charge(null));
    const set = await ctx.authed('PUT', `/api/v1/expenses/${row.id}`, { chargerType: 'dc_fast' });
    expect((await json<DataEnvelope<Row>>(set)).data.chargerType).toBe('dc_fast');
    const gas = await ctx.authed('PUT', `/api/v1/expenses/${row.id}`, { fuelType: 'Regular' });
    expect((await json<DataEnvelope<Row>>(gas)).data.chargerType).toBeNull();
  });
});
