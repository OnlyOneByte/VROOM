/**
 * vehicle-sharing T5b-3 — expense READ widening through the REAL stack.
 *
 * The READ half of the owner-stamp model (design §2.1 rule 3). Because shared-created expense rows are
 * OWNER-stamped (userId == vehicle owner, T5b-2), a shared invitee querying their OWN userId would see
 * NOTHING for the shared vehicle. So the PER-VEHICLE reads (GET /expenses?vehicleId, GET /expenses/:id,
 * GET /expenses/summary?vehicleId) gate via requireVehicleRead and then query the OWNER's books — an
 * accepted viewer/editor reads the shared vehicle's costs, a stranger 404s (existence-hiding). The
 * CROSS-FLEET reads (no vehicleId) stay acting-user-owned: a shared vehicle's costs live on the OWNER's
 * dashboard, NOT the invitee's, so there is no double-count and no foreign rows leak into the invitee's
 * all-vehicles list.
 *
 * Fixture: A is the OWNER (the harness-seeded session); B is a SECOND user invited as viewer/editor on
 * A's vehicle (same two-real-sessions-one-DB pattern as shared-expense-write + shared-fleet-list).
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
let bEmail: string;
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  const { lucia } = await import('../../auth/lucia');
  const bId = `expr-invitee-${++bCounter}`;
  bEmail = `expr-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Reader B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

interface ExpenseRow {
  id: string;
  vehicleId: string;
  expenseAmount: number;
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

/** A owns a vehicle (with one expense), invites B at `level`, B accepts. Returns [vehicleId, expenseId]. */
async function shareWithExpense(level: 'viewer' | 'editor'): Promise<[string, string]> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const exp = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount: 75,
    date: '2024-06-01T00:00:00.000Z',
  });
  const expenseId = (await json<DataEnvelope<{ id: string }>>(exp)).data.id;
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
  expect((await asB('POST', `/api/v1/shares/${inviteId}/accept`)).status).toBe(200);
  return [vehicleId, expenseId];
}

describe('expense READ widening — shared per-vehicle reads (T5b-3)', () => {
  test('an accepted VIEWER reads the shared vehicle list / single / summary (owner-stamped rows)', async () => {
    const [vehicleId, expenseId] = await shareWithExpense('viewer');

    // Per-vehicle LIST: B sees the owner's expense on the shared vehicle.
    const list = await json<PaginatedEnvelope<ExpenseRow>>(
      await asB('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)
    );
    expect(list.pagination.totalCount).toBe(1);
    expect(list.data[0]?.id).toBe(expenseId);
    expect(list.data[0]?.expenseAmount).toBe(75); // dollars echoed back (cents→dollars at the edge)

    // Single GET /:id.
    const single = await asB('GET', `/api/v1/expenses/${expenseId}`);
    const singleBody = await json<DataEnvelope<ExpenseRow>>(single);
    expect(single.status).toBe(200);
    expect(singleBody.data.id).toBe(expenseId);

    // Per-vehicle SUMMARY: the owner's cost is aggregated for the shared vehicle.
    const summary = await asB('GET', `/api/v1/expenses/summary?vehicleId=${vehicleId}`);
    const summaryBody =
      await json<DataEnvelope<{ totalAmount: number; expenseCount: number }>>(summary);
    expect(summary.status).toBe(200);
    expect(summaryBody.data.expenseCount).toBe(1);
    expect(summaryBody.data.totalAmount).toBe(75);
  });

  test('CROSS-FLEET reads stay acting-user-owned: B all-vehicles list/summary exclude the shared vehicle (no double-count)', async () => {
    const [vehicleId] = await shareWithExpense('editor');

    // B's all-vehicles list (no vehicleId) shows none of A's costs — they belong to A's dashboard.
    const list = await json<PaginatedEnvelope<ExpenseRow>>(await asB('GET', '/api/v1/expenses'));
    expect(list.data.find((e) => e.vehicleId === vehicleId)).toBeUndefined();
    expect(list.pagination.totalCount).toBe(0);

    // B's cross-fleet summary likewise sees zero (the shared cost is not on B's books).
    const summary = await json<DataEnvelope<{ totalAmount: number; expenseCount: number }>>(
      await asB('GET', '/api/v1/expenses/summary')
    );
    expect(summary.data.expenseCount).toBe(0);
    expect(summary.data.totalAmount).toBe(0);

    // And the OWNER A still sees the cost on their OWN cross-fleet summary (it stayed on A's books).
    const ownerSummary = await json<DataEnvelope<{ totalAmount: number; expenseCount: number }>>(
      await ctx.authed('GET', '/api/v1/expenses/summary')
    );
    expect(ownerSummary.data.expenseCount).toBe(1);
    expect(ownerSummary.data.totalAmount).toBe(75);
  });

  test('a STRANGER (no share) is denied every per-vehicle read with the existence-hiding 404', async () => {
    // A owns a vehicle + expense but never shares it with B.
    const vehicleId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    const exp = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 10,
      date: '2024-06-02T00:00:00.000Z',
    });
    const expenseId = (await json<DataEnvelope<{ id: string }>>(exp)).data.id;

    expect((await asB('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)).status).toBe(404);
    expect((await asB('GET', `/api/v1/expenses/${expenseId}`)).status).toBe(404);
    expect((await asB('GET', `/api/v1/expenses/summary?vehicleId=${vehicleId}`)).status).toBe(404);
  });

  test('a PENDING (un-accepted) invite grants no read — the vehicle reads still 404 until accepted', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Pending', model: 'Car', year: 2021 });
    const exp = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 5,
      date: '2024-06-03T00:00:00.000Z',
    });
    const expenseId = (await json<DataEnvelope<{ id: string }>>(exp)).data.id;
    // Invite B but DO NOT accept.
    await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level: 'viewer' });

    expect((await asB('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)).status).toBe(404);
    expect((await asB('GET', `/api/v1/expenses/${expenseId}`)).status).toBe(404);
  });

  test('the owner reading their OWN vehicle is unchanged (owner === acting, no regression)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 33,
      date: '2024-06-04T00:00:00.000Z',
    });
    const list = await json<PaginatedEnvelope<ExpenseRow>>(
      await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)
    );
    expect(list.pagination.totalCount).toBe(1);
    expect(list.data[0]?.expenseAmount).toBe(33);
  });
});

