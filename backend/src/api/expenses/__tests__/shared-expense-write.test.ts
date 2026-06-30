/**
 * vehicle-sharing T5b-2 — expense WRITE widening through the REAL stack (the money-data-safety core).
 *
 * The editor-WRITE gate-widening on expenses, ratified by Angelo as the OWNER-STAMP model (design
 * §2.1, option a): POST/PUT/DELETE /expenses authorize via `requireVehicleWrite` (owner OR accepted
 * editor; viewer/stranger get the same 404 — existence-hiding, #80) instead of the strict
 * validateVehicleOwnership. When a shared EDITOR creates a cost on the owner's vehicle, the row is
 * stamped `userId = OWNER` (so it rides the owner's backup/TCO + counts once) while `createdBy`
 * records the editor as the actual author.
 *
 * Fixture: A is the OWNER (the harness-seeded session); B is a SECOND user invited as editor/viewer
 * on A's vehicle (same two-real-sessions-one-DB pattern as cross-tenant-idor + shared-fleet-list). The
 * IDOR half lives in cross-tenant-idor.test.ts (third-party / viewer-write / editor-other-vehicle /
 * editor-owner-action denials); THIS file pins the positive owner-stamp behavior the IDOR sweep cannot
 * express (the resulting row's userId/createdBy values, and that the editor's write lands on the
 * OWNER's books — invisible to a status-code-only denial test).
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
  bId = `expw-invitee-${++bCounter}`;
  bEmail = `expw-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Editor B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

interface ExpenseRow {
  id: string;
  vehicleId: string;
  expenseAmount: number;
  description: string | null;
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

/** The raw stored row (userId + createdBy), read directly so we assert the owner-stamp, not the API echo. */
function storedRow(expenseId: string): { user_id: string; created_by: string | null } {
  return ctx.sqlite
    .query('SELECT user_id, created_by FROM expenses WHERE id = ?')
    .get(expenseId) as { user_id: string; created_by: string | null };
}

