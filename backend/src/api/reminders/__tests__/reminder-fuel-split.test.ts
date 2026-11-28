import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { createReminderSchema } from '../validation';

const base = {
  name: 'Shared cost',
  type: 'expense',
  frequency: 'monthly',
  startDate: '2024-01-01T00:00:00.000Z',
  vehicleIds: ['v1', 'v2'],
  expenseAmount: 100,
  expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
};

describe('createReminderSchema fuel and split', () => {
  test('rejects a split fuel reminder on expenseCategory', () => {
    const result = createReminderSchema.safeParse({ ...base, expenseCategory: 'fuel' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toContainEqual(['expenseCategory']);
  });

  test('accepts a fuel reminder on one vehicle and a split non-fuel reminder', () => {
    const { expenseSplitConfig: _split, ...single } = base;
    expect(
      createReminderSchema.safeParse({ ...single, vehicleIds: ['v1'], expenseCategory: 'fuel' })
        .success
    ).toBe(true);
    expect(
      createReminderSchema.safeParse({ ...base, expenseCategory: 'maintenance' }).success
    ).toBe(true);
  });
});

describe('PUT /reminders/:id fuel and split', () => {
  let ctx: TestApp;
  beforeEach(async () => {
    ctx = await createTestApp();
  }, SETUP_TIMEOUT_MS);
  afterEach(() => ctx.close());

  test('rejects adding a split to an existing fuel reminder', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const v2 = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      ...base,
      expenseSplitConfig: undefined,
      vehicleIds: [v1],
      expenseCategory: 'fuel',
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);

    const res = await ctx.authed('PUT', `/api/v1/reminders/${body.data.reminder.id}`, {
      vehicleIds: [v1, v2],
      expenseSplitConfig: { method: 'even', vehicleIds: [v1, v2] },
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Fuel expenses cannot be split');
  });

  async function legacyFuelSplitReminder(): Promise<string> {
    const v1 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const v2 = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      ...base,
      vehicleIds: [v1, v2],
      expenseSplitConfig: { method: 'even', vehicleIds: [v1, v2] },
      expenseCategory: 'maintenance',
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    await ctx.sql.run("UPDATE reminders SET expense_category = 'fuel' WHERE id = ?", [
      body.data.reminder.id,
    ]);
    return body.data.reminder.id;
  }

  test('still lets an existing fuel reminder with a split be paused or renamed', async () => {
    const id = await legacyFuelSplitReminder();

    const pause = await ctx.authed('PUT', `/api/v1/reminders/${id}`, { isActive: false });
    const rename = await ctx.authed('PUT', `/api/v1/reminders/${id}`, { name: 'Old fuel split' });

    expect(pause.status, await pause.text()).toBe(200);
    expect(rename.status, await rename.text()).toBe(200);
  });

  test('lets an existing fuel reminder with a split be fixed by changing its category', async () => {
    const id = await legacyFuelSplitReminder();

    const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      expenseCategory: 'maintenance',
    });

    expect(res.status, await res.text()).toBe(200);
  });
});