describe('expense CSV export widening — shared per-vehicle export (T5b-3b)', () => {
  test('an accepted VIEWER exports the shared vehicle CSV (owner-stamped rows + the OWNER vehicle name)', async () => {
    const [vehicleId] = await shareWithExpense('viewer');

    const res = await asB('GET', `/api/v1/expenses/export?vehicleId=${vehicleId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    // The owner-stamped $75 maintenance row is present (proving owner-scope, not an empty invitee export).
    expect(csv).toContain('maintenance');
    expect(csv).toContain('75');
    // The vehicle NAME column resolves from the OWNER's fleet (the invitee's own fleet lacks this
    // vehicle) — "2021 Shared Car", never "Unknown Vehicle".
    expect(csv).toContain('2021 Shared Car');
    expect(csv).not.toContain('Unknown Vehicle');
  });

  test('a STRANGER (no share) is denied the per-vehicle export (existence-hiding 404)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 10,
      date: '2024-06-02T00:00:00.000Z',
    });
    expect((await asB('GET', `/api/v1/expenses/export?vehicleId=${vehicleId}`)).status).toBe(404);
  });

  test('the CROSS-FLEET export (no vehicleId) stays acting-user-scoped — B export excludes the shared vehicle', async () => {
    await shareWithExpense('editor');
    // B exports their WHOLE fleet (no vehicleId) — the shared vehicle's owner-stamped rows are NOT B's,
    // so they must not appear. B owns nothing here, so the export has only the header row.
    const res = await asB('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).not.toContain('2021 Shared Car');
    expect(csv).not.toContain('maintenance');

    // And the OWNER's own cross-fleet export still includes it (it stayed on A's books).
    const ownerCsv = await (await ctx.authed('GET', '/api/v1/expenses/export')).text();
    expect(ownerCsv).toContain('2021 Shared Car');
  });

  test('the owner exporting their OWN vehicle is unchanged (owner === acting)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 12,
      date: '2024-06-03T00:00:00.000Z',
    });
    const res = await ctx.authed('GET', `/api/v1/expenses/export?vehicleId=${vehicleId}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('2022 Owned Car');
  });
});
