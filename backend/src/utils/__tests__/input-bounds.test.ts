import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../test-helpers/http-client';
import { seedVehicle } from '../../test-helpers/seed';
import { hasAtMostTwoDecimals } from '../money';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx);
});
afterEach(() => ctx.close());

function expenseBody(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    vehicleId,
    category: 'misc',
    expenseAmount: 10,
    date: '2024-02-01T12:00:00.000Z',
    ...overrides,
  };
}

function splitBody(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    splitConfig: { method: 'even', vehicleIds: [vehicleId] },
    category: 'misc',
    date: '2024-02-01',
    totalAmount: 30,
    ...overrides,
  };
}

function reminderBody(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'Inspection',
    type: 'notification',
    frequency: 'custom',
    intervalValue: 2,
    intervalUnit: 'year',
    startDate: '2024-01-15T00:00:00.000Z',
    vehicleIds: [vehicleId],
    ...overrides,
  };
}

async function status(method: string, path: string, body: unknown): Promise<number> {
  const res = await ctx.authed(method, path, body);
  await res.text();
  return res.status;
}

describe('hasAtMostTwoDecimals', () => {
  test('accepts whole and two-decimal amounts despite binary rounding', () => {
    for (const n of [1, 10.99, 0.1, 0.07, 12.34, 999_999.99]) {
      expect(hasAtMostTwoDecimals(n), String(n)).toBe(true);
    }
  });

  test('rejects sub-cent amounts', () => {
    for (const n of [0.005, 10.999, 1.001]) {
      expect(hasAtMostTwoDecimals(n), String(n)).toBe(false);
    }
  });
});

describe('expense amounts', () => {
  test('accept up to 1,000,000 with two decimals', async () => {
    expect(
      await status('POST', '/api/v1/expenses', expenseBody({ expenseAmount: 1_000_000 }))
    ).toBe(201);
    expect(await status('POST', '/api/v1/expenses', expenseBody({ expenseAmount: 10.99 }))).toBe(
      201
    );
  });

  test.each([1_000_000.01, 1e13, 1e300, 0.005, 10.999])('reject %p on create', async (amount) => {
    expect(await status('POST', '/api/v1/expenses', expenseBody({ expenseAmount: amount }))).toBe(
      400
    );
  });

  test('reject an out-of-range amount on update', async () => {
    const res = await ctx.authed('POST', '/api/v1/expenses', expenseBody({}));
    const created = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status).toBe(201);
    expect(
      await status('PUT', `/api/v1/expenses/${created.data.id}`, { expenseAmount: 1e13 })
    ).toBe(400);
  });

  test('reject an out-of-range split total or allocation', async () => {
    expect(
      await status('POST', '/api/v1/expenses/split', splitBody({ totalAmount: 1_000_001 }))
    ).toBe(400);
    expect(
      await status(
        'POST',
        '/api/v1/expenses/split',
        splitBody({
          totalAmount: 10.005,
          splitConfig: {
            method: 'absolute',
            allocations: [{ vehicleId, amount: 10.005 }],
          },
        })
      )
    ).toBe(400);
  });

  test('round-trip through CSV export and import at the maximum', async () => {
    expect(
      await status(
        'POST',
        '/api/v1/expenses',
        expenseBody({ expenseAmount: 1_000_000, mileage: 10_000_000 })
      )
    ).toBe(201);
    const csv = await (await ctx.authed('GET', '/api/v1/expenses/export')).text();
    ctx.sqlite.run('DELETE FROM expenses WHERE user_id = ?', [ctx.user.id]);

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<DataEnvelope<{ imported: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);
  });
});

describe('odometer readings', () => {
  test('accept up to 10,000,000 and reject more', async () => {
    const path = `/api/v1/odometer/${vehicleId}`;
    const reading = (odometer: number) => ({ odometer, recordedAt: '2024-02-01T12:00:00.000Z' });
    expect(await status('POST', path, reading(10_000_000))).toBe(201);
    expect(await status('POST', path, reading(10_000_001))).toBe(400);
    expect(await status('POST', path, reading(9e15))).toBe(400);
  });

  test('reject an out-of-range expense mileage, initial mileage or last service odometer', async () => {
    expect(await status('POST', '/api/v1/expenses', expenseBody({ mileage: 10_000_001 }))).toBe(
      400
    );
    expect(
      await status('PUT', `/api/v1/vehicles/${vehicleId}`, { initialMileage: 10_000_001 })
    ).toBe(400);
    expect(
      await status('POST', '/api/v1/reminders', reminderBody({ lastServiceOdometer: 10_000_001 }))
    ).toBe(400);
  });
});

describe('reminder intervals', () => {
  test.each([
    [100, 'year', 201],
    [101, 'year', 400],
    [1200, 'month', 201],
    [1201, 'month', 400],
    [1_000_000_000, 'year', 400],
  ] as const)('%p %s gives %p', async (intervalValue, intervalUnit, expected) => {
    expect(
      await status('POST', '/api/v1/reminders', reminderBody({ intervalValue, intervalUnit }))
    ).toBe(expected);
  });

  async function createReminder(): Promise<string> {
    const res = await ctx.authed('POST', '/api/v1/reminders', reminderBody({}));
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    return body.data.reminder.id;
  }

  test('an update that sends only the value is checked against the stored unit', async () => {
    const id = await createReminder();
    expect(await status('PUT', `/api/v1/reminders/${id}`, { intervalValue: 101 })).toBe(400);
    expect(await status('PUT', `/api/v1/reminders/${id}`, { intervalValue: 100 })).toBe(200);
  });

  test('a stored reminder already over the bounds can still be paused and renamed', async () => {
    const id = await createReminder();
    ctx.sqlite
      .query('UPDATE reminders SET interval_value = ?, last_service_odometer = ? WHERE id = ?')
      .run(1_000_000_000, 9e15, id);
    expect(await status('PUT', `/api/v1/reminders/${id}`, { isActive: false })).toBe(200);
    expect(await status('PUT', `/api/v1/reminders/${id}`, { name: 'Old reminder' })).toBe(200);
  });
});
