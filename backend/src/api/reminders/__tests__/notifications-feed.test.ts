/**
 * In-process HTTP tests for the reminder NOTIFICATION feed — the rows the trigger
 * writes when a notification-type reminder fires (GET /reminders/notifications +
 * PUT /reminders/notifications/:id/read). The endpoints existed but nothing in the
 * frontend called them (cycle 165 surfaced the feed on /reminders); these pin the
 * contract that UI now depends on: notifications are returned newest-first, and
 * marking one read flips isRead (and is ownership-scoped).
 *
 * Drives the real stack (trigger service writes the rows → list/mark routes read
 * them) and reads straight off sqlite. createTestApp() rewrites env + dynamic-
 * imports DB-bound modules, so keep static imports to the harness + bun:test.
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
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

interface NotificationRow {
  id: string;
  reminderId: string;
  dueDate: string | null;
  createdAt: string;
  isRead: boolean;
}

/** A monthly notification reminder with a past startDate => overdue, so POST
 *  /trigger writes several notification rows (one per elapsed period, capped). */
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
    const vehicleId = await seedVehicle();
    await seedFiredNotificationReminder(vehicleId);

    const res = await ctx.authed('GET', '/api/v1/reminders/notifications');
    const body = await json<DataEnvelope<NotificationRow[]>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(2);

    // Newest-first by createdAt (the recency axis — NOT dueDate, which is NULL for mileage
    // notifications and would sink them; #142/C459). Each createdAt >= the next one.
    for (let i = 1; i < body.data.length; i++) {
      const prev = new Date(body.data[i - 1]!.createdAt).getTime();
      const cur = new Date(body.data[i]!.createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
    // All start unread.
    expect(body.data.every((n) => n.isRead === false)).toBe(true);
  });

  test('marking a notification read flips isRead and unreadOnly hides it', async () => {
    const vehicleId = await seedVehicle();
    await seedFiredNotificationReminder(vehicleId);

    const listed = await json<DataEnvelope<NotificationRow[]>>(
      await ctx.authed('GET', '/api/v1/reminders/notifications')
    );
    const target = listed.data[0]!;
    const unreadBefore = listed.data.length;

    const marked = await ctx.authed('PUT', `/api/v1/reminders/notifications/${target.id}/read`);
    expect(marked.status, await marked.text()).toBe(200);

    // The row is now read in the DB.
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

  // #142 (C459): the feed orders by createdAt (recency), NOT dueDate. A MILEAGE notification carries
  // dueDate=NULL (its milestone is dueOdometer), and NULLs sort LAST under `DESC` — so ordering by dueDate
  // sank every mileage notification beneath every time notification regardless of when it fired (and the
  // limit truncated the mileage axis entirely past 100 time notifications). This pins that a mileage
  // notification created AFTER a time notification appears FIRST in the feed.
  test('a mileage notification (dueDate NULL) created later sorts FIRST, not last (#142)', async () => {
    const vehicleId = await seedVehicle();
    // Seed a reminder to satisfy the FK, then two notifications directly: a time one created earlier,
    // a mileage one (dueDate NULL, dueOdometer set) created LATER.
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
    // Clear any auto-fired rows so we control ordering deterministically.
    ctx.sqlite.run('DELETE FROM reminder_notifications WHERE user_id = ?', [ctx.user.id]);
    // Time notification created at t=1000s; mileage notification created LATER at t=2000s.
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
    // NON-VACUOUS: pre-fix (order by dueDate DESC) the NULL-dueDate mileage row sorted LAST → 'ntime' first.
    // Post-fix (order by createdAt DESC) the later-created mileage row is first.
    expect(body.data[0]?.id).toBe('nmileage');
    expect(body.data[1]?.id).toBe('ntime');
  });
});
