/**
 * In-process HTTP tests for the reminders routes — through the REAL stack
 * (middleware → auth → zValidator → handler → repository → DB).
 *
 * This is the layer that repo tests bypass. The headline case is the pause/
 * resume toggle: PUT /reminders/:id merges the EXISTING row then re-validates
 * the merged object with createReminderSchema. That round-trip 400'd in
 * production (isActive stripped + nullable columns rejected by .optional()).
 * Only a real request exercises it — which is the whole point of this harness.
 *
 * NOTE: createTestApp() rewrites process.env + dynamic-imports DB-bound modules,
 * so it must run before any static import of config/connection. This file keeps
 * its imports to the harness + bun:test only.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

/** Shapes the assertions read off the reminder JSON envelopes. */
interface ReminderRow {
  id: string;
  isActive: boolean;
  type: string;
}
interface ReminderWithJoins {
  reminder: ReminderRow;
}
/** Shape of POST /trigger's result envelope (TriggerResult). */
interface TriggerResultShape {
  createdExpenses: unknown[];
  notifications: unknown[];
  skipped: Array<{ reminderId: string; reason: string }>;
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Seed a vehicle the test user owns (reminders require >=1 vehicleId). */
async function createNotificationReminder(vehicleId: string) {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Registration renewal',
    type: 'notification',
    frequency: 'monthly',
    startDate: '2024-01-01T00:00:00.000Z',
    vehicleIds: [vehicleId],
  });
  return res;
}

