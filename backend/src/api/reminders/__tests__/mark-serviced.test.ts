/**
 * Tests POST /:id/mark-serviced, which re-arms a reminder on each axis, through the real route and DB.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { addOdometerReading } from './_helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

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

describe('POST /:id/mark-serviced re-arms the reminder', () => {
  test('mileage: anchors lastServiceOdometer to current + recomputes nextDueOdometer', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
    const id = await createMileageReminder(vehicleId); // last=30000, next=35000
    expect(reminderRow(id).next_due_odometer).toBe(35000);

    // Vehicle has driven to 36500; servicing now should re-anchor there.
    await addOdometerReading(ctx, vehicleId, 36500);
    const res = await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`);
    expect(res.status, await res.text()).toBe(200);

    const r = reminderRow(id);
    expect(r.last_service_odometer).toBe(36500);
    expect(r.next_due_odometer, '36500 + 5000 interval').toBe(41500);
    expect(r.last_triggered_at, 'lastTriggeredAt stamped').not.toBeNull();
  });

  test('a re-armed mileage reminder that was due is no longer due at the trigger', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
    const id = await createMileageReminder(vehicleId); // next milestone 35000
    await addOdometerReading(ctx, vehicleId, 35200); // past it → due

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
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
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

  test('time: a MULTI-period-overdue reminder advances to a FUTURE due date (not still overdue)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
    // A monthly reminder whose startDate is YEARS in the past → nextDueDate starts many periods
    // overdue. A single one-period advance would leave it still <= now (re-fires immediately); the
    // catch-up loop must land it strictly in the future.
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Monthly check',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2020-01-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    const id = body.data.reminder.id;

    const res = await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`);
    expect(res.status).toBe(200);

    const after = reminderRow(id).next_due_date;
    expect(after).not.toBeNull();
    // next_due_date is stored as unix seconds, so compare against seconds rather than Date.now().
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect((after as number) > nowSeconds, 'serviced reminder is no longer overdue').toBe(true);
  });

  test('time: an EARLY service (nextDueDate already in the FUTURE) advances exactly one period, stays future', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
    // Early service: nextDueDate is already in the future, so the catch-up loop does not run. The re-arm
    // advances one period from the scheduled date, not from now.
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Future registration',
      type: 'notification',
      frequency: 'yearly',
      startDate: '2099-06-15T00:00:00.000Z',
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
    expect(after).not.toBeNull();
    // Advanced exactly one year forward from the already-future scheduled date (≈365-366 days),
    // NOT collapsed back toward now. Bounds the delta to one yearly period (in unix SECONDS).
    const deltaDays = ((after as number) - (before as number)) / 86_400;
    expect(deltaDays).toBeGreaterThanOrEqual(364);
    expect(deltaDays).toBeLessThanOrEqual(367);
    expect((after as number) > Math.floor(Date.now() / 1000)).toBe(true);
  });

  test('both: moves the mileage milestone AND advances the date', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
    const id = await createMileageReminder(vehicleId, {
      triggerMode: 'both',
      startDate: '2024-02-15T00:00:00.000Z',
    });
    await addOdometerReading(ctx, vehicleId, 38000);
    const before = reminderRow(id);
    expect(before.next_due_date).not.toBeNull();

    const res = await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`);
    expect(res.status).toBe(200);

    const after = reminderRow(id);
    expect(after.next_due_odometer, '38000 + 5000').toBe(43000);
    expect((after.next_due_date as number) > (before.next_due_date as number)).toBe(true);
  });

  // A bounded reminder serviced after its endDate must be deactivated, not re-armed to a future date.
  test('a bounded reminder serviced past its endDate is DEACTIVATED, not re-armed forward', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Bounded registration',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    const id = body.data.reminder.id;

    const res = await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`);
    const resBody = await json<DataEnvelope<{ isActive: boolean }>>(res);
    expect(res.status, JSON.stringify(resBody)).toBe(200);

    const row = ctx.sqlite.query('SELECT is_active FROM reminders WHERE id = ?').get(id) as {
      is_active: number;
    };
    expect(row.is_active, 'a serviced-past-endDate reminder must be deactivated').toBe(0);
    // The response echoes the deactivated state.
    expect(resBody.data.isActive).toBe(false);
  });

  test('a non-existent / cross-tenant id returns 404', async () => {
    const res = await ctx.authed('POST', '/api/v1/reminders/does-not-exist/mark-serviced');
    expect(res.status).toBe(404);
  });
});
