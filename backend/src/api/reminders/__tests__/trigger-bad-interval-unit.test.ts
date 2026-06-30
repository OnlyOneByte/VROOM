/**
 * Bug #13 (C21 audit, severity-raised C28, fixed C29): an invalid custom `intervalUnit` must not
 * hang the trigger.
 *
 * advanceCustom switches on intervalUnit (day|week|month|year). Before the fix it had no default, so
 * an unknown unit left the date UNCHANGED — and because fastForwardPastNow loops `while (nextDue <=
 * now)` with no iteration cap, a custom reminder lapsed past the catch-up limit (12) with a corrupt
 * unit would spin forever, hanging the POST /trigger endpoint. Zod blocks bad units on the create +
 * update API paths, so this is only reachable via DB corruption / a validation bypass — hence the row
 * is seeded directly via sqlite here.
 *
 * The fix (advanceCustom throws on an unknown unit + a non-progress backstop in fastForwardPastNow)
 * turns the hang into a per-reminder SKIP: the trigger returns, the bad reminder is reported in
 * `skipped` with an error reason, and well-formed reminders in the same batch still process.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface TriggerResultShape {
  createdExpenses: unknown[];
  notifications: Array<{ id: string }>;
  skipped: Array<{ reminderId: string; reason: string; message?: string }>;
}

/**
 * Seed a custom-frequency reminder with a CORRUPT intervalUnit, lapsed far in the past so it blows
 * through the maxCatchUp cap (12) and reaches fastForwardPastNow. next_due_date is in 2020 → fully
 * overdue, so findOverdue returns it and the time pass processes it. Links a vehicle (processReminder
 * skips a vehicle-less reminder with reason 'no_vehicles' BEFORE the date math, which wouldn't
 * exercise the advance path that hangs).
 */
function seedCorruptCustomReminder(id: string, vehicleId: string): void {
  ctx.sqlite.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, interval_value, interval_unit,
        trigger_mode, start_date, next_due_date, is_active)
     VALUES (?, ?, 'Corrupt', 'notification', 'automatic', 'custom', 1, 'fortnight',
        'time', 1577836800, 1577836800, 1)`, // 2020-01-01
    [id, ctx.user.id]
  );
  ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
    id,
    vehicleId,
  ]);
}

describe('bug #13 — invalid custom intervalUnit is skipped, never hangs', () => {
  test('a corrupt-intervalUnit reminder is reported in skipped, not an infinite loop', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2018 });
    seedCorruptCustomReminder('bad1', vehicleId);

    // If the bug were present this POST would never return (spin in fastForwardPastNow). The fix
    // turns it into a clean skip, so the request completes with a 200 + a skipped entry.
    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const skip = body.data.skipped.find((s) => s.reminderId === 'bad1');
    expect(skip, 'the corrupt reminder is reported as skipped').toBeTruthy();
    expect(skip?.reason).toBe('error');
    expect(skip?.message ?? '').toContain('intervalUnit');
  });

  test('a corrupt reminder does not block a well-formed one in the same batch', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2018 });
    seedCorruptCustomReminder('bad2', vehicleId);

    // A normal monthly notification reminder, also overdue (startDate in the past).
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Healthy monthly',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const cBody = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(cBody)).toBe(201);
    const goodId = cBody.data.reminder.id;

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status).toBe(200);

    // Bad one skipped...
    expect(body.data.skipped.some((s) => s.reminderId === 'bad2')).toBe(true);
    // ...good one still produced at least one notification (processing wasn't aborted by the bad one).
    const goodNotifs = ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = ?')
      .get(goodId) as { n: number };
    expect(goodNotifs.n).toBeGreaterThanOrEqual(1);
  });
});
