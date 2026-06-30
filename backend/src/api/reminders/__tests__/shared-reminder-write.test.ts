/**
 * vehicle-sharing T7b — reminder WRITE widening through the REAL stack (the last gated sharing slice).
 *
 * The reminder analogue of the T5b-2b split write, resolved by the same clean-cut §2.1 corollary: a
 * reminder links a MULTI-vehicle junction and is userId-OWNED, so POST/PUT/DELETE/mark-serviced
 * authorize via `requireReminderVehiclesWrite` (owner | accepted editor on EVERY vehicle), and because a
 * reminder carries ONE userId the vehicle set must resolve to a SINGLE owner (cross-owner rejected). The
 * reminder is stamped `userId = OWNER`, so every downstream effect (its materialized expense rows, the
 * getCurrentOdometer scope, backup/TCO) rides the OWNER's books — the reminder has NO createdBy column,
 * so the owner-stamp is userId-only (the T7 note's observation).
 *
 * Fixture mirrors shared-reminder-read.test.ts: A is the OWNER (harness session); B a second user
 * invited as editor/viewer. The IDOR denials also live in cross-tenant-idor.test.ts (T7b entry).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp; // owner (user A)
let bCookie: string; // invitee B (the shared editor/viewer)
let bId: string;
let bEmail: string;
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  const { lucia } = await import('../../auth/lucia');
  bId = `remw-invitee-${++bCounter}`;
  bEmail = `remw-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Rem Editor B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

async function asB(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: bCookie, 'Sec-Fetch-Site': 'same-origin' };
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init = { ...init, body: JSON.stringify(body) };
  }
  return ctx.app.request(path, init);
}

/** A owns a vehicle and invites B at `level`, B accepts → an ACCEPTED share. Returns vehicleId. */
async function shareAccepted(level: 'viewer' | 'editor'): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteBody = await json<DataEnvelope<{ id: string }>>(invite);
  expect(invite.status, JSON.stringify(inviteBody)).toBe(201);
  const acc = await asB('POST', `/api/v1/shares/${inviteBody.data.id}/accept`);
  expect(acc.status, 'B accepts the invite').toBe(200);
  return vehicleId;
}

/** The raw stored reminder row's userId, read directly so we assert the owner-stamp (not the API echo). */
function storedReminderUserId(reminderId: string): string {
  return (
    ctx.sqlite.query('SELECT user_id FROM reminders WHERE id = ?').get(reminderId) as {
      user_id: string;
    }
  ).user_id;
}

interface ReminderEnvelope {
  reminder: { id: string };
  vehicleIds: string[];
}

