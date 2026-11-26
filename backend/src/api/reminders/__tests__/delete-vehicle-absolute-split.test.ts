import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

interface ReminderBody {
  reminder: {
    id: string;
    expenseAmount: number | null;
    expenseSplitConfig: { method: string; allocations?: { vehicleId: string; amount: number }[] };
  };
}

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function createAbsoluteReminder(
  allocations: { vehicleId: string; amount: number }[]
): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Shared insurance',
    type: 'expense',
    expenseCategory: 'financial',
    frequency: 'monthly',
    startDate: '2024-01-01T00:00:00.000Z',
    vehicleIds: allocations.map((a) => a.vehicleId),
    expenseAmount: allocations.reduce((s, a) => s + a.amount, 0),
    expenseSplitConfig: { method: 'absolute', allocations },
  });
  expect(res.status).toBe(201);
  return (await json<DataEnvelope<ReminderBody & { reminder: { id: string } }>>(res)).data.reminder
    .id;
}

async function readReminder(id: string): Promise<ReminderBody['reminder']> {
  const list = await json<DataEnvelope<ReminderBody[]>>(
    await ctx.authed('GET', '/api/v1/reminders')
  );
  const found = list.data.find((r) => r.reminder.id === id);
  if (!found) throw new Error(`reminder ${id} not listed`);
  return found.reminder;
}

describe('deleting a vehicle from an absolute reminder split', () => {
  test('lowers expenseAmount so the remaining allocations still sum to it', async () => {
    const a = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const b = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2023 });
    const c = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2021 });
    const id = await createAbsoluteReminder([
      { vehicleId: a, amount: 30 },
      { vehicleId: b, amount: 20.5 },
      { vehicleId: c, amount: 50 },
    ]);

    expect((await ctx.authed('DELETE', `/api/v1/vehicles/${b}`)).status).toBeLessThan(300);

    const after = await readReminder(id);
    const allocations = after.expenseSplitConfig.allocations ?? [];
    expect(allocations.map((x) => x.vehicleId)).toEqual([a, c]);
    expect(after.expenseAmount).toBe(80);
    expect(allocations.reduce((s, x) => s + x.amount, 0)).toBe(after.expenseAmount ?? -1);

    const edit = await ctx.authed('PUT', `/api/v1/reminders/${id}`, { name: 'Renamed' });
    expect(edit.status, 'editing the pruned reminder must pass split-sum validation').toBe(200);
  });

  test('a split collapsed to one vehicle keeps only that vehicle’s amount', async () => {
    const a = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const b = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2023 });
    const id = await createAbsoluteReminder([
      { vehicleId: a, amount: 60.25 },
      { vehicleId: b, amount: 39.75 },
    ]);

    expect((await ctx.authed('DELETE', `/api/v1/vehicles/${b}`)).status).toBeLessThan(300);

    const after = await readReminder(id);
    expect(after.expenseSplitConfig).toBeNull();
    expect(after.expenseAmount).toBe(60.25);
  });
});
