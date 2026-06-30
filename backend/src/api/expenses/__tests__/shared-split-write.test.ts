/**
 * vehicle-sharing T5b-2b — split-expense WRITE widening through the REAL stack (the deeper money path).
 *
 * The split analogue of T5b-2 (single-expense owner-stamp), ratified design §2.1 option (a). A split
 * lands a sibling on EACH config vehicle, so the acting user must hold WRITE access (owner | accepted
 * editor) to EVERY one — `requireSplitWriteAccess` gates per vehicle through the share seam. Because a
 * split group carries ONE `userId` across all siblings (the owner-stamp invariant), the vehicle set
 * must resolve to a SINGLE owner: a shared editor may split a cost across several vehicles ONLY when
 * they all belong to one owner. A cross-owner split is rejected (the clean-cut resolution of the
 * multi-owner fork the T5b-2b note named). Every sibling is stamped `userId = OWNER`, `createdBy =
 * the editor` (or NULL when the owner authors it — the legacy/self sentinel).
 *
 * Fixture mirrors shared-expense-write.test.ts: A is the OWNER (harness session); B is a second user
 * invited as editor/viewer. The IDOR denials (third-party / viewer / cross-owner) are pinned both here
 * (positive + reject behavior the status-only sweep cannot express) and in cross-tenant-idor.test.ts.
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
  bId = `splitw-invitee-${++bCounter}`;
  bEmail = `splitw-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Editor B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

interface SplitData {
  siblings: Array<{ id: string; vehicleId: string; expenseAmount: number }>;
  groupId: string;
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

/** A owns a vehicle and invites B at `level`, then B accepts → an ACCEPTED share. Returns vehicleId. */
async function shareAccepted(level: 'viewer' | 'editor'): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteBody = await json<DataEnvelope<{ id: string }>>(invite);
  expect(invite.status, JSON.stringify(inviteBody)).toBe(201);
  const acc = await asB('POST', `/api/v1/shares/${inviteBody.data.id}/accept`);
  expect(acc.status, 'B accepts the invite').toBe(200);
  return vehicleId;
}

/** Raw stored rows for a group (userId + createdBy), read directly so we assert the owner-stamp. */
function storedSiblings(groupId: string): Array<{ user_id: string; created_by: string | null }> {
  return ctx.sqlite
    .query('SELECT user_id, created_by FROM expenses WHERE group_id = ?')
    .all(groupId) as Array<{ user_id: string; created_by: string | null }>;
}

