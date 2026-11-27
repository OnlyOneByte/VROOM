import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appContext } from '../../../app-context';
import { builtInRoleId, grantShareRole } from '../../../permissions/grants';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';

let ctx: TestApp;
let vehicleId: string;
let coOwner: Invitee;
let editor: Invitee;
let viewer: Invitee;
let stranger: Invitee;
let disabled: Invitee;

function insertExpense(
  id: string,
  owner: string,
  vehicle: string,
  {
    createdBy = null,
    sourceType = null,
  }: { createdBy?: string | null; sourceType?: string | null } = {}
): void {
  ctx.sqlite.run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, created_by, source_type, source_id) VALUES (?, ?, ?, 'maintenance', 1717200000, 2500, ?, ?, ?)",
    [id, vehicle, owner, createdBy, sourceType, sourceType ? 'loan-1' : null]
  );
}

async function seedMember(member: Invitee, level: 'viewer' | 'editor'): Promise<void> {
  ctx.sqlite.run(
    "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, invited_email) VALUES (?, ?, ?, ?, ?, 'accepted', ?)",
    [`share-${member.id}`, vehicleId, ctx.user.id, member.id, level, member.email]
  );
  await grantShareRole(appContext().asyncDb, {
    vehicleId,
    sharedWithId: member.id,
    level,
    grantedBy: ctx.user.id,
  });
}

function override(member: Invitee, permission: string, effect: 'allow' | 'deny'): void {
  ctx.sqlite.run(
    "INSERT INTO permission_overrides (id, user_id, scope, scope_id, permission, effect) VALUES (?, ?, 'vehicle', ?, ?, ?)",
    [`po-${member.id}-${permission}`, member.id, vehicleId, permission, effect]
  );
}

async function listIds(request: RequestFn, query = `?vehicleId=${vehicleId}`) {
  const res = await request('GET', `/api/v1/expenses${query}`);
  return {
    status: res.status,
    ids: res.ok
      ? (await json<DataEnvelope<{ id: string }[]>>(res)).data.map((e) => e.id).sort()
      : [],
  };
}

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = `exp-car-${crypto.randomUUID()}`;
  ctx.sqlite.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Toyota', 'Camry', 2022)",
    [vehicleId, ctx.user.id]
  );
  coOwner = await createInvitee(ctx, 'exp-co-owner');
  editor = await createInvitee(ctx, 'exp-editor');
  viewer = await createInvitee(ctx, 'exp-viewer');
  stranger = await createInvitee(ctx, 'exp-stranger');
  disabled = await createInvitee(ctx, 'exp-disabled');
  for (const [member, level] of [
    [coOwner, 'viewer'],
    [editor, 'editor'],
    [viewer, 'viewer'],
    [disabled, 'editor'],
  ] as const) {
    await seedMember(member, level);
  }
  ctx.sqlite.run(
    'INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES (?, ?, ?, ?, ?)',
    ['ra-co', coOwner.id, builtInRoleId('co_owner'), vehicleId, ctx.user.id]
  );
  ctx.sqlite.run('UPDATE users SET disabled_at = 1 WHERE id = ?', [disabled.id]);
  insertExpense('owners-row', ctx.user.id, vehicleId);
  insertExpense('editors-row', ctx.user.id, vehicleId, { createdBy: editor.id });
  insertExpense('loan-row', ctx.user.id, vehicleId, { sourceType: 'financing' });
}, SETUP_TIMEOUT_MS);

afterEach(() => ctx.close());

describe('expenses resolve through can() for every role', () => {
  test('reads: members see the car, financials only with the permission, strangers nothing', async () => {
    const all = ['editors-row', 'loan-row', 'owners-row'];
    const plain = ['editors-row', 'owners-row'];
    expect(await listIds(ctx.authed)).toEqual({ status: 200, ids: all });
    expect(await listIds(coOwner.request)).toEqual({ status: 200, ids: all });
    expect(await listIds(editor.request)).toEqual({ status: 200, ids: plain });
    expect(await listIds(viewer.request)).toEqual({ status: 200, ids: plain });
    expect((await listIds(stranger.request)).status).toBe(404);
    expect((await listIds(disabled.request)).status).toBe(403);
    expect((await coOwner.request('GET', '/api/v1/expenses/loan-row')).status).toBe(200);
    expect((await viewer.request('GET', '/api/v1/expenses/loan-row')).status).toBe(404);
  });

  test('an allow override shows an editor the financials; a deny override hides the car', async () => {
    override(editor, 'vehicle.financing.read', 'allow');
    override(editor, 'vehicle.insurance.read', 'allow');
    override(viewer, 'vehicle.expense.read', 'deny');
    expect((await listIds(editor.request)).ids).toContain('loan-row');
    expect((await listIds(viewer.request)).status).toBe(403);
    expect((await viewer.request('GET', '/api/v1/expenses/owners-row')).status).toBe(403);
  });

  test('deletes: the owner and co-owner delete any entry, an editor only their own', async () => {
    expect((await editor.request('DELETE', '/api/v1/expenses/owners-row')).status).toBe(403);
    expect((await editor.request('DELETE', '/api/v1/expenses/editors-row')).status).toBe(200);
    expect((await coOwner.request('DELETE', '/api/v1/expenses/owners-row')).status).toBe(200);
    expect((await viewer.request('DELETE', '/api/v1/expenses/loan-row')).status).toBe(403);
    expect((await stranger.request('DELETE', '/api/v1/expenses/loan-row')).status).toBe(404);
    expect((await ctx.authed('DELETE', '/api/v1/expenses/loan-row')).status).toBe(200);
  });

  test('a co-owner may record a loan payment; an editor may not', async () => {
    const payment = {
      vehicleId,
      category: 'financial',
      expenseAmount: 10,
      date: '2024-03-01T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: 'loan-1',
    };
    expect((await editor.request('POST', '/api/v1/expenses', payment)).status).toBe(404);
    const coOwners = await coOwner.request('POST', '/api/v1/expenses', payment);
    expect(coOwners.status).not.toBe(403);
    expect(coOwners.status).not.toBe(404);
  });
});