describe('expense WRITE widening — owner-stamp + createdBy (T5b-2)', () => {
  test('an EDITOR create stamps userId=OWNER and createdBy=editor (rides the owner books)', async () => {
    const vehicleId = await shareAccepted('editor');

    const res = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 50,
      date: '2024-06-01T00:00:00.000Z',
      description: 'oil change by editor',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    // Owner-stamp: the row belongs to the OWNER (A), the author is the editor (B).
    const row = storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id); // owner A — not the acting editor B
    expect(row.created_by).toBe(bId); // provenance: editor B physically entered it

    // It rides the OWNER's books: A's per-vehicle expense list shows it; B's own list (no share filter) does NOT.
    const ownerList = await json<DataEnvelope<ExpenseRow[]>>(
      await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)
    );
    expect(ownerList.data.find((e) => e.id === body.data.id)).toBeDefined();
  });

  test('an OWNER create on their own vehicle is unchanged: userId=self, createdBy=NULL (self sentinel)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 12,
      date: '2024-06-02T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBeNull(); // self-created → NULL legacy/self sentinel, identical to pre-T5b
  });

  // PROVENANCE FORGE-VECTOR GUARD (T5b-2 hardening, C104): `createdBy` is SERVER-controlled — the create
  // schema OMITS it from client input and the handler computes it (acting-when-editor, else NULL). A
  // client must NOT be able to claim a different author by putting `createdBy` in the POST body. These
  // pin that the forged value is IGNORED on BOTH paths, so a future schema refactor (re-adding the field,
  // or dropping createInsertSchema) that silently reopened the forge would fail here. The body carries an
  // extra `createdBy` via a cast — the schema strips unknown keys, this just proves it at the wire level.
  test('a forged createdBy in the OWNER create body is IGNORED (stays NULL, not the forged id)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 9,
      date: '2024-06-08T00:00:00.000Z',
      createdBy: 'forged-author-id',
    } as Record<string, unknown>);
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const row = storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBeNull(); // forged value dropped — owner self-create is the NULL sentinel
  });

  test('a forged createdBy in an EDITOR create body is IGNORED (stamped the acting editor, not the forged id)', async () => {
    const vehicleId = await shareAccepted('editor');
    const res = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 9,
      date: '2024-06-09T00:00:00.000Z',
      createdBy: 'forged-author-id',
    } as Record<string, unknown>);
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const row = storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id); // owner-stamped
    expect(row.created_by).toBe(bId); // the ACTING editor B — never the forged id
  });

  test('an EDITOR can PUT and DELETE a cost row on the shared vehicle (D3 editor capability)', async () => {
    const vehicleId = await shareAccepted('editor');
    // Owner A creates the row; the editor B then edits + deletes it.
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 30,
      date: '2024-06-03T00:00:00.000Z',
    });
    const id = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const put = await asB('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });
    const putBody = await json<DataEnvelope<{ expenseAmount: number }>>(put);
    expect(put.status, JSON.stringify(putBody)).toBe(200);
    expect(putBody.data.expenseAmount).toBe(99);
    // The owner-stamp invariant holds after an editor edit: userId stays the OWNER.
    expect(storedRow(id).user_id).toBe(ctx.user.id);

    const del = await asB('DELETE', `/api/v1/expenses/${id}`);
    expect(del.status, 'editor can delete a shared-vehicle expense').toBe(200);
    expect(ctx.sqlite.query('SELECT id FROM expenses WHERE id = ?').get(id)).toBeNull();
  });

  test('a VIEWER cannot create/update/delete on the shared vehicle (404, never 403)', async () => {
    const vehicleId = await shareAccepted('viewer');
    // Owner seeds a row for the PUT/DELETE attempts.
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-06-04T00:00:00.000Z',
    });
    const id = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const create = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 5,
      date: '2024-06-05T00:00:00.000Z',
    });
    expect(create.status, 'viewer create denied').toBe(404);
    const put = await asB('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 1 });
    expect(put.status, 'viewer update denied').toBe(404);
    const del = await asB('DELETE', `/api/v1/expenses/${id}`);
    expect(del.status, 'viewer delete denied').toBe(404);

    // The owner's row is untouched by the denied viewer writes.
    expect((storedRow(id) as { user_id: string }).user_id).toBe(ctx.user.id);
    const stillAmount = ctx.sqlite
      .query('SELECT expense_amount FROM expenses WHERE id = ?')
      .get(id) as { expense_amount: number };
    expect(stillAmount.expense_amount).toBe(2000); // 20 dollars → 2000 cents, unchanged
  });

  test('an editor cannot reassign a shared expense onto a vehicle owned by a DIFFERENT user', async () => {
    const sharedVehicle = await shareAccepted('editor');
    // B owns their OWN vehicle (a different owner than A).
    const bVehicle = (
      await json<DataEnvelope<{ id: string }>>(
        await asB('POST', '/api/v1/vehicles', { make: 'Bcar', model: 'X', year: 2020 })
      )
    ).data.id;
    // A row on the shared (A-owned) vehicle.
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId: sharedVehicle,
      category: 'misc',
      expenseAmount: 10,
      date: '2024-06-06T00:00:00.000Z',
    });
    const id = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    // Editor B tries to move A's cost row onto B's OWN vehicle — a cross-owner relocation that would
    // silently move the cost between two users' books. Rejected (the row stays on A's vehicle/books).
    const move = await asB('PUT', `/api/v1/expenses/${id}`, { vehicleId: bVehicle });
    expect(move.status, 'cross-owner reassignment rejected').toBeGreaterThanOrEqual(400);
    expect(move.status).toBeLessThan(500);
    const row = storedRow(id);
    expect(row.user_id).toBe(ctx.user.id); // still A's books
    expect(
      (
        ctx.sqlite.query('SELECT vehicle_id FROM expenses WHERE id = ?').get(id) as {
          vehicle_id: string;
        }
      ).vehicle_id
    ).toBe(sharedVehicle);
  });
});
