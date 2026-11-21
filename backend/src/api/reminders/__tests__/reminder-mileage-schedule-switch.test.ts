import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
});
afterEach(() => {
  setSystemTime();
  ctx.close();
});

interface StoredSchedule {
  trigger_mode: string;
  next_due_date: number | null;
  interval_value: number | null;
  interval_unit: string | null;
}

function storedSchedule(id: string): StoredSchedule {
  return ctx.sqlite
    .query(
      'SELECT trigger_mode, next_due_date, interval_value, interval_unit FROM reminders WHERE id = ?'
    )
    .get(id) as StoredSchedule;
}

async function createMileageOnlyCustom(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Tire rotation',
    type: 'expense',
    expenseCategory: 'maintenance',
    expenseAmount: 80,
    frequency: 'custom',
    triggerMode: 'mileage',
    intervalMileage: 5000,
    lastServiceOdometer: 10000,
    startDate: '2024-01-01',
    vehicleIds: [vehicleId],
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

describe('a stored mileage-only reminder with a custom frequency and no interval', () => {
  test.each(['time', 'both'])('cannot switch to %s without an interval', async (triggerMode) => {
    const id = await createMileageOnlyCustom();

    const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      triggerMode,
      intervalMileage: 5000,
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('intervalValue');
    expect(storedSchedule(id)).toEqual({
      trigger_mode: 'mileage',
      next_due_date: null,
      interval_value: null,
      interval_unit: null,
    });
  });

  test('switches once the interval is supplied', async () => {
    const id = await createMileageOnlyCustom();
    setSystemTime(new Date('2026-03-15T12:00:00.000Z'));

    const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      triggerMode: 'both',
      intervalMileage: 5000,
      intervalValue: 3,
      intervalUnit: 'month',
    });

    expect(res.status, await res.text()).toBe(200);
    const saved = storedSchedule(id);
    expect(saved).toMatchObject({
      trigger_mode: 'both',
      interval_value: 3,
      interval_unit: 'month',
    });
    expect(saved.next_due_date, 'the first 3-monthly date from 2024-01-01 on or after today').toBe(
      Date.parse('2026-04-01T12:00:00.000Z') / 1000
    );
  });

  test('adds nothing to the recurring cost', async () => {
    await createMileageOnlyCustom();
    const res = await ctx.authed('GET', '/api/v1/reminders/recurring-cost');
    const body = await json<DataEnvelope<{ count: number; monthlyTotal: number }>>(res);
    expect(body.data).toEqual({ count: 0, monthlyTotal: 0 });
  });
});

describe('a mileage-only reminder left on monthly', () => {
  test('adds nothing to the recurring cost', async () => {
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Oil change',
      type: 'expense',
      expenseCategory: 'maintenance',
      expenseAmount: 60,
      frequency: 'monthly',
      triggerMode: 'mileage',
      intervalMileage: 5000,
      lastServiceOdometer: 10000,
      startDate: '2024-01-01',
      vehicleIds: [vehicleId],
    });
    expect(res.status).toBe(201);

    const cost = await json<DataEnvelope<{ count: number; monthlyTotal: number }>>(
      await ctx.authed('GET', '/api/v1/reminders/recurring-cost')
    );
    expect(cost.data).toEqual({ count: 0, monthlyTotal: 0 });
  });
});
