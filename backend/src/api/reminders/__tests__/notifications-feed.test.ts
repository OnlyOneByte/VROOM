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
  dueDate: string;
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

    // Newest-first: each dueDate >= the next one.
    for (let i = 1; i < body.data.length; i++) {
      const prev = new Date(body.data[i - 1]!.dueDate).getTime();
      const cur = new Date(body.data[i]!.dueDate).getTime();
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
});
