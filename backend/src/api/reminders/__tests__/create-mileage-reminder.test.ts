/**
 * T4 (cycle 31): mileage reminders are now API-creatable — the validation refinements (D4) + the
 * server-derived nextDueOdometer / nullable nextDueDate wiring, end-to-end through the real stack.
 *
 * Before this, the mileage trigger engine (C25) was dormant: no route accepted triggerMode/
 * intervalMileage, so a mileage reminder could only be seeded via sqlite. This pins the create +
 * update contract:
 *   - a mileage reminder requires intervalMileage + exactly one vehicle (D4); lastServiceOdometer
 *     defaults to the vehicle's current odometer when omitted
 *   - nextDueOdometer is SERVER-DERIVED (= lastServiceOdometer + intervalMileage), not client input
 *   - a pure-mileage reminder persists with a NULL next_due_date; a 'both' reminder keeps startDate
 *   - the refinements reject the bad shapes (no intervalMileage, multi-vehicle)
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules; keep imports to harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make: 'Honda', model: 'CR-V', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function addOdometerReading(vehicleId: string, odometer: number): Promise<void> {
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
    odometer,
    recordedAt: '2024-06-01T00:00:00.000Z',
  });
  expect(res.status, `odometer ${odometer}`).toBe(201);
}

interface ReminderRowDb {
  trigger_mode: string;
  interval_mileage: number | null;
  last_service_odometer: number | null;
  next_due_odometer: number | null;
  next_due_date: number | null;
}

function reminderRow(id: string): ReminderRowDb {
  return ctx.sqlite
    .query(
      'SELECT trigger_mode, interval_mileage, last_service_odometer, next_due_odometer, next_due_date FROM reminders WHERE id = ?'
    )
    .get(id) as ReminderRowDb;
}

const MILEAGE_BASE = {
  name: 'Oil change',
  type: 'notification' as const,
  frequency: 'custom' as const,
  intervalValue: 1,
  intervalUnit: 'month' as const,
  startDate: '2024-01-01T00:00:00.000Z',
};

describe('create mileage reminder (T4 — API-creatable + derived fields)', () => {
  test('explicit lastServiceOdometer → nextDueOdometer is derived (last + interval)', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      ...MILEAGE_BASE,
      triggerMode: 'mileage',
      intervalMileage: 5000,
      lastServiceOdometer: 30000,
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const r = reminderRow(body.data.reminder.id);
    expect(r.trigger_mode).toBe('mileage');
    expect(r.interval_mileage).toBe(5000);
    expect(r.last_service_odometer).toBe(30000);
    expect(r.next_due_odometer, 'server-derived = 30000 + 5000').toBe(35000);
    expect(r.next_due_date, 'a pure-mileage reminder has no time axis').toBeNull();
  });

  test('omitted lastServiceOdometer defaults to the vehicle current odometer', async () => {
    const vehicleId = await seedVehicle();
    await addOdometerReading(vehicleId, 42000);

    const res = await ctx.authed('POST', '/api/v1/reminders', {
      ...MILEAGE_BASE,
      triggerMode: 'mileage',
      intervalMileage: 6000,
      vehicleIds: [vehicleId],
      // lastServiceOdometer omitted → defaults to current (42000)
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const r = reminderRow(body.data.reminder.id);
    expect(r.last_service_odometer).toBe(42000);
    expect(r.next_due_odometer).toBe(48000);
  });

  test("a 'both' reminder keeps its time axis (startDate) AND the mileage cache", async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      ...MILEAGE_BASE,
      triggerMode: 'both',
      intervalMileage: 10000,
      lastServiceOdometer: 40000,
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const r = reminderRow(body.data.reminder.id);
    expect(r.trigger_mode).toBe('both');
    expect(r.next_due_odometer).toBe(50000);
    expect(r.next_due_date, 'both keeps the time axis = startDate').not.toBeNull();
  });

  test('a plain time reminder (default triggerMode) has NULL mileage fields', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Registration',
      type: 'notification',
      frequency: 'yearly',
      startDate: '2024-02-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const r = reminderRow(body.data.reminder.id);
    expect(r.trigger_mode).toBe('time');
    expect(r.interval_mileage).toBeNull();
    expect(r.next_due_odometer).toBeNull();
    expect(r.next_due_date).not.toBeNull();
  });

  test('rejects a mileage reminder with no intervalMileage (D4)', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      ...MILEAGE_BASE,
      triggerMode: 'mileage',
      lastServiceOdometer: 30000,
      vehicleIds: [vehicleId],
      // no intervalMileage
    });
    expect(res.status).toBe(400);
  });

  test('rejects a mileage reminder linked to more than one vehicle (D4)', async () => {
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      ...MILEAGE_BASE,
      triggerMode: 'mileage',
      intervalMileage: 5000,
      lastServiceOdometer: 30000,
      vehicleIds: [v1, v2],
    });
    expect(res.status).toBe(400);
  });

  test('updating intervalMileage recomputes nextDueOdometer', async () => {
    const vehicleId = await seedVehicle();
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      ...MILEAGE_BASE,
      triggerMode: 'mileage',
      intervalMileage: 5000,
      lastServiceOdometer: 30000,
      vehicleIds: [vehicleId],
    });
    const cBody = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(cBody)).toBe(201);
    const id = cBody.data.reminder.id;
    expect(reminderRow(id).next_due_odometer).toBe(35000);

    const upd = await ctx.authed('PUT', `/api/v1/reminders/${id}`, { intervalMileage: 8000 });
    expect(upd.status, await upd.text()).toBe(200);
    // 30000 (unchanged anchor) + 8000 = 38000
    expect(reminderRow(id).next_due_odometer).toBe(38000);
  });
});
