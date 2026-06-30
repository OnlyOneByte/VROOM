/**
 * vehicle-sharing T7 (READ slice) — per-vehicle reminder list widening through the REAL stack.
 *
 * A reminder is a userId-OWNED row with a multi-vehicle JUNCTION (reminder_vehicles), so reminders for
 * a shared vehicle belong to the OWNER's books. The per-vehicle list (GET /reminders?vehicleId) gates
 * via requireVehicleRead and lists the OWNER's reminders linked to that vehicle (the junction filter
 * pins it to exactly that vehicle). The CROSS-FLEET list (no vehicleId) STAYS acting-user-owned: a
 * shared vehicle's reminders live on the owner's surface, so the invitee sees them only via ?vehicleId.
 *
 * The WRITE paths (POST/PUT/DELETE) are NOT widened here — a reminder can span MULTIPLE vehicles, so the
 * owner-stamp question (which owner; can an editor span a shared + owned vehicle?) is a distinct slice
 * (T7b). Those keep the strict validateVehicleIdsOwned, verified still-denied below.
 *
 * Fixture: A is the OWNER (the harness-seeded session); B is a SECOND user invited as viewer/editor.
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
let bCookie: string; // invitee B (the shared viewer/editor)
let bEmail: string;
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  const { lucia } = await import('../../auth/lucia');
  const bId = `rem-invitee-${++bCounter}`;
  bEmail = `rem-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Rem B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

interface ReminderJoin {
  reminder: { id: string; name: string };
  vehicleIds: string[];
}

async function asB(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: bCookie, 'Sec-Fetch-Site': 'same-origin' };
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init = { ...init, body: JSON.stringify(body) };
  }
  return ctx.app.request(path, init);
}

/** A owns a vehicle + a notification reminder on it, invites B at `level`, B accepts. Returns [vehicleId, reminderId]. */
async function shareWithReminder(level: 'viewer' | 'editor'): Promise<[string, string]> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const created = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Oil change',
    type: 'notification',
    frequency: 'monthly',
    startDate: '2024-06-01T00:00:00.000Z',
    vehicleIds: [vehicleId],
  });
  const reminderId = (await json<DataEnvelope<{ reminder: { id: string } }>>(created)).data.reminder
    .id;
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
  expect((await asB('POST', `/api/v1/shares/${inviteId}/accept`)).status).toBe(200);
  return [vehicleId, reminderId];
}

describe('reminder READ widening — per-vehicle list (T7)', () => {
  test('an accepted VIEWER lists the shared vehicle reminders (owner-owned rows)', async () => {
    const [vehicleId, reminderId] = await shareWithReminder('viewer');

    const res = await asB('GET', `/api/v1/reminders?vehicleId=${vehicleId}`);
    const body = await json<DataEnvelope<ReminderJoin[]>>(res);
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.reminder.id).toBe(reminderId);
    expect(body.data[0]?.vehicleIds).toContain(vehicleId);
  });

  test('an accepted EDITOR also lists the shared vehicle reminders', async () => {
    const [vehicleId, reminderId] = await shareWithReminder('editor');
    const body = await json<DataEnvelope<ReminderJoin[]>>(
      await asB('GET', `/api/v1/reminders?vehicleId=${vehicleId}`)
    );
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.reminder.id).toBe(reminderId);
  });

  test('the CROSS-FLEET list (no vehicleId) stays acting-user-owned — B sees none of A reminders', async () => {
    await shareWithReminder('editor');
    const body = await json<DataEnvelope<ReminderJoin[]>>(await asB('GET', '/api/v1/reminders'));
    expect(body.data.length).toBe(0);

    // And the OWNER still sees their reminder on their own cross-fleet list.
    const ownerBody = await json<DataEnvelope<ReminderJoin[]>>(
      await ctx.authed('GET', '/api/v1/reminders')
    );
    expect(ownerBody.data.length).toBe(1);
  });

  test('a STRANGER (no share) is denied the per-vehicle list with the existence-hiding 404', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Private reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    expect((await asB('GET', `/api/v1/reminders?vehicleId=${vehicleId}`)).status).toBe(404);
  });

  test('a PENDING (un-accepted) invite grants no read — the per-vehicle list still 404s', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Pending', model: 'Car', year: 2021 });
    await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Pending reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level: 'viewer' });
    expect((await asB('GET', `/api/v1/reminders?vehicleId=${vehicleId}`)).status).toBe(404);
  });

  test('WRITE: an accepted EDITOR CAN now create a reminder on the shared vehicle (T7b shipped) — owner-stamped; a VIEWER cannot', async () => {
    const [vehicleId] = await shareWithReminder('editor');
    // T7b widened POST /reminders to requireReminderVehiclesWrite: an accepted editor may create a
    // reminder on the shared vehicle, and it is OWNER-stamped (userId = A, not the acting editor B), so
    // it rides the owner's books + surfaces. (Full owner-stamp + materialization behavior is pinned in
    // shared-reminder-write.test.ts; this just confirms the read-test's old deny has flipped.)
    const editorRes = await asB('POST', '/api/v1/reminders', {
      name: 'Editor reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-02T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    expect(editorRes.status, 'editor create now allowed (T7b)').toBe(201);

    // A VIEWER, by contrast, is still denied every write (the requireVehicleRead vs requireVehicleWrite
    // split) — 404 existence-hiding.
    const [viewerVehicleId] = await shareWithReminder('viewer');
    const viewerRes = await asB('POST', '/api/v1/reminders', {
      name: 'Viewer reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-02T00:00:00.000Z',
      vehicleIds: [viewerVehicleId],
    });
    expect(viewerRes.status, 'viewer create denied').toBe(404);
  });
});