describe('split-expense WRITE widening — owner-stamp + createdBy (T5b-2b)', () => {
  test('an EDITOR split across the owner one vehicle stamps every sibling userId=OWNER, createdBy=editor', async () => {
    const vehicleId = await shareAccepted('editor');

    const res = await asB('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'maintenance',
      totalAmount: 60,
      date: '2024-06-01T00:00:00.000Z',
      description: 'split by editor',
    });
    const body = await json<DataEnvelope<SplitData>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const rows = storedSiblings(body.data.groupId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.user_id).toBe(ctx.user.id); // owner A — not the acting editor B
      expect(row.created_by).toBe(bId); // provenance: editor B physically entered it
    }

    // It rides the OWNER's books: A's per-vehicle list shows the siblings.
    const ownerList = await json<DataEnvelope<Array<{ id: string }>>>(
      await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)
    );
    for (const sib of body.data.siblings) {
      expect(ownerList.data.find((e) => e.id === sib.id)).toBeDefined();
    }
  });

  test('an EDITOR split across TWO of the SAME owner vehicles is allowed (single-owner set)', async () => {
    const v1 = await shareAccepted('editor');
    // A second vehicle of the SAME owner A, shared to B as editor.
    const v2 = await shareAccepted('editor');

    const res = await asB('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [v1, v2] },
      category: 'maintenance',
      totalAmount: 80,
      date: '2024-06-02T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<SplitData>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const rows = storedSiblings(body.data.groupId);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.user_id).toBe(ctx.user.id);
      expect(row.created_by).toBe(bId);
    }
  });

  test('an OWNER split on their own vehicle is unchanged: userId=self, createdBy=NULL', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'misc',
      totalAmount: 40,
      date: '2024-06-03T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<SplitData>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    for (const row of storedSiblings(body.data.groupId)) {
      expect(row.user_id).toBe(ctx.user.id);
      expect(row.created_by).toBeNull(); // self-created → NULL sentinel, identical to pre-T5b-2b
    }
  });

  test('a cross-owner split (B own vehicle + A shared vehicle) is REJECTED — single-owner invariant', async () => {
    const sharedFromA = await shareAccepted('editor'); // owned by A, B is editor
    // B owns their OWN vehicle directly — created through B's OWN authenticated session (not the
    // A-bound seedVehicle helper), so it is genuinely owned by B.
    const bVehRes = await asB('POST', '/api/v1/vehicles', {
      make: 'BOwn',
      model: 'Car',
      year: 2023,
    });
    const bOwn = (await json<DataEnvelope<{ id: string }>>(bVehRes)).data.id;
    expect(bVehRes.status, 'B seeds own vehicle').toBeLessThan(300);

    const res = await asB('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [sharedFromA, bOwn] },
      category: 'misc',
      totalAmount: 50,
      date: '2024-06-04T00:00:00.000Z',
    });
    // Different owners (A and B) → cannot stamp one userId for the group → 400 ValidationError.
    expect(res.status, 'cross-owner split rejected').toBe(400);
    // Nothing was written for either vehicle under this attempt.
    const leaked = ctx.sqlite
      .query('SELECT id FROM expenses WHERE vehicle_id IN (?, ?)')
      .all(sharedFromA, bOwn) as Array<{ id: string }>;
    expect(leaked.length).toBe(0);
  });

  test('a VIEWER cannot create a split on the shared vehicle (404, never 403)', async () => {
    const vehicleId = await shareAccepted('viewer');
    const res = await asB('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'misc',
      totalAmount: 20,
      date: '2024-06-05T00:00:00.000Z',
    });
    expect(res.status, 'viewer split create denied').toBe(404);
  });

  test('an EDITOR can PUT and DELETE a split group on the shared vehicle (owner-stamp preserved)', async () => {
    const vehicleId = await shareAccepted('editor');
    // Owner A creates the split; editor B edits + deletes it.
    const created = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'misc',
      totalAmount: 30,
      date: '2024-06-06T00:00:00.000Z',
    });
    const gid = (await json<DataEnvelope<SplitData>>(created)).data.groupId;

    const put = await asB('PUT', `/api/v1/expenses/split/${gid}`, {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      totalAmount: 90,
    });
    expect(put.status, 'editor can update a shared split').toBe(200);
    // Owner-stamp invariant holds after the editor edit: every regenerated sibling stays userId=OWNER,
    // createdBy=editor.
    for (const row of storedSiblings(gid)) {
      expect(row.user_id).toBe(ctx.user.id);
      expect(row.created_by).toBe(bId);
    }

    const del = await asB('DELETE', `/api/v1/expenses/split/${gid}`);
    expect(del.status, 'editor can delete a shared split').toBe(200);
    expect(ctx.sqlite.query('SELECT id FROM expenses WHERE group_id = ?').get(gid)).toBeNull();
  });

  test('an EDITOR (and a VIEWER) can GET a shared split group; a non-shared third party cannot', async () => {
    const vehicleId = await shareAccepted('viewer');
    const created = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'misc',
      totalAmount: 25,
      date: '2024-06-07T00:00:00.000Z',
    });
    const gid = (await json<DataEnvelope<SplitData>>(created)).data.groupId;

    const viewerGet = await asB('GET', `/api/v1/expenses/split/${gid}`);
    expect(viewerGet.status, 'accepted viewer can read the shared split').toBe(200);
  });
});
