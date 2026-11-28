import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, { make: 'Yen', model: 'Car', year: 2021 });
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function seedMoney(): Promise<void> {
  const user = ctx.user.id;
  await ctx.sql.run('UPDATE vehicles SET purchase_price = 2500050 WHERE id = ?', [vehicleId]);
  const expense = async (id: string, amount: number, group: string | null, total: number | null) =>
    await ctx.sql.run(
      'INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, group_id, group_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, vehicleId, user, 'fuel', 1700000000, amount, group, total]
    );
  await expense('e-whole', 100000, null, null);
  await expense('e-frac', 12345, null, null);
  await expense('g-1', 3334, 'g', 10000);
  await expense('g-2', 3333, 'g', 10000);
  await expense('g-3', 3333, 'g', 10000);
  const split = JSON.stringify({
    method: 'absolute',
    allocations: [
      { vehicleId: 'a', amount: 3333 },
      { vehicleId: 'b', amount: 3334 },
      { vehicleId: 'c', amount: 3333 },
    ],
  });
  await ctx.sql.run(
    'INSERT INTO reminders (id, user_id, name, type, frequency, start_date, expense_amount, expense_split_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['r', user, 'R', 'expense', 'monthly', 1700000000, 10000, split]
  );
}

async function stored() {
  return {
    expenses: await ctx.sql.all(
      'SELECT id, expense_amount AS amount, group_total AS total FROM expenses ORDER BY id'
    ),
    price: ((await ctx.sql.get('SELECT purchase_price AS p FROM vehicles')) as { p: number }).p,
    reminder: (await ctx.sql.get(
      "SELECT expense_amount AS amount, expense_split_config AS split FROM reminders WHERE id = 'r'"
    )) as { amount: number; split: string },
  };
}

const allocations = (split: string) =>
  (JSON.parse(split) as { allocations: { amount: number }[] }).allocations.map((a) => a.amount);

async function setCurrency(code: string): Promise<void> {
  const res = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: code });
  expect(res.status).toBe(200);
}

async function seedFinanceAndOtherUser(): Promise<void> {
  const run = (sql: string, params: (string | number)[]) => ctx.sql.run(sql, params);
  await run(
    'INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, residual_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['f', vehicleId, 'Bank', 1000000, 36, 1700000000, 37286, 149]
  );
  await run('INSERT INTO insurance_policies (id, user_id, company) VALUES (?, ?, ?)', [
    'p',
    ctx.user.id,
    'Co',
  ]);
  await run(
    'INSERT INTO insurance_terms (id, policy_id, start_date, end_date, total_cost, monthly_cost) VALUES (?, ?, ?, ?, ?, ?)',
    ['t', 'p', 1700000000, 1730000000, 120000, 10050]
  );
  await run(
    'INSERT INTO insurance_claims (id, policy_id, claim_date, claim_type, payout_amount) VALUES (?, ?, ?, ?, ?)',
    ['c', 'p', 1700000000, 'collision', -150]
  );
  await run("INSERT INTO users (id, email, display_name) VALUES ('other', 'o@x.test', 'O')", []);
  await run(
    "INSERT INTO vehicles (id, user_id, make, model, year, purchase_price) VALUES ('ov', 'other', 'M', 'X', 2020, 2500050)",
    []
  );
  await run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('oe', 'ov', 'other', 'fuel', 1700000000, 12345)",
    []
  );
}

