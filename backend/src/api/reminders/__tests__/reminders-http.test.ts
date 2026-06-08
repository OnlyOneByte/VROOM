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
import { createTestApp, type DataEnvelope, json, type TestApp } from '../../../test-helpers/http-client';

/** Shapes the assertions read off the reminder JSON envelopes. */
interface ReminderRow {
  id: string;
  isActive: boolean;
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
async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  // Read the body exactly once (a Response body is a single-use stream).
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

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
    const vehicleId = await seedVehicle();
    const created = await createNotificationReminder(vehicleId);
    expect(created.status).toBe(201);

    const list = await ctx.authed('GET', '/api/v1/reminders');
    expect(list.status).toBe(200);
    const body = await json<DataEnvelope<ReminderWithJoins[]>>(list);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].reminder.isActive).toBe(true);
  });

  test('PUT { isActive:false } pauses — the merge+revalidate path that 400d', async () => {
    const vehicleId = await seedVehicle();
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
    expect((await json<DataEnvelope<ReminderWithJoins>>(resumed)).data.reminder.isActive).toBe(true);
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

  test('anonymous access is unauthorized', async () => {
    const res = await ctx.anon('GET', '/api/v1/reminders');
    expect(res.status).toBe(401);
  });

  test('POST /trigger processes an overdue notification reminder (200 + creates a notification)', async () => {
    // The seeded reminder is monthly from 2024-01-01 — overdue vs. now, so the
    // trigger service fires it and emits a notification. Exercises the full POST
    // /trigger route (rate limiter → handler → trigger service → DB) — the one
    // reminders endpoint the HTTP layer didn't cover (TODO.md AI-testing gap #278).
    const vehicleId = await seedVehicle();
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
