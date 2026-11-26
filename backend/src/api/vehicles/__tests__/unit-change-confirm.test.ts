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

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const MILES = { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' };

interface ErrorEnvelope {
  error: { details?: { requiresUnitChangeConfirmation?: boolean; changedUnits?: string[] } };
}

function storedDistanceUnit(vehicleId: string): string {
  const row = ctx.sqlite
    .query('SELECT unit_preferences FROM vehicles WHERE id = ?')
    .get(vehicleId) as { unit_preferences: string };
  return JSON.parse(row.unit_preferences).distanceUnit;
}

async function vehicleWithOdometerReading(): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { extra: { unitPreferences: MILES } });
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
    odometer: 45000,
    recordedAt: '2024-06-02T00:00:00.000Z',
  });
  expect(res.status, await res.text()).toBe(201);
  return vehicleId;
}

function toKilometers(vehicleId: string, confirmUnitChange?: boolean): Promise<Response> {
  return ctx.authed('PUT', `/api/v1/vehicles/${vehicleId}`, {
    unitPreferences: { distanceUnit: 'kilometers' },
    ...(confirmUnitChange === undefined ? {} : { confirmUnitChange }),
  });
}

describe('PUT /vehicles/:id unit changes', () => {
  test('rejects a distance unit change on a vehicle with readings unless confirmed', async () => {
    const vehicleId = await vehicleWithOdometerReading();

    const res = await toKilometers(vehicleId);
    const body = await json<ErrorEnvelope>(res);

    expect(res.status).toBe(400);
    expect(body.error.details).toMatchObject({
      requiresUnitChangeConfirmation: true,
      changedUnits: ['distanceUnit'],
    });
    expect(storedDistanceUnit(vehicleId)).toBe('miles');
  });

  test('applies the change when the client confirms it', async () => {
    const vehicleId = await vehicleWithOdometerReading();

    const res = await toKilometers(vehicleId, true);

    expect(res.status, await res.text()).toBe(200);
    expect(storedDistanceUnit(vehicleId)).toBe('kilometers');
  });

  test('treats a set initial mileage as history', async () => {
    const vehicleId = await seedVehicle(ctx, {
      extra: { unitPreferences: MILES, initialMileage: 12000 },
    });

    expect((await toKilometers(vehicleId)).status).toBe(400);
  });

  test('rejects a volume unit change once a fill-up is logged', async () => {
    const vehicleId = await seedVehicle(ctx, { extra: { unitPreferences: MILES } });
    const fill = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 40,
      volume: 10,
      mileage: 30000,
      fuelType: 'Regular',
      date: '2024-06-01T00:00:00.000Z',
    });
    expect(fill.status, await fill.text()).toBe(201);

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${vehicleId}`, {
      unitPreferences: { volumeUnit: 'liters' },
    });

    expect(res.status).toBe(400);
  });

  test('treats a mileage reminder as history', async () => {
    const vehicleId = await seedVehicle(ctx, { extra: { unitPreferences: MILES } });
    const reminder = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Oil change',
      type: 'notification',
      frequency: 'custom',
      intervalValue: 1,
      intervalUnit: 'month',
      startDate: '2024-01-01T00:00:00.000Z',
      triggerMode: 'mileage',
      intervalMileage: 5000,
      lastServiceOdometer: 0,
      vehicleIds: [vehicleId],
    });
    expect(reminder.status, await reminder.text()).toBe(201);

    expect((await toKilometers(vehicleId)).status).toBe(400);
  });

  test('treats a lease mileage limit as history', async () => {
    const vehicleId = await seedVehicle(ctx, { extra: { unitPreferences: MILES } });
    const lease = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
      financingType: 'lease',
      provider: 'Leasing Co',
      originalAmount: 25000,
      termMonths: 36,
      startDate: '2025-01-01',
      paymentAmount: 350,
      paymentFrequency: 'monthly',
      mileageLimit: 12000,
    });
    expect(lease.status, await lease.text()).toBeLessThan(300);

    expect((await toKilometers(vehicleId)).status).toBe(400);
  });

  test('allows a unit change on a vehicle with no readings yet', async () => {
    const vehicleId = await seedVehicle(ctx, { extra: { unitPreferences: MILES } });

    const res = await toKilometers(vehicleId);

    expect(res.status, await res.text()).toBe(200);
    expect(storedDistanceUnit(vehicleId)).toBe('kilometers');
  });

  test('a save that resends the same units needs no confirmation', async () => {
    const vehicleId = await vehicleWithOdometerReading();

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${vehicleId}`, {
      make: 'Honda',
      unitPreferences: MILES,
    });

    const updated = await json<DataEnvelope<{ make: string }>>(res);
    expect(res.status, JSON.stringify(updated)).toBe(200);
    expect(updated.data.make).toBe('Honda');
  });
});
