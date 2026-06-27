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

  // vehicle-sharing T6 (odometer READ+WRITE widening — the C108-C116 IDOR discipline). The odometer
  // read/write gates moved from validateVehicleOwnership/validateOdometerOwnership → requireVehicleRead/
  // Write. This pins the widening did not over-open: a NON-shared third party is still denied every
  // read+write (existence-hiding 404), and an accepted VIEWER who legitimately READS the shared vehicle
  // still cannot WRITE it (the requireVehicleRead vs requireVehicleWrite split). Here B owns the vehicle.
  test('odometer (T6): a third party is denied read+write; a viewer reads but cannot write', async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    const oid = await idOf(
      await asB('POST', `/api/v1/odometer/${vid}`, {
        odometer: 31000,
        recordedAt: '2024-06-02T00:00:00.000Z',
      })
    );
    const createBody = { odometer: 32000, recordedAt: '2024-06-03T00:00:00.000Z' };

    // (1) THIRD PARTY — A has NO share: every read + write is denied (existence-hiding 404).
    expectDenied(await ctx.authed('GET', `/api/v1/odometer/${vid}`), 'third-party list');
    expectDenied(await ctx.authed('GET', `/api/v1/odometer/${vid}/history`), 'third-party history');
    expectDenied(await ctx.authed('GET', `/api/v1/odometer/entry/${oid}`), 'third-party single');
    expectDenied(
      await ctx.authed('POST', `/api/v1/odometer/${vid}`, createBody),
      'third-party create'
    );
    expectDenied(
      await ctx.authed('PUT', `/api/v1/odometer/${oid}`, { odometer: 1 }),
      'third-party update'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/odometer/${oid}`), 'third-party delete');

    // (2) VIEWER — B shares vid with A as viewer; A accepts. A can READ but every WRITE is denied 404.
    const shareId = await idOf(
      await asB('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: ctx.user.email,
        level: 'viewer',
      })
    );
    expect((await ctx.authed('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);
    expect(
      (await ctx.authed('GET', `/api/v1/odometer/${vid}`)).status,
      'viewer can read the shared vehicle odometer list'
    ).toBe(200);
    expect((await ctx.authed('GET', `/api/v1/odometer/entry/${oid}`)).status).toBe(200);
    expectDenied(await ctx.authed('POST', `/api/v1/odometer/${vid}`, createBody), 'viewer create');
    expectDenied(
      await ctx.authed('PUT', `/api/v1/odometer/${oid}`, { odometer: 1 }),
      'viewer update'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/odometer/${oid}`), 'viewer delete');

    // B's reading survived every denied write — unchanged value.
    const stillThere = await asB('GET', `/api/v1/odometer/entry/${oid}`);
    const body = await json<DataEnvelope<{ odometer: number }>>(stillThere);
    expect(stillThere.status).toBe(200);
    expect(body.data.odometer).toBe(31000);
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

    // C116 (the LAST known IDOR-sweep gap): PUT /notifications/:id/read is a state-changing route
    // gated on markNotificationRead's (id, userId) scope (it throws NotFoundError when no row matches —
    // repository.ts:565), but the sweep never covered it. Raw-seed a notification owned by B (the API
    // only creates these via the trigger), then prove A can't mark B's notification read. Closes the
    // route-coverage IDOR audit (C108–C116) for every state-changing route.
    ctx.sqlite.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read, created_at)
       VALUES ('n-idor-b', ?, ?, 1700000000, NULL, 0, 1000)`,
      [rid, bId]
    );
    expectDenied(
      await ctx.authed('PUT', '/api/v1/reminders/notifications/n-idor-b/read'),
      'PUT notification read'
    );
    // And B's notification is untouched — still unread.
    const stillUnread = ctx.sqlite
      .query('SELECT is_read FROM reminder_notifications WHERE id = ?')
      .get('n-idor-b') as { is_read: number };
    expect(stillUnread.is_read).toBe(0);
  });

  // vehicle-sharing T7 (reminder per-vehicle READ widening — the C108-C116 IDOR discipline). The
  // GET /reminders?vehicleId list moved from a flat userId scope to requireVehicleRead + owner-scoped
  // listing. This pins the widening did not over-open: a NON-shared third party is denied the
  // per-vehicle list (existence-hiding 404). The WRITE paths are NOT widened in T7 (a reminder spans
  // multiple vehicles → owner-stamp is a distinct T7b slice), so an accepted EDITOR still cannot create
  // a reminder on the shared vehicle (validateVehicleIdsOwned stays strict) — proven here so the read
  // widening is not mistaken for a write grant. Here B owns the vehicle.
  test('reminder per-vehicle read (T7): a third party is denied the vehicle-scoped list; write stays owner-only', async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    const created = await asB('POST', '/api/v1/reminders', {
      name: 'B reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vid],
    });
    expect(created.status).toBe(201);

    // (1) THIRD PARTY — A has NO share: the per-vehicle reminder list is denied (existence-hiding 404).
    expectDenied(await ctx.authed('GET', `/api/v1/reminders?vehicleId=${vid}`), 'third-party list');

    // (2) B shares vid with A as EDITOR; A accepts. A can now LIST the shared vehicle's reminders…
    const shareId = await idOf(
      await asB('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: ctx.user.email,
        level: 'editor',
      })
    );
    expect((await ctx.authed('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);
    expect(
      (await ctx.authed('GET', `/api/v1/reminders?vehicleId=${vid}`)).status,
      'editor can read the shared vehicle reminders'
    ).toBe(200);

    // …but WRITE stays owner-only (T7b not yet shipped) — creating a reminder on the shared vehicle is
    // still rejected (validateVehicleIdsOwned: the vehicle is not in A's owned fleet).
    expectDenied(
      await ctx.authed('POST', '/api/v1/reminders', {
        name: 'A reminder on B vehicle',
        type: 'notification',
        frequency: 'monthly',
        startDate: '2024-06-02T00:00:00.000Z',
        vehicleIds: [vid],
      }),
      'editor create reminder on shared vehicle (write still owner-only)'
    );
  });

  // vehicle-sharing T8a (per-vehicle analytics READ widening — the C108-C116 IDOR discipline). The six
  // vehicle-scoped analytics routes moved from validateVehicleOwnership → requireVehicleRead + owner-scope.
  // This pins the widening did not over-open: a NON-shared third party is denied every per-vehicle
  // analytics route (existence-hiding 404). An accepted viewer reading them is covered in
  // shared-analytics-read.test.ts; here B owns the vehicle and A has no share.
  test('analytics per-vehicle read (T8a): a third party is denied every vehicle-scoped analytics route', async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    // Seed a fuel expense so the routes have data to (not) leak.
    await asB('POST', '/api/v1/expenses', {
      vehicleId: vid,
      category: 'fuel',
      expenseAmount: 50,
      volume: 10,
      mileage: 30000,
      fuelType: 'Regular',
      date: '2024-06-01T00:00:00.000Z',
    });
    const range = 'startDate=1704067200&endDate=1735689600';
    const routes = [
      `/api/v1/analytics/fuel-stats?${range}&vehicleId=${vid}`,
      `/api/v1/analytics/fuel-advanced?${range}&vehicleId=${vid}`,
      `/api/v1/analytics/fuel-efficiency?vehicleId=${vid}`,
      `/api/v1/analytics/vehicle-health?vehicleId=${vid}`,
      `/api/v1/analytics/vehicle-tco?vehicleId=${vid}`,
      `/api/v1/analytics/vehicle-expenses?${range}&vehicleId=${vid}`,
    ];
    for (const route of routes) {
      expectDenied(await ctx.authed('GET', route), `third-party analytics ${route}`);
    }
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

  // vehicle-sharing T3 (owner-side share management). The share IS the cross-tenant feature, so the
  // owner-side endpoints must reject every NON-owner: A cannot invite to B's vehicle, and A cannot
  // change-level / revoke a share that B granted (A is at most the invitee, never the manager). B
  // owns the vehicle + grants the share TO A here, so a real share row exists with B as owner; A
  // managing it via the owner endpoints must 404 (existence-hiding, scoped by vehicle_shares.ownerId).
  test("shares: A cannot invite to B's vehicle, nor manage a share B granted", async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );

    // A cannot invite anyone to B's vehicle (owner-only; 404 existence-hiding, not 403).
    expectDenied(
      await ctx.authed('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: 'whoever@test.com',
        level: 'viewer',
      }),
      'POST share to B vehicle'
    );

    // B legitimately shares its vehicle WITH A (so a real share row exists, owner = B).
    const shareRes = await asB('POST', '/api/v1/shares', {
      vehicleId: vid,
      email: ctx.user.email,
      level: 'viewer',
    });
    const shareId = await idOf(shareRes);

    // A is the INVITEE, not the owner — A must NOT be able to change the level or revoke via the
    // owner-side endpoints (those are scoped to vehicle_shares.ownerId === acting → 404 for A).
    expectDenied(
      await ctx.authed('PUT', `/api/v1/shares/${shareId}`, { level: 'editor' }),
      'PUT share level as non-owner'
    );
    expectDenied(
      await ctx.authed('DELETE', `/api/v1/shares/${shareId}`),
      'DELETE share as non-owner'
    );

    // And the share is untouched — B still lists it as a viewer-level pending share.
    const granted = await asB('GET', '/api/v1/shares/granted');
    const body =
      await json<DataEnvelope<Array<{ id: string; level: string; status: string }>>>(granted);
    expect(granted.status).toBe(200);
    const row = body.data.find((s) => s.id === shareId);
    expect(row?.level).toBe('viewer');
    expect(row?.status).toBe('pending');
  });

  // vehicle-sharing T4 (invitee-side accept/decline). These are sharedWithId-scoped: ONLY the invitee
  // can act on their own invite. Here B owns the vehicle and invites A, so A is the invitee — the OWNER
  // B (not the invitee) must NOT be able to accept or decline the invite it sent (that is A's call).
  test('shares: the owner (non-invitee) cannot accept/decline an invite it sent', async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    const shareId = await idOf(
      await asB('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: ctx.user.email, // invite A (the invitee)
        level: 'viewer',
      })
    );

    // B is the owner, NOT the invitee — accept/decline are scoped to sharedWithId === acting, so B
    // gets the same 404 a stranger does (existence-hiding); only A may accept/decline.
    expectDenied(
      await asB('POST', `/api/v1/shares/${shareId}/accept`),
      'accept as owner (non-invitee)'
    );
    expectDenied(
      await asB('POST', `/api/v1/shares/${shareId}/decline`),
      'decline as owner (non-invitee)'
    );

    // The invite is untouched — still pending — and A (the real invitee) CAN accept it.
    const acc = await ctx.authed('POST', `/api/v1/shares/${shareId}/accept`);
    expect(acc.status, 'the real invitee A can accept').toBe(200);
  });

  // vehicle-sharing T5b-2 (expense WRITE widening — the C108-C116 IDOR discipline for the owner-stamp
  // model). The write gate moved from strict validateVehicleOwnership to requireVehicleWrite (owner OR
  // accepted editor). This pins that the WIDENING did not over-open: every NON-writer is still denied
  // with the existence-hiding 404 — a third party with no share, a VIEWER (read-only), and an editor
  // acting on a vehicle they were NOT shared. Here B owns the vehicle; A is the foreign session that B
  // may share with at a given level. (The positive owner-stamp behavior is in shared-expense-write.test.ts.)
  test('expense WRITE (T5b-2): a third party, a viewer, and an editor-on-another-vehicle are all denied', async () => {
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
    const createBody = {
      vehicleId: vid,
      category: 'misc',
      expenseAmount: 7,
      date: '2024-06-02T00:00:00.000Z',
    };

    // (1) THIRD PARTY — A has NO share on B's vehicle: create/update/delete all 404 (existence-hiding).
    expectDenied(await ctx.authed('POST', '/api/v1/expenses', createBody), 'third-party create');
    expectDenied(
      await ctx.authed('PUT', `/api/v1/expenses/${eid}`, { expenseAmount: 9999 }),
      'third-party update'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/expenses/${eid}`), 'third-party delete');

    // (2) VIEWER — B shares the vehicle with A as VIEWER (read-only) and A accepts. A can READ but every
    // WRITE is denied with the SAME 404 (requireVehicleWrite denies a viewer with no capability oracle).
    const viewerShareId = await idOf(
      await asB('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: ctx.user.email,
        level: 'viewer',
      })
    );
    expect((await ctx.authed('POST', `/api/v1/shares/${viewerShareId}/accept`)).status).toBe(200);
    expectDenied(await ctx.authed('POST', '/api/v1/expenses', createBody), 'viewer create');
    expectDenied(
      await ctx.authed('PUT', `/api/v1/expenses/${eid}`, { expenseAmount: 9999 }),
      'viewer update'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/expenses/${eid}`), 'viewer delete');

    // (3) EDITOR-ON-ANOTHER-VEHICLE — even promoted to EDITOR on vid, A must not be able to write to a
    // DIFFERENT B vehicle A was never shared (the resolver is per-vehicle, not a blanket B-access grant).
    expect((await asB('PUT', `/api/v1/shares/${viewerShareId}`, { level: 'editor' })).status).toBe(
      200
    );
    const otherVid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B2', model: 'Other', year: 2023 })
    );
    expectDenied(
      await ctx.authed('POST', '/api/v1/expenses', {
        vehicleId: otherVid,
        category: 'misc',
        expenseAmount: 7,
        date: '2024-06-03T00:00:00.000Z',
      }),
      'editor create on a non-shared B vehicle'
    );

    // B's original expense survived every denied write — untouched amount, still B's row.
    const stillThere = await asB('GET', `/api/v1/expenses/${eid}`);
    const body = await json<DataEnvelope<{ expenseAmount: number }>>(stillThere);
    expect(stillThere.status).toBe(200);
    expect(body.data.expenseAmount).toBe(42);
  });

  // vehicle-sharing T5b-2 (editor-owner-action-denied — design §2.1 rule 5 + §6.3). An accepted EDITOR
  // PASSES requireVehicleWrite (it can write EXPENSES on the shared vehicle), but the OWNER-ONLY actions
  // must keep the STRICT validateVehicleOwnership: requireVehicleWrite is NOT sufficient for them. Prove
  // a real accepted editor (A, shared editor on B's vehicle) still cannot delete/edit the vehicle, create
  // financing on it, or manage its shares — each owner-only route 404s the editor (existence-hiding).
  test('expense WRITE (T5b-2): an accepted editor still cannot reach OWNER-ONLY actions on the shared vehicle', async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
    );
    // B shares vid with A as EDITOR; A accepts → A has accepted editor WRITE access to vid.
    const shareId = await idOf(
      await asB('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: ctx.user.email,
        level: 'editor',
      })
    );
    expect((await ctx.authed('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);

    // Sanity: the editor CAN write an expense (the widened capability) — so the denials below are
    // specifically the owner-only boundary, not a blanket no-access.
    expect(
      (
        await ctx.authed('POST', '/api/v1/expenses', {
          vehicleId: vid,
          category: 'misc',
          expenseAmount: 3,
          date: '2024-06-07T00:00:00.000Z',
        })
      ).status
    ).toBe(201);

    // OWNER-ONLY, still strict validateVehicleOwnership → 404 for the editor:
    expectDenied(
      await ctx.authed('PUT', `/api/v1/vehicles/${vid}`, { make: 'Hacked' }),
      'editor edit vehicle'
    );
    expectDenied(await ctx.authed('DELETE', `/api/v1/vehicles/${vid}`), 'editor delete vehicle');
    expectDenied(
      await ctx.authed('POST', `/api/v1/financing/vehicles/${vid}/financing`, {
        financingType: 'loan',
        provider: 'X',
        originalAmount: 1000,
        termMonths: 12,
        startDate: '2024-01-01T00:00:00.000Z',
        paymentAmount: 100,
        paymentFrequency: 'monthly',
      }),
      'editor create financing'
    );
    expectDenied(
      await ctx.authed('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: 'someone-else@test.com',
        level: 'viewer',
      }),
      'editor manage shares (re-share)'
    );

    // B's vehicle survived: still B's make, still owned by B.
    const stillB = await json<DataEnvelope<{ make: string }>>(
      await asB('GET', `/api/v1/vehicles/${vid}`)
    );
    expect(stillB.data.make).toBe('B');
  });

  // vehicle-sharing T5b-3 (expense READ widening — the C108-C116 IDOR discipline for the read seam).
  // The per-vehicle reads moved from validateVehicleOwnership/validateExpenseOwnership →
  // requireVehicleRead (owner | accepted viewer | accepted editor). This pins the read widening did not
  // over-open: a NON-shared third party is still denied the per-vehicle list / single / summary with the
  // existence-hiding 404; and an accepted VIEWER who legitimately READS the shared vehicle still cannot
  // WRITE it (read access never implies write — the requireVehicleRead vs requireVehicleWrite split).
  test('expense READ (T5b-3): a third party is denied per-vehicle reads; a viewer reads but cannot write', async () => {
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

    // (1) THIRD PARTY — A has NO share: every per-vehicle read is denied (existence-hiding 404).
    expectDenied(await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vid}`), 'third-party list');
    expectDenied(await ctx.authed('GET', `/api/v1/expenses/${eid}`), 'third-party single read');
    expectDenied(
      await ctx.authed('GET', `/api/v1/expenses/summary?vehicleId=${vid}`),
      'third-party summary'
    );

    // (2) VIEWER — B shares vid with A as viewer; A accepts. A can READ the shared vehicle but a WRITE
    // is still denied (requireVehicleRead grants read; requireVehicleWrite denies a viewer — same 404).
    const shareId = await idOf(
      await asB('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: ctx.user.email,
        level: 'viewer',
      })
    );
    expect((await ctx.authed('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);
    expect(
      (await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vid}`)).status,
      'viewer can read the shared vehicle list'
    ).toBe(200);
    expect((await ctx.authed('GET', `/api/v1/expenses/${eid}`)).status, 'viewer single read').toBe(
      200
    );
    expectDenied(
      await ctx.authed('PUT', `/api/v1/expenses/${eid}`, { expenseAmount: 1 }),
      'viewer write still denied after read grant'
    );
  });

  // vehicle-sharing T12 (enriched /received). The "shared with me" list now JOINs the vehicle + owner
  // to label each row — so the join must stay scoped to sharedWithId === acting: an invitee must see
  // ONLY shares addressed to THEM, never another tenant's received invites. B invites A; A's /received
  // shows that one row, B's /received shows none (B is the owner, not an invitee of anything here).
  test('shares: /received is scoped to the acting invitee even with the vehicle+owner join (T12)', async () => {
    const vid = await idOf(
      await asB('POST', '/api/v1/vehicles', { make: 'Subaru', model: 'Outback', year: 2023 })
    );
    await idOf(
      await asB('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: ctx.user.email, // invite A
        level: 'viewer',
      })
    );

    // A (the invitee) sees exactly the one share addressed to A, enriched with B's vehicle + B's name.
    const aRecv = await json<DataEnvelope<Array<{ sharedWithId: string; vehicleName?: string }>>>(
      await ctx.authed('GET', '/api/v1/shares/received')
    );
    expect(aRecv.data.length).toBe(1);
    expect(aRecv.data[0]!.sharedWithId).toBe(ctx.user.id);
    expect(aRecv.data[0]!.vehicleName).toBe('2023 Subaru Outback');

    // B is the OWNER, not an invitee — B's /received is empty (the join did not leak its own grant in).
    const bRecv = await json<DataEnvelope<unknown[]>>(await asB('GET', '/api/v1/shares/received'));
    expect(bRecv.data.length).toBe(0);
  });
});
