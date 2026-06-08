/**
 * T4 part 2 (cycle 32): POST /:id/mark-serviced re-arm (D3).
 *
 * A fired mileage reminder stays due until the user marks it serviced (there's no auto-re-arm on the
 * mileage axis — C25). This endpoint re-arms it: anchor lastServiceOdometer to the CURRENT odometer
 * and recompute the nextDueOdometer milestone; for the time axis, advance nextDueDate one period.
 * Pinned end-to-end through the real route → repo → DB stack:
 *   - mileage: lastServiceOdometer := current, nextDueOdometer := current + interval
 *   - time: nextDueDate advances one period; lastTriggeredAt stamped
 *   - both: both axes move
 *   - after re-arm, a mileage reminder that WAS due is no longer due at the trigger (the milestone moved)
 *   - cross-tenant id → 404, no mutation
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
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Mazda',
    model: 'CX-5',
    year: 2020,
  });
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
  last_service_odometer: number | null;
  next_due_odometer: number | null;
  next_due_date: number | null;
  last_triggered_at: number | null;
}

function reminderRow(id: string): ReminderRowDb {
  return ctx.sqlite
    .query(
      'SELECT trigger_mode, last_service_odometer, next_due_odometer, next_due_date, last_triggered_at FROM reminders WHERE id = ?'
    )
    .get(id) as ReminderRowDb;
}

async function createMileageReminder(
  vehicleId: string,
  over: Record<string, unknown> = {}
): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Oil change',
    type: 'notification',
    frequency: 'custom',
    intervalValue: 1,
    intervalUnit: 'month',
    startDate: '2024-01-01T00:00:00.000Z',
    triggerMode: 'mileage',
    intervalMileage: 5000,
    lastServiceOdometer: 30000,
    vehicleIds: [vehicleId],
    ...over,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

describe('POST /:id/mark-serviced — re-arm (D3)', () => {
  test('mileage: anchors lastServiceOdometer to current + recomputes nextDueOdometer', async () => {
    const vehicleId = await seedVehicle();
    const id = await createMileageReminder(vehicleId); // last=30000, next=35000
    expect(reminderRow(id).next_due_odometer).toBe(35000);

    // Vehicle has driven to 36500; servicing now should re-anchor there.
    await addOdometerReading(vehicleId, 36500);
    const res = await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`);
    expect(res.status, await res.text()).toBe(200);

    const r = reminderRow(id);
    expect(r.last_service_odometer).toBe(36500);
    expect(r.next_due_odometer, '36500 + 5000 interval').toBe(41500);
    expect(r.last_triggered_at, 'lastTriggeredAt stamped').not.toBeNull();
  });

  test('a re-armed mileage reminder that was due is no longer due at the trigger', async () => {
    const vehicleId = await seedVehicle();
    const id = await createMileageReminder(vehicleId); // next milestone 35000
    await addOdometerReading(vehicleId, 35200); // past it → due

    // Fires once.
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const firedCount = () =>
      (
        ctx.sqlite
          .query('SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = ?')
          .get(id) as { n: number }
      ).n;
    expect(firedCount()).toBe(1);

    // Service it → milestone moves to 35200 + 5000 = 40200, ahead of the current 35200.
    const res = await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`);
    expect(res.status).toBe(200);
    expect(reminderRow(id).next_due_odometer).toBe(40200);

    // Trigger again: not due (current 35200 < 40200) → no new notification.
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(firedCount(), 'no new notification after re-arm moved the milestone ahead').toBe(1);
  });

  test('time: advances nextDueDate one period', async () => {
    const vehicleId = await seedVehicle();
    // A monthly time reminder; nextDueDate starts at startDate (2024-02-15).
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Registration',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-02-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    const id = body.data.reminder.id;
    const before = reminderRow(id).next_due_date;
    expect(before).not.toBeNull();

    const res = await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`);
    expect(res.status).toBe(200);
    const after = reminderRow(id).next_due_date;
    // Advanced by ~one month (28-31 days); assert it moved strictly forward.
    expect(after).not.toBeNull();
    expect((after as number) > (before as number), 'nextDueDate advanced forward').toBe(true);
  });

  test('both: moves the mileage milestone AND advances the date', async () => {
    const vehicleId = await seedVehicle();
    const id = await createMileageReminder(vehicleId, {
      triggerMode: 'both',
      startDate: '2024-02-15T00:00:00.000Z',
    });
    await addOdometerReading(vehicleId, 38000);
    const before = reminderRow(id);
    expect(before.next_due_date).not.toBeNull();

    const res = await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`);
    expect(res.status).toBe(200);

    const after = reminderRow(id);
    expect(after.next_due_odometer, '38000 + 5000').toBe(43000);
    expect((after.next_due_date as number) > (before.next_due_date as number)).toBe(true);
  });

  test('a non-existent / cross-tenant id returns 404', async () => {
    const res = await ctx.authed('POST', '/api/v1/reminders/does-not-exist/mark-serviced');
    expect(res.status).toBe(404);
  });
});
