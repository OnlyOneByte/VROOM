/**
 * Cross-tenant authorization (IDOR) regression guard — through the REAL stack.
 *
 * A read-only audit (cycle 138) found every resource route enforces ownership
 * before read/mutate/delete. This PROVES it with two real Lucia sessions sharing
 * one app/DB: user B creates resources; user A (a foreign session) tries to
 * GET / PUT / DELETE them by id and must be denied (4xx, never 200 with B's data).
 *
 * If any assertion here flips to 2xx, a cross-tenant data-exposure bug has been
 * introduced — this is the canonical multi-tenant threat for the app.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules; this file
 * imports only the harness statically and dynamic-imports lucia/db/schema AFTER
 * createTestApp() so the second session binds to the same :memory: DB.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../http-client';

let ctx: TestApp; // user A (the harness-seeded session)
let bCookie: string; // a real Lucia session cookie for a SECOND user, B
let bId: string;
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();

  // Mint a second user + real session on the SAME app/DB (dynamic import so it
  // binds to the harness's :memory: connection, like claims-roundtrip does).
  const { db } = await import('../../db/connection');
  const schema = await import('../../db/schema');
  const { lucia } = await import('../../api/auth/lucia');
  // Unique per test so nothing collides with another file's fixed ids on the
  // shared :memory: DB (tests run serially, but ids/sessions must not overlap).
  bId = `user-b-idor-${++bCounter}`;
  await db
    .insert(schema.users)
    .values({ id: bId, email: `userb-${bCounter}@test.com`, displayName: 'User B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

/** Issue a request as user B (foreign session). async so the return type
 *  collapses `Response | Promise<Response>` to `Promise<Response>`. */
async function asB(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: bCookie, 'Sec-Fetch-Site': 'same-origin' };
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init = { ...init, body: JSON.stringify(body) };
  }
  return ctx.app.request(path, init);
}