describe('split updates cannot delete legs the caller may not delete', () => {
  const cars = ['split-a', 'split-b', 'split-c'];
  const splitBody = (vehicleIds: string[]) => ({
    splitConfig: { method: 'even', vehicleIds },
    totalAmount: 90,
  });
  const legs = (groupId: string) =>
    ctx.sqlite
      .query('SELECT vehicle_id, created_by FROM expenses WHERE group_id = ? ORDER BY vehicle_id')
      .all(groupId) as { vehicle_id: string; created_by: string | null }[];

  beforeEach(async () => {
    for (const car of cars) {
      ctx.sqlite.run(
        "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Mazda', 'CX-5', 2021)",
        [car, ctx.user.id]
      );
      ctx.sqlite.run(
        "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status) VALUES (?, ?, ?, ?, 'editor', 'accepted')",
        [`share-${car}`, car, ctx.user.id, editor.id]
      );
      await grantShareRole(appContext().asyncDb, {
        vehicleId: car,
        sharedWithId: editor.id,
        level: 'editor',
        grantedBy: ctx.user.id,
      });
    }
  });

  async function createSplit(request: RequestFn, vehicleIds: string[]): Promise<string> {
    const res = await request('POST', '/api/v1/expenses/split', {
      ...splitBody(vehicleIds),
      category: 'misc',
      date: '2024-06-06T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
    return (await json<DataEnvelope<{ groupId: string }>>(res)).data.groupId;
  }

  test("an editor can't shrink, regrow-and-shrink or delete the owner's split", async () => {
    const groupId = await createSplit(ctx.authed, ['split-a', 'split-b']);
    const put = (vehicleIds: string[]) =>
      editor.request('PUT', `/api/v1/expenses/split/${groupId}`, splitBody(vehicleIds));

    expect((await put(['split-a'])).status).toBe(403);
    expect((await put(['split-a', 'split-b', 'split-c'])).status).toBe(200);
    expect(legs(groupId).map((leg) => leg.created_by)).toEqual([null, null, null]);
    expect((await put(['split-c'])).status).toBe(403);
    expect((await editor.request('DELETE', `/api/v1/expenses/split/${groupId}`)).status).toBe(403);
    expect(legs(groupId).map((leg) => leg.vehicle_id)).toEqual(['split-a', 'split-b', 'split-c']);
  });

  test('an editor shrinks and deletes their own split, but not one with legs by someone else', async () => {
    const mine = await createSplit(editor.request, ['split-a', 'split-b']);
    const path = `/api/v1/expenses/split/${mine}`;
    expect((await editor.request('PUT', path, splitBody(['split-a']))).status).toBe(200);
    const mixed = await createSplit(editor.request, ['split-b', 'split-c']);
    ctx.sqlite.run(
      "UPDATE expenses SET created_by = NULL WHERE group_id = ? AND vehicle_id = 'split-c'",
      [mixed]
    );
    expect((await editor.request('DELETE', `/api/v1/expenses/split/${mixed}`)).status).toBe(403);
    expect((await editor.request('DELETE', path)).status).toBe(200);
  });
});

describe('expenses never cross accounts', () => {
  test("another person's own expenses stay out of lists, exports and lookups", async () => {
    const theirCar = `exp-their-car-${crypto.randomUUID()}`;
    ctx.sqlite.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Honda', 'Civic', 2020)",
      [theirCar, stranger.id]
    );
    insertExpense('their-row', stranger.id, theirCar);
    const mine = await listIds(ctx.authed, '');
    expect(mine.status).toBe(200);
    expect(mine.ids).not.toContain('their-row');
    const exported = await (await ctx.authed('GET', '/api/v1/expenses/export')).text();
    expect(exported).not.toContain('Civic');
    expect((await ctx.authed('GET', '/api/v1/expenses/their-row')).status).toBe(404);
    expect((await listIds(ctx.authed, `?vehicleId=${theirCar}`)).status).toBe(404);
    expect((await listIds(stranger.request, '')).ids).toEqual(['their-row']);
  });
});