describe('reminders HTTP routes', () => {
  test('POST creates a reminder (201), GET lists it', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await createNotificationReminder(vehicleId);
    expect(created.status).toBe(201);

    const list = await ctx.authed('GET', '/api/v1/reminders');
    expect(list.status).toBe(200);
    const body = await json<DataEnvelope<ReminderWithJoins[]>>(list);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].reminder.isActive).toBe(true);
  });

  // C251 coverage: the reminders LIST route exposes ?type / ?isActive / ?vehicleId (routes.ts:203-205) →
  // findByUserId's filter branches (repository.ts:117 type, 120 isActive, 125 vehicleId-JOIN), but every
  // existing test fetched the UNFILTERED list, so those branches sat untested (the repo at 80.77% line).
  // These drive each filter through the REAL route + assert it discriminates: type=notification excludes an
  // expense reminder; isActive=false returns only the paused one; vehicleId returns only that vehicle's
  // (the junction-JOIN path). NOT theater — exercises the real findByUserId filtering, not a reimplementation.
  test('GET / filters by type / isActive / vehicleId (the findByUserId filter branches)', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const v2 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2023 });

    // A notification reminder on v1 (active), an expense reminder on v2, then pause the notification.
    const notif = await createNotificationReminder(v1);
    const notifId = (await json<DataEnvelope<ReminderWithJoins>>(notif)).data.reminder.id;
    await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Insurance premium',
      type: 'expense',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      vehicleIds: [v2],
      expenseCategory: 'financial',
      expenseAmount: 100,
    });
    await ctx.authed('PUT', `/api/v1/reminders/${notifId}`, { isActive: false });

    // type=notification → only the (now-paused) notification, NOT the expense reminder.
    const byType = await json<DataEnvelope<ReminderWithJoins[]>>(
      await ctx.authed('GET', '/api/v1/reminders?type=notification')
    );
    expect(byType.data).toHaveLength(1);
    expect(byType.data[0].reminder.type).toBe('notification');

    // isActive=false → only the paused notification (the expense reminder is active).
    const byActive = await json<DataEnvelope<ReminderWithJoins[]>>(
      await ctx.authed('GET', '/api/v1/reminders?isActive=false')
    );
    expect(byActive.data).toHaveLength(1);
    expect(byActive.data[0].reminder.isActive).toBe(false);

    // vehicleId=v2 → only the expense reminder (the junction-JOIN filter path).
    const byVehicle = await json<DataEnvelope<ReminderWithJoins[]>>(
      await ctx.authed('GET', `/api/v1/reminders?vehicleId=${v2}`)
    );
    expect(byVehicle.data).toHaveLength(1);
    expect(byVehicle.data[0].reminder.type).toBe('expense');
  });

  test('PUT { isActive:false } pauses — the merge+revalidate path that 400d', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await createNotificationReminder(vehicleId);
    const { data } = await json<DataEnvelope<ReminderWithJoins>>(created);
    const id = data.reminder.id;

    // This is the exact request the pause toggle sends. Before the fix it 400'd
    // because the route re-validates the merged existing row (NULL optional cols)
    // and isActive was stripped from the update schema.
    const paused = await ctx.authed('PUT', `/api/v1/reminders/${id}`, { isActive: false });
    const pausedBody = await json<DataEnvelope<ReminderWithJoins>>(paused);
    expect(paused.status, JSON.stringify(pausedBody)).toBe(200);
    expect(pausedBody.data.reminder.isActive).toBe(false);

    // Resume round-trips too.
    const resumed = await ctx.authed('PUT', `/api/v1/reminders/${id}`, { isActive: true });
    expect(resumed.status).toBe(200);
    expect((await json<DataEnvelope<ReminderWithJoins>>(resumed)).data.reminder.isActive).toBe(
      true
    );
  });

  test('POST with a vehicle the user does not own is rejected', async () => {
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Bad',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      vehicleIds: ['someone-elses-vehicle'],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('PUT updating vehicleIds to a vehicle the user does not own is rejected', async () => {
    // Pins the UPDATE-path ownership gate — the second site converged onto the shared
    // validateVehicleIdsOwned helper (C141). A valid reminder, then a PUT that swaps in a
    // foreign vehicleId must be rejected by the same validator, not silently accepted.
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await createNotificationReminder(vehicleId);
    const id = (await json<DataEnvelope<ReminderWithJoins>>(created)).data.reminder.id;

    const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      vehicleIds: ['someone-elses-vehicle'],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // C178 (guard): a PUT must not be able to smuggle a foreign vehicleId in ONLY through the
  // `expenseSplitConfig` JSON blob while OMITTING top-level `vehicleIds`. The blob carries its own
  // vehicleIds (the #88 footgun family: an FK in a JSON column that bypasses the junction ownership
  // check). It's defended in DEPTH by TWO layers that this pins compose end-to-end at the HTTP boundary:
  //   (a) the merge+re-parse runs `createReminderSchema` on {existing.vehicleIds, ...partial}, so the
  //       split-config-vs-vehicleIds MATCH invariant rejects a config that names anything but the
  //       (owned) existing vehicleIds when vehicleIds is omitted; and
  //   (b) when vehicleIds IS sent, validateVehicleIdsOwned rejects the foreign id outright.
  // Existing tests cover (b) standalone + the match invariant at the schema-UNIT level; neither drives
  // this HTTP composition (a foreign id reachable ONLY via the split blob). A regression that moved the
  // split match-check behind an `if (vehicleIds)` that the merge doesn't satisfy would reopen #88-class.
  test('PUT cannot attach a foreign vehicle via expenseSplitConfig alone (omitting vehicleIds)', async () => {
    const owned = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    // A second user's vehicle, seeded directly (cross-tenant).
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u2', 'u2@example.com', 'U2')"
    );
    ctx.sqlite.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('foreign-veh', 'u2', 'Foreign', 'Car', 2020)"
    );
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Recurring wash',
      type: 'expense',
      actionMode: 'automatic',
      expenseCategory: 'maintenance',
      frequency: 'monthly',
      triggerMode: 'time',
      startDate: '2024-01-01T00:00:00.000Z',
      vehicleIds: [owned],
      expenseAmount: 100,
    });
    const id = (await json<DataEnvelope<ReminderWithJoins>>(created)).data.reminder.id;

    // (a) Foreign vehicle ONLY in the split blob, vehicleIds omitted → the merged-parse match invariant
    //     (split IDs must equal the existing OWNED vehicleIds) rejects it.
    const viaBlob = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      expenseSplitConfig: { method: 'even', vehicleIds: ['foreign-veh'] },
    });
    expect(viaBlob.status).toBeGreaterThanOrEqual(400);
    expect(viaBlob.status).toBeLessThan(500);

    // (b) Foreign vehicle in BOTH vehicleIds and the matching blob → the ownership gate rejects it.
    const viaBoth = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      vehicleIds: ['foreign-veh'],
      expenseSplitConfig: { method: 'even', vehicleIds: ['foreign-veh'] },
    });
    expect(viaBoth.status).toBeGreaterThanOrEqual(400);
    expect(viaBoth.status).toBeLessThan(500);

    // NOTHING leaked: the junction still holds only the owned vehicle, no foreign id persisted.
    const junction = ctx.sqlite
      .query('SELECT vehicle_id FROM reminder_vehicles WHERE reminder_id = ?')
      .all(id) as { vehicle_id: string }[];
    expect(junction.map((r) => r.vehicle_id)).toEqual([owned]);
  });

  test('anonymous access is unauthorized', async () => {
    const res = await ctx.anon('GET', '/api/v1/reminders');
    expect(res.status).toBe(401);
  });

  test('POST /trigger processes an overdue notification reminder (200 + creates a notification)', async () => {
    // The seeded reminder is monthly from 2024-01-01 — overdue vs. now, so the
    // trigger service fires it and emits a notification. Exercises the full POST
    // /trigger route (rate limiter → handler → trigger service → DB) — the one
    // reminders endpoint the HTTP layer didn't cover (TODO.md AI-testing gap #278).
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await createNotificationReminder(vehicleId);

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    // The reminder is overdue (monthly since 2024 → many periods), so the service
    // must ACT on it — either emit notifications or, if the catch-up cap is hit,
    // record a skip. Asserting the precise count would over-specify the catch-up
    // policy; asserting "it did something" is the stable contract.
    const acted = body.data.notifications.length + body.data.skipped.length;
    expect(acted, JSON.stringify(body.data)).toBeGreaterThanOrEqual(1);
  });

  test('POST /trigger is a no-op with no overdue reminders (200, nothing created)', async () => {
    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.notifications).toHaveLength(0);
    expect(body.data.createdExpenses).toHaveLength(0);
    expect(body.data.skipped).toHaveLength(0);
  });

  test('POST /trigger is unauthorized when anonymous', async () => {
    const res = await ctx.anon('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(401);
  });
});
