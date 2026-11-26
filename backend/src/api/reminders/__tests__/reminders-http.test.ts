import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

interface ReminderRow {
  id: string;
  isActive: boolean;
  type: string;
  expenseAmount?: number | null;
  expenseSplitConfig?: unknown;
}
interface ReminderWithJoins {
  reminder: ReminderRow;
}
interface TriggerResultShape {
  createdExpenses: unknown[];
  notifications: unknown[];
  skipped: Array<{ reminderId: string; reason: string }>;
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

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

    const byType = await json<DataEnvelope<ReminderWithJoins[]>>(
      await ctx.authed('GET', '/api/v1/reminders?type=notification')
    );
    expect(byType.data).toHaveLength(1);
    expect(byType.data[0].reminder.type).toBe('notification');

    const byActive = await json<DataEnvelope<ReminderWithJoins[]>>(
      await ctx.authed('GET', '/api/v1/reminders?isActive=false')
    );
    expect(byActive.data).toHaveLength(1);
    expect(byActive.data[0].reminder.isActive).toBe(false);

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

  test('PUT cannot attach a foreign vehicle via expenseSplitConfig alone (omitting vehicleIds)', async () => {
    const owned = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
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

    const viaBlob = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      expenseSplitConfig: { method: 'even', vehicleIds: ['foreign-veh'] },
    });
    expect(viaBlob.status).toBeGreaterThanOrEqual(400);
    expect(viaBlob.status).toBeLessThan(500);

    const viaBoth = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      vehicleIds: ['foreign-veh'],
      expenseSplitConfig: { method: 'even', vehicleIds: ['foreign-veh'] },
    });
    expect(viaBoth.status).toBeGreaterThanOrEqual(400);
    expect(viaBoth.status).toBeLessThan(500);

    const junction = ctx.sqlite
      .query('SELECT vehicle_id FROM reminder_vehicles WHERE reminder_id = ?')
      .all(id) as { vehicle_id: string }[];
    expect(junction.map((r) => r.vehicle_id)).toEqual([owned]);
  });

  test('absolute split allocations round-trip in dollars through create, read, edit and save', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const v2 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2023 });
    const split = {
      method: 'absolute',
      allocations: [
        { vehicleId: v1, amount: 60.25 },
        { vehicleId: v2, amount: 39.75 },
      ],
    };
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Shared insurance',
      type: 'expense',
      expenseCategory: 'financial',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      vehicleIds: [v1, v2],
      expenseAmount: 100,
      expenseSplitConfig: split,
    });
    expect(created.status).toBe(201);
    const createdBody = await json<DataEnvelope<ReminderWithJoins>>(created);
    const id = createdBody.data.reminder.id;
    expect(createdBody.data.reminder.expenseSplitConfig).toEqual(split);

    const listed = await json<DataEnvelope<ReminderWithJoins[]>>(
      await ctx.authed('GET', '/api/v1/reminders')
    );
    const read = listed.data.find((r) => r.reminder.id === id);
    expect(read?.reminder.expenseAmount).toBe(100);
    expect(read?.reminder.expenseSplitConfig).toEqual(split);

    const saved = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      name: 'Shared insurance (edited)',
      expenseAmount: read?.reminder.expenseAmount,
      expenseSplitConfig: read?.reminder.expenseSplitConfig,
      vehicleIds: [v1, v2],
    });
    expect(saved.status).toBe(200);
    const savedBody = await json<DataEnvelope<ReminderWithJoins>>(saved);
    expect(savedBody.data.reminder.expenseAmount).toBe(100);
    expect(savedBody.data.reminder.expenseSplitConfig).toEqual(split);

    const list = await json<DataEnvelope<ReminderWithJoins[]>>(
      await ctx.authed('GET', '/api/v1/reminders')
    );
    expect(list.data[0].reminder.expenseSplitConfig).toEqual(split);

    const stored = ctx.sqlite
      .query('SELECT expense_amount, expense_split_config FROM reminders WHERE id = ?')
      .get(id) as { expense_amount: number; expense_split_config: string };
    expect(stored.expense_amount).toBe(10000);
    expect(JSON.parse(stored.expense_split_config).allocations).toEqual([
      { vehicleId: v1, amount: 6025 },
      { vehicleId: v2, amount: 3975 },
    ]);
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

  test('POST /trigger accepts the user time zone and falls back to server time on an unknown one', async () => {
    const ok = await ctx.authed('POST', '/api/v1/reminders/trigger?timeZone=Pacific%2FTongatapu');
    expect(ok.status).toBe(200);
    const unknown = await ctx.authed('POST', '/api/v1/reminders/trigger?timeZone=Mars%2FOlympus');
    expect(unknown.status).toBe(200);
  });

  test('POST /:id/mark-serviced falls back to server time on an unknown time zone', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await createNotificationReminder(vehicleId);
    const { data } = await json<DataEnvelope<ReminderWithJoins>>(created);
    const res = await ctx.authed(
      'POST',
      `/api/v1/reminders/${data.reminder.id}/mark-serviced?timeZone=Mars%2FOlympus`
    );
    expect(res.status).toBe(200);
  });

  test('POST /:id/mark-serviced schedules the next due on the user calendar day', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const timeZone = 'Pacific/Tongatapu';
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Month-end wash',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2099-01-31',
      timeZone,
      vehicleIds: [vehicleId],
    });
    const { data } = await json<DataEnvelope<ReminderWithJoins>>(created);
    expect(created.status, JSON.stringify(data)).toBe(201);

    const res = await ctx.authed(
      'POST',
      `/api/v1/reminders/${data.reminder.id}/mark-serviced?timeZone=${encodeURIComponent(timeZone)}`
    );
    const body = await json<DataEnvelope<{ nextDueDate: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.nextDueDate, '28 Feb 2099 at noon in Tonga').toBe('2099-02-27T23:00:00.000Z');
  });

  test('POST /trigger is unauthorized when anonymous', async () => {
    const res = await ctx.anon('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(401);
  });
});