async function idOf(res: Response): Promise<string> {
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

/** A cross-tenant access must be denied (4xx) and must NOT 2xx-leak the row. */
function expectDenied(res: Response, what: string): void {
  expect(res.status, `${what}: expected a 4xx denial, got ${res.status}`).toBeGreaterThanOrEqual(
    400
  );
  expect(res.status, `${what}: unexpected server error`).toBeLessThan(500);
}

describe('cross-tenant authorization: user A cannot touch user B resources', () => {
  test("vehicle: A cannot GET/PUT/DELETE B's vehicle", async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );

    expectDenied(await ctx.authed('GET', `/api/v1/vehicles/${vid}`), 'GET vehicle');
    expectDenied(
      await ctx.authed('PUT', `/api/v1/vehicles/${vid}`, { make: 'Hacked' }),
      'PUT vehicle'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/vehicles/${vid}`), 'DELETE vehicle');

    // And the row is untouched: B still reads it with its real values.
    const stillThere = await asB('GET', `/api/v1/vehicles/${vid}`);
    const body = await json<DataEnvelope<{ make: string }>>(stillThere);
    expect(stillThere.status).toBe(200);
    expect(body.data.make).toBe('B');
  });

  test("expense: A cannot GET/PUT/DELETE B's expense", async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    const eid = await idOf(
      await asB('POST', '/api/v1/expenses', {
        vehicleId: vid,
        category: 'misc',
        expenseAmount: 42,
        date: '2024-06-01T00:00:00.000Z',
      })
    );

    expectDenied(await ctx.authed('GET', `/api/v1/expenses/${eid}`), 'GET expense');
    expectDenied(
      await ctx.authed('PUT', `/api/v1/expenses/${eid}`, { expenseAmount: 9999 }),
      'PUT expense'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/expenses/${eid}`), 'DELETE expense');

    // C115: the SPLIT routes (PUT/DELETE /split/:id) are state-changing + (groupId, userId)-scoped in the
    // repo (updateSplitExpense/deleteSplitExpense throw NotFoundError when the group isn't found for the
    // caller), but the IDOR sweep skipped them. They're destructive (regenerate/delete sibling expense rows
    // + their photos) and money-bearing — a regression to an un-scoped group write would let A rewrite or
    // delete B's split expenses. Seed B's split group, then prove A is denied both.
    const gid = (
      await json<DataEnvelope<{ groupId: string }>>(
        await asB('POST', '/api/v1/expenses/split', {
          splitConfig: { method: 'even', vehicleIds: [vid] },
          category: 'misc',
          totalAmount: 100,
          date: '2024-06-02T00:00:00.000Z',
        })
      )
    ).data.groupId;
    expectDenied(
      await ctx.authed('PUT', `/api/v1/expenses/split/${gid}`, {
        splitConfig: { method: 'even', vehicleIds: [vid] },
      }),
      'PUT split'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/expenses/split/${gid}`), 'DELETE split');
  });

  test("insurance: A cannot GET/PUT/DELETE B's policy, nor its claim", async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    const policyRes = await asB('POST', '/api/v1/insurance', {
      company: 'B Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [vid] },
        },
      ],
    });
    const policyBody =
      await json<DataEnvelope<{ id: string; terms: Array<{ id: string }> }>>(policyRes);
    expect(policyRes.status, JSON.stringify(policyBody)).toBeLessThan(300);
    const pid = policyBody.data.id;
    const tid = policyBody.data.terms[0].id; // B's term id (nested under the unowned policy)
    const cid = await idOf(
      await asB('POST', `/api/v1/insurance/${pid}/claims`, {
        claimDate: '2024-06-15T00:00:00.000Z',
        claimType: 'collision',
      })
    );

    expectDenied(await ctx.authed('GET', `/api/v1/insurance/${pid}`), 'GET policy');
    expectDenied(
      await ctx.authed('PUT', `/api/v1/insurance/${pid}`, { company: 'Hacked' }),
      'PUT policy'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/insurance/${pid}`), 'DELETE policy');
    // C114: TERM routes (PUT/DELETE /:id/terms/:termId) are state-changing, gated on the SAME
    // validateInsuranceOwnership(id) as the policy itself (routes.ts:230/257), but the IDOR sweep
    // skipped them. A cross-tenant term edit/delete would let A mutate B's insurance terms (and their
    // auto-materialized premium expenses via updateTermExpenses/deleteBySource). terms-http.test.ts
    // (C272) pins the INNER FK defense (a foreign vehicleId in the coverage payload) but always AS the
    // policy owner — the policy-level ownership gate on the term routes was never cross-tenant tested.
    expectDenied(
      await ctx.authed('PUT', `/api/v1/insurance/${pid}/terms/${tid}`, { policyNumber: 'HACK' }),
      'PUT term'
    );
    expectDenied(
      await ctx.authed('DELETE', `/api/v1/insurance/${pid}/terms/${tid}`),
      'DELETE term'
    );
    // Claims are nested under the (unowned) policy.
    expectDenied(await ctx.authed('GET', `/api/v1/insurance/${pid}/claims`), 'GET claims');
    expectDenied(
      await ctx.authed('PUT', `/api/v1/insurance/${pid}/claims/${cid}`, { status: 'denied' }),
      'PUT claim'
    );
    expectDenied(
      await ctx.authed('DELETE', `/api/v1/insurance/${pid}/claims/${cid}`),
      'DELETE claim'
    );
  });

  test("financing: A cannot DELETE/PATCH/PAYOFF B's financing", async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    const fid = await idOf(
      await asB('POST', `/api/v1/financing/vehicles/${vid}/financing`, {
        financingType: 'loan',
        provider: 'B Bank',
        originalAmount: 20000,
        termMonths: 60,
        startDate: '2024-01-01T00:00:00.000Z',
        paymentAmount: 400,
        paymentFrequency: 'monthly',
      })
    );

    expectDenied(
      await ctx.authed('PATCH', `/api/v1/financing/${fid}/payment-amount`, { paymentAmount: 1 }),
      'PATCH financing'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/financing/${fid}`), 'DELETE financing');
    // C113: PUT /:financingId/payoff is a state-changing route gated on the SAME
    // validateFinancingOwnership (routes.ts:219) as DELETE, but the IDOR sweep skipped it. A
    // cross-tenant payoff would let A mark B's financing paid-off (deactivateFinancing → isActive=0,
    // severs the source link) — a destructive write on B's data. Pin it alongside its siblings.
    expectDenied(
      await ctx.authed('PUT', `/api/v1/financing/${fid}/payoff`, {}),
      'PUT financing payoff'
    );
  });

  test("odometer: A cannot GET/PUT/DELETE B's odometer entry", async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    const oid = await idOf(
      await asB('POST', `/api/v1/odometer/${vid}`, {
        odometer: 31000,
        recordedAt: '2024-06-02T00:00:00.000Z',
      })
    );

    expectDenied(await ctx.authed('GET', `/api/v1/odometer/entry/${oid}`), 'GET odometer entry');
    expectDenied(
      await ctx.authed('PUT', `/api/v1/odometer/${oid}`, { odometer: 1 }),
      'PUT odometer'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/odometer/${oid}`), 'DELETE odometer');
    // The vehicle-scoped list for B's vehicle is also denied to A.
    expectDenied(await ctx.authed('GET', `/api/v1/odometer/${vid}`), 'GET odometer list');
  });

  test("reminder: A cannot GET/PUT/DELETE B's reminder", async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    // The reminder create envelope is { data: { reminder, vehicleIds } } — the id
    // lives at data.reminder.id, NOT data.id (idOf would read undefined and the
    // test would pass for the wrong reason against /reminders/undefined).
    const created = await asB('POST', '/api/v1/reminders', {
      name: 'B reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vid],
    });
    const createdBody = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    const rid = createdBody.data.reminder.id;
    expect(rid, 'reminder id must be extracted from data.reminder.id').toBeTruthy();

    expectDenied(await ctx.authed('GET', `/api/v1/reminders/${rid}`), 'GET reminder');
    expectDenied(
      await ctx.authed('PUT', `/api/v1/reminders/${rid}`, { isActive: false }),
      'PUT reminder'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/reminders/${rid}`), 'DELETE reminder');
  });

  test("photo: A cannot list/upload to B's vehicle via the generic photo route", async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    // A tries to read B's vehicle photos and to attach a photo to B's vehicle.
    expectDenied(
      await ctx.authed('GET', `/api/v1/photos/vehicle/${vid}`),
      'GET photos for B vehicle'
    );
  });
});
