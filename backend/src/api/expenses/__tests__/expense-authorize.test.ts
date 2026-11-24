import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '../../../db/connection';
import { builtInRoleId, grantShareRole } from '../../../permissions/grants';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
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

function seedMember(member: Invitee, level: 'viewer' | 'editor'): void {
  ctx.sqlite.run(
    "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, invited_email) VALUES (?, ?, ?, ?, ?, 'accepted', ?)",
    [`share-${member.id}`, vehicleId, ctx.user.id, member.id, level, member.email]
  );
  grantShareRole(getDb(), { vehicleId, sharedWithId: member.id, level, grantedBy: ctx.user.id });
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
    seedMember(member, level);
  }
  ctx.sqlite.run(
    'INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES (?, ?, ?, ?, ?)',
    ['ra-co', coOwner.id, builtInRoleId('co_owner'), vehicleId, ctx.user.id]
  );
  ctx.sqlite.run('UPDATE users SET disabled_at = 1 WHERE id = ?', [disabled.id]);
  insertExpense('owners-row', ctx.user.id, vehicleId);
  insertExpense('editors-row', ctx.user.id, vehicleId, { createdBy: editor.id });
  insertExpense('loan-row', ctx.user.id, vehicleId, { sourceType: 'financing' });
});

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
