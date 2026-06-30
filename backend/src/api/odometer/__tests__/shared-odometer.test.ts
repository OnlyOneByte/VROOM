/**
 * vehicle-sharing T6 — odometer READ+WRITE widening through the REAL stack (the odometer analogue of
 * the T5b-2/T5b-3 expense owner-stamp model, design §2.1).
 *
 * Odometer entries are userId-keyed exactly like expenses (reads filter eq(userId); getCurrentOdometer
 * + the mileage-reminder axis scope by userId), so the same owner-stamp model applies: when a shared
 * EDITOR creates a reading on the owner's vehicle, the row is stamped userId = OWNER (so it rides the
 * owner's mileage / getCurrentOdometer / backup), and the per-vehicle reads gate via requireVehicleRead
 * then query the OWNER's books. Odometer rows carry NO createdBy column (they are not money rows — only
 * the expenses provenance migration 0011 added one), so the owner-stamp is via userId alone.
 *
 * Fixture: A is the OWNER (the harness-seeded session); B is a SECOND user invited as viewer/editor.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type PaginatedEnvelope,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp; // owner (user A)
let bCookie: string; // invitee B (the shared viewer/editor)
let bId: string;
let bEmail: string;
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  const { lucia } = await import('../../auth/lucia');
  bId = `odo-invitee-${++bCounter}`;
  bEmail = `odo-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Odo B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

interface OdoRow {
  id: string;
  odometer: number;
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

/** A owns a vehicle, invites B at `level`, B accepts → an ACCEPTED share. Returns vehicleId. */
async function shareAccepted(level: 'viewer' | 'editor'): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
  expect((await asB('POST', `/api/v1/shares/${inviteId}/accept`)).status).toBe(200);
  return vehicleId;
}

/** The raw stored userId on an odometer entry (owner-stamp assertion, not the API echo). */
function storedUserId(entryId: string): string {
  return (
    ctx.sqlite.query('SELECT user_id FROM odometer_entries WHERE id = ?').get(entryId) as {
      user_id: string;
    }
  ).user_id;
}

describe('odometer READ+WRITE widening — owner-stamp (T6)', () => {
  test('an EDITOR create stamps userId=OWNER (rides the owner books + getCurrentOdometer)', async () => {
    const vehicleId = await shareAccepted('editor');

    const res = await asB('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 41000,
      recordedAt: '2024-06-01T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(storedUserId(body.data.id)).toBe(ctx.user.id); // owner A, not the acting editor B

    // It rides the OWNER's books: A's per-vehicle list shows the editor-entered reading.
    const ownerList = await json<PaginatedEnvelope<OdoRow>>(
      await ctx.authed('GET', `/api/v1/odometer/${vehicleId}`)
    );
    expect(ownerList.data.find((e) => e.id === body.data.id)).toBeDefined();
  });

  test('an accepted VIEWER reads the shared vehicle list/history/entry (owner-stamped rows)', async () => {
    const vehicleId = await shareAccepted('viewer');
    // Owner seeds a reading.
    const created = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 22000,
      recordedAt: '2024-06-02T00:00:00.000Z',
    });
    const entryId = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const list = await json<PaginatedEnvelope<OdoRow>>(
      await asB('GET', `/api/v1/odometer/${vehicleId}`)
    );
    expect(list.pagination.totalCount).toBe(1);
    expect(list.data[0]?.id).toBe(entryId);

    const history = await asB('GET', `/api/v1/odometer/${vehicleId}/history`);
    expect(history.status).toBe(200);
    expect((await json<PaginatedEnvelope<unknown>>(history)).pagination.totalCount).toBe(1);

    const single = await asB('GET', `/api/v1/odometer/entry/${entryId}`);
    expect(single.status).toBe(200);
    expect((await json<DataEnvelope<OdoRow>>(single)).data.id).toBe(entryId);
  });

  test('an EDITOR can PUT and DELETE a shared-vehicle reading (D3); userId stays the OWNER', async () => {
    const vehicleId = await shareAccepted('editor');
    const created = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 10000,
      recordedAt: '2024-06-03T00:00:00.000Z',
    });
    const entryId = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const put = await asB('PUT', `/api/v1/odometer/${entryId}`, { odometer: 10500 });
    const putBody = await json<DataEnvelope<{ odometer: number }>>(put);
    expect(put.status, JSON.stringify(putBody)).toBe(200);
    expect(putBody.data.odometer).toBe(10500);
    expect(storedUserId(entryId)).toBe(ctx.user.id); // owner-stamp invariant survives an editor edit

    const del = await asB('DELETE', `/api/v1/odometer/${entryId}`);
    expect(del.status, 'editor can delete a shared-vehicle reading').toBe(200);
    expect(
      ctx.sqlite.query('SELECT id FROM odometer_entries WHERE id = ?').get(entryId)
    ).toBeNull();
  });

  test('a VIEWER cannot create/update/delete on the shared vehicle (404, never 403)', async () => {
    const vehicleId = await shareAccepted('viewer');
    const created = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 5000,
      recordedAt: '2024-06-04T00:00:00.000Z',
    });
    const entryId = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    expect(
      (
        await asB('POST', `/api/v1/odometer/${vehicleId}`, {
          odometer: 6000,
          recordedAt: '2024-06-05T00:00:00.000Z',
        })
      ).status,
      'viewer create denied'
    ).toBe(404);
    expect((await asB('PUT', `/api/v1/odometer/${entryId}`, { odometer: 1 })).status).toBe(404);
    expect((await asB('DELETE', `/api/v1/odometer/${entryId}`)).status).toBe(404);

    // The owner's reading is untouched.
    const stillThere = ctx.sqlite
      .query('SELECT odometer FROM odometer_entries WHERE id = ?')
      .get(entryId) as { odometer: number };
    expect(stillThere.odometer).toBe(5000);
  });
});