describe('PUT /settings rescales stored money when the decimals change', () => {
  test('rescales financing and insurance, and leaves another user’s rows alone', async () => {
    await seedFinanceAndOtherUser();
    await setCurrency('JPY');
    const one = (sql: string) => ctx.sql.get(sql);
    expect(
      await one(
        "SELECT original_amount, payment_amount, residual_value FROM vehicle_financing WHERE id = 'f'"
      )
    ).toEqual({
      original_amount: 10000,
      payment_amount: 373,
      residual_value: 1,
    });
    expect(
      await one("SELECT total_cost, monthly_cost FROM insurance_terms WHERE id = 't'")
    ).toEqual({
      total_cost: 1200,
      monthly_cost: 101,
    });
    expect(await one("SELECT payout_amount FROM insurance_claims WHERE id = 'c'")).toEqual({
      payout_amount: -2,
    });
    expect(await one("SELECT purchase_price FROM vehicles WHERE id = 'ov'")).toEqual({
      purchase_price: 2500050,
    });
    expect(await one("SELECT expense_amount FROM expenses WHERE id = 'oe'")).toEqual({
      expense_amount: 12345,
    });
  });

  test('USD to JPY divides by 100, keeps splits adding up, and the API shows the same yen', async () => {
    await seedMoney();
    await setCurrency('JPY');
    const after = await stored();
    expect(after.price).toBe(25001);
    expect(after.expenses).toEqual([
      { id: 'e-frac', amount: 123, total: null },
      { id: 'e-whole', amount: 1000, total: null },
      { id: 'g-1', amount: 34, total: 100 },
      { id: 'g-2', amount: 33, total: 100 },
      { id: 'g-3', amount: 33, total: 100 },
    ]);
    expect(after.reminder.amount).toBe(100);
    expect(allocations(after.reminder.split)).toEqual([33, 34, 33]);

    const res = await ctx.authed('GET', '/api/v1/expenses/e-whole');
    expect((await json<DataEnvelope<{ expenseAmount: number }>>(res)).data.expenseAmount).toBe(
      1000
    );
  });

  test('JPY back to USD multiplies by 100 exactly', async () => {
    await seedMoney();
    await setCurrency('JPY');
    await setCurrency('USD');
    const after = await stored();
    expect(after.price).toBe(2500100);
    expect(after.expenses.map((e) => (e as { amount: number }).amount)).toEqual([
      12300, 100000, 3400, 3300, 3300,
    ]);
    expect(allocations(after.reminder.split)).toEqual([3300, 3400, 3300]);
  });

  test('a user with no vehicles or policies can change to and from a no-decimal currency', async () => {
    await ctx.sql.run('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
    expect(await ctx.sql.get('SELECT COUNT(*) AS n FROM insurance_policies')).toEqual({
      n: 0,
    });
    await setCurrency('JPY');
    await setCurrency('USD');
    const res = await ctx.authed('GET', '/api/v1/settings');
    expect((await json<DataEnvelope<{ currencyUnit: string }>>(res)).data.currencyUnit).toBe('USD');
  });

  test('a change between two-decimal currencies, or to the same currency, changes nothing', async () => {
    await seedMoney();
    const before = await stored();
    await setCurrency('EUR');
    await setCurrency('EUR');
    expect(await stored()).toEqual(before);
  });

  test('a JPY owner’s shared car reads in whole yen for a USD viewer', async () => {
    await setCurrency('JPY');
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 1234,
      date: '2024-06-01T00:00:00.000Z',
    });
    const expenseId = (await json<DataEnvelope<{ id: string }>>(created)).data.id;
    expect(
      (
        (await ctx.sql.get('SELECT expense_amount AS a FROM expenses WHERE id = ?', [
          expenseId,
        ])) as {
          a: number;
        }
      ).a
    ).toBe(1234);

    const viewer = await createInvitee(ctx, 'usd-viewer', 'USD Viewer');
    const invite = await ctx.authed('POST', '/api/v1/shares', {
      vehicleId,
      email: viewer.email,
      level: 'viewer',
    });
    const inviteId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
    expect((await viewer.request('POST', `/api/v1/shares/${inviteId}/accept`)).status).toBe(200);

    const read = await viewer.request('GET', `/api/v1/expenses/${expenseId}`);
    expect(read.status).toBe(200);
    expect((await json<DataEnvelope<{ expenseAmount: number }>>(read)).data.expenseAmount).toBe(
      1234
    );

    type Owned = { id: string; ownerCurrency: string };
    const one = await viewer.request('GET', `/api/v1/vehicles/${vehicleId}`);
    expect((await json<DataEnvelope<Owned>>(one)).data.ownerCurrency).toBe('JPY');
    const list = await json<DataEnvelope<Owned[]>>(
      await viewer.request('GET', '/api/v1/vehicles?include=shared')
    );
    expect(list.data.find((v) => v.id === vehicleId)?.ownerCurrency).toBe('JPY');
    const own = await json<DataEnvelope<Owned[]>>(await ctx.authed('GET', '/api/v1/vehicles'));
    expect(own.data.find((v) => v.id === vehicleId)?.ownerCurrency).toBe('JPY');
  });
});
