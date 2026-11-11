/**
 * Per-vehicle reminder reads for shared vehicles. Reminders belong to the owner, so the per-vehicle list
 * (?vehicleId) shows the owner's reminders for that vehicle to viewers and editors. The cross-fleet list
 * stays scoped to the acting user, so shared reminders never mix into it.
 * User A owns the vehicle. User B is invited as viewer or editor.
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

describe('shared reminder reads', () => {
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

  test('the cross-fleet list stays scoped to the acting user', async () => {
    await shareWithReminder('editor');
    const body = await json<DataEnvelope<ReminderJoin[]>>(await asB('GET', '/api/v1/reminders'));
    expect(body.data.length).toBe(0);

    // And the OWNER still sees their reminder on their own cross-fleet list.
    const ownerBody = await json<DataEnvelope<ReminderJoin[]>>(
      await ctx.authed('GET', '/api/v1/reminders')
    );
    expect(ownerBody.data.length).toBe(1);
  });

  test('a stranger with no share gets a 404 on the per-vehicle list', async () => {
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

  test('a pending invite grants no read', async () => {
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

  test('an editor can create a reminder on a shared vehicle, but a viewer cannot', async () => {
    const [vehicleId] = await shareWithReminder('editor');
    const editorRes = await asB('POST', '/api/v1/reminders', {
      name: 'Editor reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-02T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    expect(editorRes.status, 'editor create allowed').toBe(201);

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
