/**
 * HTTP tests for the reminder notification feed: newest-first ordering, marking a notification read, and
 * ownership. Drives the real trigger and list/mark routes, then reads rows from sqlite.
 * Keep static imports to the harness and bun:test: createTestApp sets env before config loads.
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

interface NotificationRow {
  id: string;
  reminderId: string;
  dueDate: string | null;
  createdAt: string;
  isRead: boolean;
}

/** A monthly reminder with a past startDate is overdue, so a trigger writes several notification rows. */
async function seedFiredNotificationReminder(vehicleId: string): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Rotate tires',
    type: 'notification',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z',
    vehicleIds: [vehicleId],
  });
  expect(res.status).toBe(201);
  const trig = await ctx.authed('POST', '/api/v1/reminders/trigger');
  expect(trig.status).toBe(200);
}

describe('reminder notification feed (GET + mark-read)', () => {
  test('lists fired notifications newest-first', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await seedFiredNotificationReminder(vehicleId);

    const res = await ctx.authed('GET', '/api/v1/reminders/notifications');
    const body = await json<DataEnvelope<NotificationRow[]>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < body.data.length; i++) {
      const prev = new Date(body.data[i - 1].createdAt).getTime();
      const cur = new Date(body.data[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
    // All start unread.
    expect(body.data.every((n) => n.isRead === false)).toBe(true);
  });

  test('marking a notification read flips isRead and unreadOnly hides it', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await seedFiredNotificationReminder(vehicleId);

    const listed = await json<DataEnvelope<NotificationRow[]>>(
      await ctx.authed('GET', '/api/v1/reminders/notifications')
    );
    const target = listed.data[0];
    const unreadBefore = listed.data.length;

    const marked = await ctx.authed('PUT', `/api/v1/reminders/notifications/${target.id}/read`);
    expect(marked.status, await marked.text()).toBe(200);

    const row = ctx.sqlite
      .query('SELECT is_read FROM reminder_notifications WHERE id = ?')
      .get(target.id) as { is_read: number };
    expect(row.is_read).toBe(1);

    // unreadOnly=true now returns one fewer.
    const unreadAfter = await json<DataEnvelope<NotificationRow[]>>(
      await ctx.authed('GET', '/api/v1/reminders/notifications?unreadOnly=true')
    );
    expect(unreadAfter.data.length).toBe(unreadBefore - 1);
    expect(unreadAfter.data.some((n) => n.id === target.id)).toBe(false);
  });

  test('marking a non-existent notification is rejected (ownership/404)', async () => {
    const res = await ctx.authed('PUT', '/api/v1/reminders/notifications/does-not-exist/read');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // Orders by createdAt, not dueDate: a mileage notification has a NULL dueDate, which would sort last.
  test('a mileage notification with a null dueDate sorts first when created later', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Oil',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const reminderId = (
      ctx.sqlite.query('SELECT id FROM reminders WHERE user_id = ? LIMIT 1').get(ctx.user.id) as {
        id: string;
      }
    ).id;
    ctx.sqlite.run('DELETE FROM reminder_notifications WHERE user_id = ?', [ctx.user.id]);
    ctx.sqlite.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read, created_at)
       VALUES ('ntime', ?, ?, 1700000000, NULL, 0, 1000)`,
      [reminderId, ctx.user.id]
    );
    ctx.sqlite.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read, created_at)
       VALUES ('nmileage', ?, ?, NULL, 35000, 0, 2000)`,
      [reminderId, ctx.user.id]
    );

    const res = await ctx.authed('GET', '/api/v1/reminders/notifications');
    const body = await json<DataEnvelope<Array<{ id: string }>>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data[0]?.id).toBe('nmileage');
    expect(body.data[1]?.id).toBe('ntime');
  });
});