describe('reminder WRITE widening — owner-stamp (T7b)', () => {
  test('an EDITOR create stamps the reminder userId=OWNER (rides the owner books)', async () => {
    const vehicleId = await shareAccepted('editor');

    const res = await asB('POST', '/api/v1/reminders', {
      name: 'Editor oil change',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<ReminderEnvelope>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const rid = body.data.reminder.id;

    expect(storedReminderUserId(rid)).toBe(ctx.user.id); // owner A — not the acting editor B

    // It rides the OWNER's surface: A's per-vehicle reminder list shows it.
    const ownerList = await json<DataEnvelope<ReminderEnvelope[]>>(
      await ctx.authed('GET', `/api/v1/reminders?vehicleId=${vehicleId}`)
    );
    expect(ownerList.data.find((r) => r.reminder.id === rid)).toBeDefined();
  });

  test('an EDITOR expense-reminder materializes its expense onto the OWNER books (userId=owner)', async () => {
    const vehicleId = await shareAccepted('editor');
    // An automatic expense reminder due in the past → /trigger materializes an expense row.
    const res = await asB('POST', '/api/v1/reminders', {
      name: 'Editor annual reg',
      type: 'expense',
      actionMode: 'automatic',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      expenseCategory: 'regulatory',
      expenseAmount: 100,
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<ReminderEnvelope>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const rid = body.data.reminder.id;
    expect(storedReminderUserId(rid)).toBe(ctx.user.id);

    // The OWNER triggers; the materialized expense must be stamped to the OWNER (reminder.userId), so it
    // rides A's books — never B's. (The trigger materializes under reminder.userId, which T7b set to A.)
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const materialized = ctx.sqlite
      .query("SELECT user_id FROM expenses WHERE source_type = 'reminder' AND source_id = ?")
      .all(rid) as Array<{ user_id: string }>;
    for (const row of materialized) {
      expect(row.user_id).toBe(ctx.user.id); // owner books, not the editor's
    }
  });

  test('an OWNER create on their own vehicle is unchanged: userId=self', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Self reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-02T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<ReminderEnvelope>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(storedReminderUserId(body.data.reminder.id)).toBe(ctx.user.id);
  });

  test('a cross-owner reminder (B own vehicle + A shared vehicle) is REJECTED — single-owner invariant', async () => {
    const sharedFromA = await shareAccepted('editor'); // owned by A, B is editor
    const bVehRes = await asB('POST', '/api/v1/vehicles', {
      make: 'BOwn',
      model: 'Car',
      year: 2023,
    });
    const bOwn = (await json<DataEnvelope<{ id: string }>>(bVehRes)).data.id;
    expect(bVehRes.status, 'B seeds own vehicle').toBeLessThan(300);

    const res = await asB('POST', '/api/v1/reminders', {
      name: 'Cross-owner reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-03T00:00:00.000Z',
      vehicleIds: [sharedFromA, bOwn],
    });
    // Two owners (A and B) → cannot stamp one userId → 400 ValidationError.
    expect(res.status, 'cross-owner reminder rejected').toBe(400);
  });

  test('an EDITOR can PUT, mark-serviced, and DELETE a shared reminder (owner-stamp preserved)', async () => {
    const vehicleId = await shareAccepted('editor');
    // Owner A creates a mileage reminder; editor B edits, re-arms, and deletes it.
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Tire rotation',
      type: 'notification',
      frequency: 'monthly',
      triggerMode: 'mileage',
      intervalMileage: 5000,
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const rid = (await json<DataEnvelope<ReminderEnvelope>>(created)).data.reminder.id;

    const put = await asB('PUT', `/api/v1/reminders/${rid}`, { name: 'Tire rotation (edited)' });
    expect(put.status, 'editor can update a shared reminder').toBe(200);
    expect(storedReminderUserId(rid)).toBe(ctx.user.id); // owner-stamp invariant after the edit

    const mark = await asB('POST', `/api/v1/reminders/${rid}/mark-serviced`);
    expect(mark.status, 'editor can mark-serviced a shared reminder').toBe(200);
    expect(storedReminderUserId(rid)).toBe(ctx.user.id);

    const del = await asB('DELETE', `/api/v1/reminders/${rid}`);
    expect(del.status, 'editor can delete a shared reminder').toBe(200);
    expect(ctx.sqlite.query('SELECT id FROM reminders WHERE id = ?').get(rid)).toBeNull();
  });

  test('a VIEWER cannot create/update/delete/mark-serviced a shared reminder (404, never 403)', async () => {
    const vehicleId = await shareAccepted('viewer');
    // Owner seeds a reminder for the mutate attempts.
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Owner reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const rid = (await json<DataEnvelope<ReminderEnvelope>>(created)).data.reminder.id;

    const create = await asB('POST', '/api/v1/reminders', {
      name: 'Viewer reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-02T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    expect(create.status, 'viewer create denied').toBe(404);
    expect((await asB('PUT', `/api/v1/reminders/${rid}`, { name: 'x' })).status, 'viewer PUT').toBe(
      404
    );
    expect(
      (await asB('POST', `/api/v1/reminders/${rid}/mark-serviced`)).status,
      'viewer mark-serviced'
    ).toBe(404);
    expect((await asB('DELETE', `/api/v1/reminders/${rid}`)).status, 'viewer DELETE').toBe(404);

    // The owner's reminder survived every denied viewer write.
    expect(ctx.sqlite.query('SELECT id FROM reminders WHERE id = ?').get(rid)).not.toBeNull();
  });
});
