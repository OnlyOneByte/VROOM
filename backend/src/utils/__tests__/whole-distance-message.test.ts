import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../test-helpers/http-client';
import { seedVehicle } from '../../test-helpers/seed';
import { WHOLE_DISTANCE_MESSAGE } from '../validation';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx);
});
afterEach(() => ctx.close());

describe('a decimal distance gets a readable message', () => {
  const cases: [string, string, string, (id: string) => unknown][] = [
    [
      'odometer reading',
      'POST',
      '/api/v1/odometer/:vehicleId',
      () => ({ odometer: 12345.6, recordedAt: '2024-02-01T12:00:00.000Z' }),
    ],
    [
      'expense mileage',
      'POST',
      '/api/v1/expenses',
      (id) => ({
        vehicleId: id,
        category: 'misc',
        expenseAmount: 10,
        date: '2024-02-01T12:00:00.000Z',
        mileage: 12345.6,
      }),
    ],
    [
      'vehicle initial mileage',
      'PUT',
      '/api/v1/vehicles/:vehicleId',
      () => ({ initialMileage: 0.5 }),
    ],
    [
      'reminder mileage interval',
      'POST',
      '/api/v1/reminders',
      (id) => ({
        name: 'Oil change',
        type: 'notification',
        frequency: 'monthly',
        triggerMode: 'mileage',
        intervalMileage: 5000.5,
        startDate: '2024-01-15T00:00:00.000Z',
        vehicleIds: [id],
      }),
    ],
  ];

  for (const [label, method, route, body] of cases) {
    test(label, async () => {
      const res = await ctx.authed(method, route.replace(':vehicleId', vehicleId), body(vehicleId));
      const text = await res.text();
      expect(res.status, text).toBe(400);
      expect(text).toContain(WHOLE_DISTANCE_MESSAGE);
    });
  }
});
