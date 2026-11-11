// Cross-tenant authorization through the real stack. User A, holding a real session, must be denied every
// read and write on user B's resources. A 2xx from any denied call is a data-exposure bug.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type PaginatedEnvelope,
  type RequestFn,
  type TestApp,
} from '../http-client';
import { createInvitee } from '../invitee';

let ctx: TestApp; // user A (the harness-seeded session)
let asB: RequestFn;
let bId: string;

beforeEach(async () => {
  ctx = await createTestApp();

  // Second user on the same DB.
  const b = await createInvitee(ctx, 'user-b-idor', 'User B');
  bId = b.id;
  asB = b.request;
});
afterEach(() => ctx.close());

async function idOf(res: Response): Promise<string> {
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

// A real multipart body, so an upload 404 can only come from the ownership gate, not a missing file.
function photoForm(): FormData {
  const form = new FormData();
  form.append('photo', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }));
  return form;
}

// A cross-tenant access must be a 4xx. A 2xx would leak the row.
function expectDenied(res: Response, what: string): void {
  expect(res.status, `${what}: expected a 4xx denial, got ${res.status}`).toBeGreaterThanOrEqual(
    400
  );
  expect(res.status, `${what}: unexpected server error`).toBeLessThan(500);
}

describe('cross-tenant authorization: user A cannot touch user B resources', () => {
  describe('vehicles', () => {
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
      // Stats are open to shared readers, so a non-shared third party must still get a 404.
      expectDenied(
        await ctx.authed('GET', `/api/v1/vehicles/${vid}/stats?period=all`),
        'GET vehicle stats'
      );

      // And the row is untouched: B still reads it with its real values.
      const stillThere = await asB('GET', `/api/v1/vehicles/${vid}`);
      const body = await json<DataEnvelope<{ make: string }>>(stillThere);
      expect(stillThere.status).toBe(200);
      expect(body.data.make).toBe('B');
    });
  });

  describe('expenses', () => {
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

      // Split routes are destructive and money-bearing, so they need their own denial checks.
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

    // A viewer can read a shared split but cannot write it. A split set spanning two owners is rejected.
    test('split: a viewer reads but cannot create/update/delete a split; cross-owner rejected', async () => {
      const vid = await idOf(
        await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
      );
      // B seeds a split group on their own vehicle.
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

      // The viewer can read the group, but every write is denied.
      const shareId = await idOf(
        await asB('POST', '/api/v1/shares', {
          vehicleId: vid,
          email: ctx.user.email,
          level: 'viewer',
        })
      );
      expect((await ctx.authed('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);

      expect(
        (await ctx.authed('GET', `/api/v1/expenses/split/${gid}`)).status,
        'viewer can read the shared split group'
      ).toBe(200);
      expectDenied(
        await ctx.authed('POST', '/api/v1/expenses/split', {
          splitConfig: { method: 'even', vehicleIds: [vid] },
          category: 'misc',
          totalAmount: 10,
          date: '2024-06-03T00:00:00.000Z',
        }),
        'viewer split create'
      );
      expectDenied(
        await ctx.authed('PUT', `/api/v1/expenses/split/${gid}`, {
          splitConfig: { method: 'even', vehicleIds: [vid] },
        }),
        'viewer split update'
      );
      expectDenied(
        await ctx.authed('DELETE', `/api/v1/expenses/split/${gid}`),
        'viewer split delete'
      );

      // A split across A's own vehicle and B's vehicle has two owners, so it must write nothing.
      const aOwn = await idOf(
        await ctx.authed('POST', '/api/v1/vehicles', { make: 'A', model: 'Car', year: 2022 })
      );
      const countExpenses = (): number =>
        (
          ctx.sqlite
            .query('SELECT COUNT(*) AS n FROM expenses WHERE vehicle_id IN (?, ?)')
            .get(aOwn, vid) as { n: number }
        ).n;
      const before = countExpenses();
      const crossRes = await ctx.authed('POST', '/api/v1/expenses/split', {
        splitConfig: { method: 'even', vehicleIds: [aOwn, vid] },
        category: 'misc',
        totalAmount: 50,
        date: '2024-06-04T00:00:00.000Z',
      });
      // Denied either way: a 404 for no write access, or a 400 for two owners.
      expectDenied(crossRes, 'cross-owner / unauthorized split');
      expect(countExpenses(), "no row from A's attempt lands on either vehicle").toBe(before);
    });

    // Owners and accepted editors can write. Third parties, viewers, and editors on other vehicles get a 404.
    test('expense write: a third party, a viewer, and an editor on another vehicle are all denied', async () => {
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

      // (2) VIEWER — A can read the shared vehicle, but every write returns the same 404.
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

      // (3) EDITOR-ON-ANOTHER-VEHICLE — an editor on one vehicle cannot write to another.
      expect(
        (await asB('PUT', `/api/v1/shares/${viewerShareId}`, { level: 'editor' })).status
      ).toBe(200);
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

    // An accepted editor can write expenses, but owner-only actions still return 404 for them.
    test('expense write: an accepted editor still cannot reach owner-only actions on the shared vehicle', async () => {
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

      // Confirms the editor can write, so the denials below are about owner-only actions and not general lack of access.
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

      // Owner-only routes still return 404 for the editor:
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

    // Viewers can read per-vehicle expense data, including export. Reads never imply writes.
    test('expense read: a third party is denied per-vehicle reads; a viewer reads but cannot write', async () => {
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

      // (1) THIRD PARTY — A has NO share: every per-vehicle read, including the CSV export, is denied.
      expectDenied(
        await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vid}`),
        'third-party list'
      );
      expectDenied(await ctx.authed('GET', `/api/v1/expenses/${eid}`), 'third-party single read');
      expectDenied(
        await ctx.authed('GET', `/api/v1/expenses/summary?vehicleId=${vid}`),
        'third-party summary'
      );
      expectDenied(
        await ctx.authed('GET', `/api/v1/expenses/export?vehicleId=${vid}`),
        'third-party export'
      );

      // (2) VIEWER — A can read the shared vehicle, including export, but a write is still denied.
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
      expect(
        (await ctx.authed('GET', `/api/v1/expenses/${eid}`)).status,
        'viewer single read'
      ).toBe(200);
      expect(
        (await ctx.authed('GET', `/api/v1/expenses/export?vehicleId=${vid}`)).status,
        'viewer can export the shared vehicle'
      ).toBe(200);
      expectDenied(
        await ctx.authed('PUT', `/api/v1/expenses/${eid}`, { expenseAmount: 1 }),
        'viewer write still denied after read grant'
      );
    });
  });

  describe('insurance', () => {
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
      // Term routes share the policy's ownership gate. A cross-tenant edit would rewrite B's premium expenses.
      expectDenied(
        await ctx.authed('PUT', `/api/v1/insurance/${pid}/terms/${tid}`, { policyNumber: 'HACK' }),
        'PUT term'
      );
      expectDenied(
        await ctx.authed('DELETE', `/api/v1/insurance/${pid}/terms/${tid}`),
        'DELETE term'
      );
      // Claims inherit the policy's gate.
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

    // Shared viewers may read the per-vehicle policies list. A third party gets a 404.
    test('insurance per-vehicle read: a third party is denied the vehicle-scoped policies list', async () => {
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
      expect(policyRes.status).toBeLessThan(300);
      expectDenied(
        await ctx.authed('GET', `/api/v1/insurance/vehicles/${vid}/policies`),
        'third-party insurance per-vehicle list'
      );
    });

    // Claims are open to viewers of a covered vehicle. A third party with no share gets a 404.
    test('insurance claims read: a third party is denied a policy claims list', async () => {
      const vid = await idOf(
        await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
      );
      const pid = await idOf(
        await asB('POST', '/api/v1/insurance', {
          company: 'B Mutual',
          terms: [
            {
              startDate: '2024-01-01T00:00:00.000Z',
              endDate: '2025-01-01T00:00:00.000Z',
              vehicleCoverage: { vehicleIds: [vid] },
            },
          ],
        })
      );
      expect(
        (
          await asB('POST', `/api/v1/insurance/${pid}/claims`, {
            claimDate: '2024-06-01T00:00:00.000Z',
            claimType: 'collision',
            vehicleId: vid,
          })
        ).status
      ).toBeLessThan(300);
      expectDenied(
        await ctx.authed('GET', `/api/v1/insurance/${pid}/claims`),
        'third-party insurance claims list'
      );
    });
  });

  describe('financing', () => {
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
      // A cross-tenant payoff would deactivate B's financing.
      expectDenied(
        await ctx.authed('PUT', `/api/v1/financing/${fid}/payoff`, {}),
        'PUT financing payoff'
      );
    });
  });

  describe('odometer', () => {
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
      expectDenied(await ctx.authed('GET', `/api/v1/odometer/${vid}`), 'GET odometer list');
    });

    // Shared viewers may read the odometer but not write it. Third parties get a 404 for both.
    test('odometer: a third party is denied read and write; a viewer reads but cannot write', async () => {
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
      expectDenied(
        await ctx.authed('GET', `/api/v1/odometer/${vid}/history`),
        'third-party history'
      );
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
      expectDenied(
        await ctx.authed('POST', `/api/v1/odometer/${vid}`, createBody),
        'viewer create'
      );
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
  });

  describe('reminders', () => {
    test("reminder: A cannot GET/PUT/DELETE B's reminder", async () => {
      const vid = await idOf(
        await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
      );
      // The id is at data.reminder.id, not data.id.
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

      // The notification read route is scoped by (id, userId). Seed B's notification directly, since the API creates them only on trigger.
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

    // Editors may write, with rows stamped to the owner. Viewers may read but not write. Third parties get a 404.
    test('reminder per-vehicle: third party denied; editor writes (owner-stamped); viewer reads not writes; cross-owner rejected', async () => {
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
      const bReminderId = (await json<DataEnvelope<{ reminder: { id: string } }>>(created)).data
        .reminder.id;
      expect(created.status).toBe(201);

      // (1) THIRD PARTY — A has NO share: the per-vehicle list AND every write are denied (404).
      expectDenied(
        await ctx.authed('GET', `/api/v1/reminders?vehicleId=${vid}`),
        'third-party list'
      );
      expectDenied(
        await ctx.authed('POST', '/api/v1/reminders', {
          name: 'A on B',
          type: 'notification',
          frequency: 'monthly',
          startDate: '2024-06-02T00:00:00.000Z',
          vehicleIds: [vid],
        }),
        'third-party create'
      );
      expectDenied(
        await ctx.authed('PUT', `/api/v1/reminders/${bReminderId}`, { name: 'x' }),
        'third-party PUT'
      );
      expectDenied(
        await ctx.authed('DELETE', `/api/v1/reminders/${bReminderId}`),
        'third-party DELETE'
      );

      // (2) VIEWER — B shares vid with A as viewer; A accepts. A can READ the list but every WRITE is 404.
      const viewerShareId = await idOf(
        await asB('POST', '/api/v1/shares', {
          vehicleId: vid,
          email: ctx.user.email,
          level: 'viewer',
        })
      );
      expect((await ctx.authed('POST', `/api/v1/shares/${viewerShareId}/accept`)).status).toBe(200);
      expect(
        (await ctx.authed('GET', `/api/v1/reminders?vehicleId=${vid}`)).status,
        'viewer can read the shared vehicle reminders'
      ).toBe(200);
      expectDenied(
        await ctx.authed('POST', '/api/v1/reminders', {
          name: 'viewer create',
          type: 'notification',
          frequency: 'monthly',
          startDate: '2024-06-02T00:00:00.000Z',
          vehicleIds: [vid],
        }),
        'viewer create'
      );
      expectDenied(
        await ctx.authed('PUT', `/api/v1/reminders/${bReminderId}`, { name: 'x' }),
        'viewer PUT'
      );
      expectDenied(
        await ctx.authed('POST', `/api/v1/reminders/${bReminderId}/mark-serviced`),
        'viewer mark-serviced'
      );

      // Editor creates are stamped to the owner (userId = B), so the row lands in B's books.
      await asB('DELETE', `/api/v1/shares/${viewerShareId}`);
      const editorShareId = await idOf(
        await asB('POST', '/api/v1/shares', {
          vehicleId: vid,
          email: ctx.user.email,
          level: 'editor',
        })
      );
      expect((await ctx.authed('POST', `/api/v1/shares/${editorShareId}/accept`)).status).toBe(200);
      const editorCreate = await ctx.authed('POST', '/api/v1/reminders', {
        name: 'editor create on shared',
        type: 'notification',
        frequency: 'monthly',
        startDate: '2024-06-02T00:00:00.000Z',
        vehicleIds: [vid],
      });
      expect(editorCreate.status, 'editor create now allowed').toBe(201);
      const editorRid = (await json<DataEnvelope<{ reminder: { id: string } }>>(editorCreate)).data
        .reminder.id;
      const stamped = ctx.sqlite
        .query('SELECT user_id FROM reminders WHERE id = ?')
        .get(editorRid) as { user_id: string };
      expect(
        stamped.user_id,
        'editor-created reminder is owner-stamped (B), not the actor (A)'
      ).toBe(bId);

      // (4) CROSS-OWNER — a reminder spanning A's vehicle and B's has two owners, so it is rejected.
      const aOwn = await idOf(
        await ctx.authed('POST', '/api/v1/vehicles', { make: 'A', model: 'Car', year: 2022 })
      );
      const cross = await ctx.authed('POST', '/api/v1/reminders', {
        name: 'cross-owner',
        type: 'notification',
        frequency: 'monthly',
        startDate: '2024-06-03T00:00:00.000Z',
        vehicleIds: [aOwn, vid],
      });
      expect(cross.status, 'cross-owner reminder denied').toBeGreaterThanOrEqual(400);
      expect(cross.status).toBeLessThan(500);
    });
  });

  describe('analytics', () => {
    // Shared viewers may read these routes. A third party with no share gets a 404 on each.
    test('analytics per-vehicle read: a third party is denied every vehicle-scoped analytics route', async () => {
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
  });

  describe('photos', () => {
    test("photo: A cannot list or upload B's vehicle photos", async () => {
      const vid = await idOf(
        await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
      );
      expectDenied(
        await ctx.authed('GET', `/api/v1/photos/vehicle/${vid}`),
        'GET photos for B vehicle'
      );
      expectDenied(
        await ctx.authed('GET', `/api/v1/vehicles/${vid}/photos`),
        'GET B vehicle photos via the vehicle route'
      );

      for (const path of [`/api/v1/photos/vehicle/${vid}`, `/api/v1/vehicles/${vid}/photos`]) {
        const upload = await ctx.app.request(path, {
          method: 'POST',
          headers: { Cookie: ctx.cookie, 'Sec-Fetch-Site': 'same-origin' },
          body: photoForm(),
        });
        expect(upload.status, `POST photo to ${path}: expected a 404`).toBe(404);
      }

      const bList = await json<PaginatedEnvelope<unknown>>(
        await asB('GET', `/api/v1/photos/vehicle/${vid}`)
      );
      expect(bList.data).toHaveLength(0);
    });

    // Each photo entity type authorizes differently, so each one needs its own cross-tenant check.
    test("photo (non-vehicle entities): A cannot list or upload to any of B's photo entities", async () => {
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
      const oid = await idOf(
        await asB('POST', `/api/v1/odometer/${vid}`, {
          odometer: 31000,
          recordedAt: '2024-06-02T00:00:00.000Z',
        })
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
      const pid = await idOf(policyRes);
      const cid = await idOf(
        await asB('POST', `/api/v1/insurance/${pid}/claims`, {
          claimDate: '2024-06-15T00:00:00.000Z',
          claimType: 'collision',
        })
      );

      const entities: [string, string][] = [
        ['expense', eid],
        ['odometer_entry', oid],
        ['insurance_policy', pid],
        ['insurance_claim', cid],
      ];
      for (const [entityType, entityId] of entities) {
        expectDenied(
          await ctx.authed('GET', `/api/v1/photos/${entityType}/${entityId}`),
          `GET photos for B ${entityType}`
        );
        const upload = await ctx.app.request(`/api/v1/photos/${entityType}/${entityId}`, {
          method: 'POST',
          headers: { Cookie: ctx.cookie, 'Sec-Fetch-Site': 'same-origin' },
          body: photoForm(),
        });
        expect(upload.status, `POST photo to B ${entityType}: expected a 404`).toBe(404);
      }

      // Nothing was attached to any of B's entities.
      for (const [entityType, entityId] of entities) {
        const bList = await json<PaginatedEnvelope<unknown>>(
          await asB('GET', `/api/v1/photos/${entityType}/${entityId}`)
        );
        expect(bList.data).toHaveLength(0);
      }
    });
  });

  describe('trips', () => {
    // GET /trips?vehicleId= filters a user-scoped list, so a foreign vehicle returns an empty result, not a denial.
    test("trips: A cannot GET/PUT/DELETE B's trip, nor read B's vehicle trips or summary", async () => {
      const vid = await idOf(
        await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
      );
      const tid = await idOf(
        await asB('POST', '/api/v1/trips', {
          vehicleId: vid,
          startOdometer: 1000,
          endOdometer: 1100,
          purpose: 'business',
          tripDate: '2024-06-01T00:00:00.000Z',
        })
      );

      expectDenied(await ctx.authed('GET', `/api/v1/trips/${tid}`), 'GET trip');
      expectDenied(
        await ctx.authed('PUT', `/api/v1/trips/${tid}`, { purpose: 'personal' }),
        'PUT trip'
      );
      expectDenied(await ctx.authed('DELETE', `/api/v1/trips/${tid}`), 'DELETE trip');
      expectDenied(await ctx.authed('GET', `/api/v1/trips/vehicle/${vid}`), 'GET vehicle trips');
      expectDenied(
        await ctx.authed('GET', `/api/v1/trips/summary?vehicleId=${vid}`),
        'GET trip summary for B vehicle'
      );

      // The user-scoped list filtered by B's vehicle: allowed, but it must return NOTHING of B's.
      const listed = await ctx.authed('GET', `/api/v1/trips?vehicleId=${vid}`);
      expect(listed.status, 'the user-scoped list accepts any vehicleId filter').toBe(200);
      expect((await json<PaginatedEnvelope<unknown>>(listed)).data).toHaveLength(0);

      // B's trip is unchanged. B still reaches every surface A was denied, so the denials prove the ownership gate.
      const stillThere = await asB('GET', `/api/v1/trips/${tid}`);
      expect(stillThere.status).toBe(200);
      expect((await json<DataEnvelope<{ purpose: string }>>(stillThere)).data.purpose).toBe(
        'business'
      );
      expect((await asB('GET', `/api/v1/trips/vehicle/${vid}`)).status).toBe(200);
      expect((await asB('GET', `/api/v1/trips/summary?vehicleId=${vid}`)).status).toBe(200);
    });
  });

  describe('providers and sync', () => {
    // Provider routes use encrypted credentials and gate on findOwnedProviderOrThrow. Each one is probed.
    test("providers: A cannot update/delete/test/backfill/inspect B's provider", async () => {
      // Seeded directly: POST /providers needs real credentials. Every probe checks ownership before reading the row.
      const providerId = `idor-prov-${bId}`;
      ctx.sqlite.run(
        `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
         VALUES (?, ?, 'storage', 's3', 'B Bucket', '', ?, 'active')`,
        [
          providerId,
          bId,
          JSON.stringify({
            endpoint: 'https://s3.example.com',
            bucket: 'b-bucket',
            region: 'us-east-1',
          }),
        ]
      );
      // Positive control: B reaches the row through the same gate, so the denials below prove ownership and not a broken fixture.
      const bOwns = await json<DataEnvelope<Array<{ id: string }>>>(
        await asB('GET', '/api/v1/providers')
      );
      expect(bOwns.data.map((p) => p.id)).toContain(providerId);
      expect(
        (await asB('GET', `/api/v1/providers/${providerId}/sync-status`)).status,
        'B reaches its own provider through findOwnedProviderOrThrow'
      ).toBe(200);

      expectDenied(
        await ctx.authed('PUT', `/api/v1/providers/${providerId}`, { displayName: 'Hacked' }),
        'PUT provider'
      );
      expectDenied(
        await ctx.authed('POST', `/api/v1/providers/${providerId}/test`),
        'POST provider test'
      );
      expectDenied(
        await ctx.authed('POST', `/api/v1/providers/${providerId}/backfill`),
        'POST provider backfill'
      );
      expectDenied(
        await ctx.authed('GET', `/api/v1/providers/${providerId}/sync-status`),
        'GET provider sync-status'
      );
      expectDenied(
        await ctx.authed('DELETE', `/api/v1/providers/${providerId}`),
        'DELETE provider'
      );

      // The row survived every probe, unrenamed.
      const stillOwned = await json<DataEnvelope<Array<{ id: string; displayName: string }>>>(
        await asB('GET', '/api/v1/providers')
      );
      expect(stillOwned.data.find((p) => p.id === providerId)?.displayName).toBe('B Bucket');
    });

    // Uses sourceType 'sheets' and mode 'preview'. The 'zip' variant would fail on schema before the ownership check.
    // The route is idempotency-gated, so the request is built by hand with the header.
    test("sync: A cannot restore from B's storage provider", async () => {
      const seedProvider = (id: string, userId: string): void => {
        ctx.sqlite.run(
          `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
           VALUES (?, ?, 'storage', 's3', 'Bucket', '', ?, 'active')`,
          [
            id,
            userId,
            JSON.stringify({
              endpoint: 'https://s3.example.com',
              bucket: 'a-bucket',
              region: 'us-east-1',
            }),
          ]
        );
      };
      const restoreAsA = async (providerId: string, key: string): Promise<Response> =>
        ctx.app.request('/api/v1/sync/restore/from-provider', {
          method: 'POST',
          headers: {
            Cookie: ctx.cookie,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
            'Sec-Fetch-Site': 'same-origin',
          },
          body: JSON.stringify({ sourceType: 'sheets', providerId, mode: 'preview' }),
        });

      const bProvider = `idor-restore-b-${bId}`;
      const aProvider = `idor-restore-a-${bId}`;
      seedProvider(bProvider, bId);
      seedProvider(aProvider, ctx.user.id);

      const denied = await restoreAsA(bProvider, `idor-restore-b-${bId}`);
      expectDenied(denied, "restore from B's provider");
      const deniedBody = (await denied.json()) as { error?: { message?: string } };
      expect(deniedBody.error?.message).toContain('Provider not found');

      // Positive control: A's own identical row passes the ownership check, so the denial above is not a schema or idempotency failure.
      const ownRes = await restoreAsA(aProvider, `idor-restore-a-${bId}`);
      const ownBody = (await ownRes.json()) as { error?: { message?: string } };
      expect(
        ownBody.error?.message ?? '',
        "A's own provider must get past the ownership gate"
      ).not.toContain('Provider not found');
    });
  });

  describe('shares', () => {
    // Share management is owner-only. A may not invite to B's vehicle, nor change or revoke a grant B made.
    test("shares: A cannot invite to B's vehicle, nor manage a share B granted", async () => {
      const vid = await idOf(
        await asB('POST', '/api/v1/vehicles', { make: 'B', model: 'Car', year: 2022 })
      );

      // A cannot invite to B's vehicle. The response is a 404, not a 403.
      expectDenied(
        await ctx.authed('POST', '/api/v1/shares', {
          vehicleId: vid,
          email: 'whoever@test.com',
          level: 'viewer',
        }),
        'POST share to B vehicle'
      );

      // B shares the vehicle with A, so a real grant exists with B as owner.
      const shareRes = await asB('POST', '/api/v1/shares', {
        vehicleId: vid,
        email: ctx.user.email,
        level: 'viewer',
      });
      const shareId = await idOf(shareRes);

      // A is the invitee, so the owner-side endpoints must return 404 for A.
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

    // Accept and decline are invitee-only. The owner of the invite gets the same 404 as a stranger.
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

    // The received list joins vehicle and owner data. It must stay scoped to the acting invitee.
    test('shares: /received is scoped to the acting invitee even with the vehicle and owner join', async () => {
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
      expect(aRecv.data[0].sharedWithId).toBe(ctx.user.id);
      expect(aRecv.data[0].vehicleName).toBe('2023 Subaru Outback');

      // B is the owner, not an invitee, so the join must not pull B's own grant in.
      const bRecv = await json<DataEnvelope<unknown[]>>(
        await asB('GET', '/api/v1/shares/received')
      );
      expect(bRecv.data.length).toBe(0);
    });
  });
});
