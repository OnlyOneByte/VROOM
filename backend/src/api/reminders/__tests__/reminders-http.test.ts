/**
 * In-process HTTP tests for the reminders routes, through the real middleware, validation, and DB stack.
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

/** Creates a notification reminder on the given vehicle. */
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

  test('GET / filters by type, isActive, and vehicleId', async () => {
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

  test('PUT { isActive: false } pauses and resumes a reminder', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await createNotificationReminder(vehicleId);
    const { data } = await json<DataEnvelope<ReminderWithJoins>>(created);
    const id = data.reminder.id;

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
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await createNotificationReminder(vehicleId);
    const id = (await json<DataEnvelope<ReminderWithJoins>>(created)).data.reminder.id;

    const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      vehicleIds: ['someone-elses-vehicle'],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // The split blob carries its own vehicleIds, so a foreign id could enter through it while vehicleIds is
  // omitted. Two layers must reject it: the merged re-parse enforces that the split matches the owned
  // vehicleIds, and an explicit vehicleIds goes through the ownership check.
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

    // Foreign vehicle only in the split blob, vehicleIds omitted.
    const viaBlob = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      expenseSplitConfig: { method: 'even', vehicleIds: ['foreign-veh'] },
    });
    expect(viaBlob.status).toBeGreaterThanOrEqual(400);
    expect(viaBlob.status).toBeLessThan(500);

    // Foreign vehicle in both vehicleIds and the matching blob.
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

  test('POST /trigger processes an overdue notification reminder', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await createNotificationReminder(vehicleId);

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    // Assert it acted rather than an exact count, since the catch-up cap can turn periods into skips.
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
