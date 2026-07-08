/**
 * push-notifications T4b — the request-driven trigger hook (D2, ACK'd 2026-07-08).
 *
 * The trigger-service, AFTER inserting a reminder_notifications row on EITHER axis (time
 * `processNotificationPeriod` + mileage `processMileageReminder`), fires `notifyUser` with a payload
 * derived from the reminder — best-effort (design §4). This drives the REAL trigger endpoint (route →
 * service → repo → DB) with a FAKE PushSender injected via the T4a DI seam, so the whole hook runs
 * ZERO-network with no VAPID keypair. Pins:
 *   - a TIME-axis notification fires notifyUser once with `{title:'<name> due', body:'…now due',
 *     tag:reminder.id, url:'/reminders'}`.
 *   - a MILEAGE-axis notification fires notifyUser with a mileage-worded body ('Due at 60,000 mi').
 *   - it is best-effort: a sender that THROWS does not fail the trigger — the endpoint still 200s and
 *     returns its normal TriggerResult (the notification row is still written).
 *   - no notification created (nothing due) → notifyUser is NOT called.
 *
 * Mileage reminders aren't API-creatable (validation is T4), so those seed the reminder row directly
 * via sqlite then drive the real endpoint — the trigger-mileage.test.ts harness pattern. createTestApp
 * rewrites env + dynamic-imports DB-bound modules, so keep static imports to the harness + the DI seam.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import {
  type PushPayload,
  type PushResult,
  type PushSender,
  setPushSenderForTest,
} from '../../push/push-service';
import { pushSubscriptionRepository } from '../../push/repository';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});

afterEach(() => {
  setPushSenderForTest(null); // restore the real sender
  ctx.close();
});

/** A fake sender that records the payloads it was asked to send; optionally throws. */
function recordingSender(opts: { throwOnSend?: boolean } = {}): PushSender & {
  payloads: PushPayload[];
} {
  const payloads: PushPayload[] = [];
  return {
    payloads,
    async send(_sub, payload): Promise<PushResult> {
      payloads.push(payload);
      if (opts.throwOnSend) throw new Error('boom (transport blew up)');
      return { kind: 'ok' };
    },
  };
}

/** Give the seeded user one push subscription so the fan-out has a target. */
async function subscribe(endpoint = 'ep-hook'): Promise<void> {
  await pushSubscriptionRepository.upsertByEndpoint(ctx.user.id, {
    endpoint,
    p256dh: 'k',
    auth: 'a',
  });
}

async function trigger(): Promise<DataEnvelope<{ notifications: unknown[] }>> {
  const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
  expect(res.status).toBe(200);
  return json<DataEnvelope<{ notifications: unknown[] }>>(res);
}

/** Seed a past-due TIME reminder (monthly, start in the past) so the trigger materializes a notification. */
function seedTimeReminder(reminderId: string, vehicleId: string, name: string): void {
  const past = Math.floor(new Date('2024-01-01T00:00:00.000Z').getTime() / 1000);
  ctx.sqlite.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, trigger_mode,
        start_date, next_due_date, is_active)
     VALUES (?, ?, ?, 'notification', 'automatic', 'monthly', 'time', ?, ?, 1)`,
    [reminderId, ctx.user.id, name, past, past]
  );
  ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
    reminderId,
    vehicleId,
  ]);
}

/** Seed a mileage reminder at a milestone (null date) — mirrors trigger-mileage.test.ts. */
function seedMileageReminder(
  reminderId: string,
  vehicleId: string,
  nextDueOdometer: number,
  name: string
): void {
  ctx.sqlite.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, trigger_mode,
        interval_mileage, last_service_odometer, next_due_odometer,
        start_date, next_due_date, is_active)
     VALUES (?, ?, ?, 'notification', 'automatic', 'custom', 'mileage',
        5000, ?, ?, 0, NULL, 1)`,
    [reminderId, ctx.user.id, name, nextDueOdometer - 5000, nextDueOdometer]
  );
  ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
    reminderId,
    vehicleId,
  ]);
}

async function addOdometerReading(vehicleId: string, odometer: number): Promise<void> {
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
    odometer,
    recordedAt: '2024-06-01T00:00:00.000Z',
  });
  expect(res.status, `odometer create ${odometer}`).toBe(201);
}

describe('push T4b — the request-driven trigger hook fires notifyUser per notification', () => {
  test('a TIME-axis notification fires notifyUser once with the reminder-derived payload', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await subscribe();
    seedTimeReminder('rp-time', vehicleId, 'Registration renewal');
    const sender = recordingSender();
    setPushSenderForTest(sender);

    await trigger();

    // At least one push fired (a monthly reminder overdue since Jan may materialize a few catch-up
    // periods; each is a real due notification). Every payload carries the reminder-derived shape.
    expect(sender.payloads.length).toBeGreaterThanOrEqual(1);
    const p = sender.payloads[0];
    expect(p?.title).toBe('Registration renewal due');
    expect(p?.body).toBe('This reminder is now due'); // time axis → no mileage wording
    expect(p?.tag).toBe('rp-time');
    expect(p?.url).toBe('/reminders');
  });

  test('a MILEAGE-axis notification fires notifyUser with a mileage-worded body', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(vehicleId, 60200); // past the 60000 milestone
    await subscribe();
    seedMileageReminder('rp-mi', vehicleId, 60000, 'Oil change');
    const sender = recordingSender();
    setPushSenderForTest(sender);

    await trigger();

    expect(sender.payloads).toHaveLength(1);
    const p = sender.payloads[0];
    expect(p?.title).toBe('Oil change due');
    expect(p?.body).toBe('Due at 60,000 mi'); // mileage axis → dueOdometer wording, thousands-grouped
    expect(p?.tag).toBe('rp-mi');
    expect(p?.url).toBe('/reminders');
  });

  test('best-effort: a THROWING sender does not fail the trigger (endpoint still 200s + writes the notification)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(vehicleId, 60200);
    await subscribe();
    seedMileageReminder('rp-boom', vehicleId, 60000, 'Oil change');
    setPushSenderForTest(recordingSender({ throwOnSend: true }));

    // The push transport blows up — the trigger must still succeed (R3) and the in-app notification
    // (the source of truth) must still be written. A regression that awaited notifyUser WITHOUT the
    // best-effort wrap, or threw the payload builder, would surface as a non-200 / a missing row here.
    const body = await trigger();
    expect(body.data.notifications.length).toBeGreaterThanOrEqual(1);

    const rows = ctx.sqlite
      .query('SELECT id FROM reminder_notifications WHERE reminder_id = ?')
      .all('rp-boom') as Array<{ id: string }>;
    expect(rows.length).toBe(1);
  });

  test('nothing due → notifyUser is not called (no spurious push)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(vehicleId, 34000); // below the milestone
    await subscribe();
    seedMileageReminder('rp-none', vehicleId, 60000, 'Oil change');
    const sender = recordingSender();
    setPushSenderForTest(sender);

    await trigger();

    expect(sender.payloads).toHaveLength(0);
  });
});
