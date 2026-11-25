import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { unpackRules } from '@casl/ability/extra';
import { CONFIG } from '../../../config';
import { getDb } from '../../../db/connection';
import {
  assignServerRole,
  builtInRoleId,
  grantShareRole,
  syncBuiltInRoles,
} from '../../../permissions/grants';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

interface Person {
  userId: string;
  owner: boolean;
  roles: { key: string | null }[];
  overrides: { permission: string; effect: string }[];
  permissions: { permission: string; via: string }[];
}

let ctx: TestApp;
let vehicleId: string;
let coOwner: Invitee;
let editor: Invitee;
let viewer: Invitee;
let stranger: Invitee;
let disabled: Invitee;

const CO_OWNER = builtInRoleId('co_owner');
const asOwner: RequestFn = (method, path, body) => ctx.authed(method, path, body);

function count(table: string, userId: string): number {
  return (
    ctx.sqlite
      .query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND scope_id = ?`)
      .get(userId, vehicleId) as { n: number }
  ).n;
}

async function people(request: RequestFn): Promise<Person[]> {
  const res = await request('GET', `/api/v1/vehicles/${vehicleId}/people`);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<Person[]>>(res)).data;
}

const override = (userId: string, permission: string, effect: 'allow' | 'deny') => ({
  userId,
  scope: 'vehicle',
  scopeId: vehicleId,
  permission,
  effect,
});

function shareIdOf(userId: string): string {
  return (
    ctx.sqlite.query('SELECT id FROM vehicle_shares WHERE shared_with_id = ?').get(userId) as {
      id: string;
    }
  ).id;
}

function seedMember(member: Invitee, level: 'viewer' | 'editor'): void {
  ctx.sqlite.run(
    "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, invited_email) VALUES (?, ?, ?, ?, ?, 'accepted', ?)",
    [`share-${member.id}`, vehicleId, ctx.user.id, member.id, level, member.email]
  );
  grantShareRole(getDb(), {
    vehicleId,
    sharedWithId: member.id,
    level,
    grantedBy: ctx.user.id,
  });
}

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = `roles-car-${crypto.randomUUID()}`;
  ctx.sqlite.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Toyota', 'Camry', 2022)",
    [vehicleId, ctx.user.id]
  );
  coOwner = await createInvitee(ctx, 'co-owner');
  editor = await createInvitee(ctx, 'editor');
  viewer = await createInvitee(ctx, 'viewer');
  stranger = await createInvitee(ctx, 'stranger');
  disabled = await createInvitee(ctx, 'disabled');
  seedMember(coOwner, 'viewer');
  seedMember(editor, 'editor');
  seedMember(viewer, 'viewer');
  seedMember(disabled, 'editor');
  ctx.sqlite.run('UPDATE users SET disabled_at = 1 WHERE id = ?', [disabled.id]);
  ctx.sqlite.run(
    'INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES (?, ?, ?, ?, ?)',
    [`ra-${coOwner.id}`, coOwner.id, CO_OWNER, vehicleId, ctx.user.id]
  );
});

afterEach(() => ctx.close());

describe('GET /api/v1/vehicles/:id/people', () => {
  test('lists every member with roles and the source of each permission', async () => {
    const list = await people(asOwner);
    expect(list.find((p) => p.owner)?.userId).toBe(ctx.user.id);
    const editorRow = list.find((p) => p.userId === editor.id);
    expect(editorRow?.roles.map((r) => r.key)).toEqual(['editor']);
    expect(editorRow?.permissions).toContainEqual(
      expect.objectContaining({ permission: 'vehicle.expense.write', via: 'role' })
    );
    expect(
      list
        .find((p) => p.userId === coOwner.id)
        ?.roles.map((r) => r.key)
        .sort()
    ).toEqual(['co_owner', 'viewer']);
    expect((await people(viewer.request)).length).toBe(list.length);
  });

  test('members without share.manage see only names and role names', async () => {
    const res = await viewer.request('GET', `/api/v1/vehicles/${vehicleId}/people`);
    const list = (await json<DataEnvelope<Record<string, unknown>[]>>(res)).data;
    expect(list.length).toBeGreaterThan(1);
    for (const person of list) {
      expect(Object.keys(person).sort()).toEqual(['displayName', 'owner', 'roles']);
    }
    const detailed = await people(coOwner.request);
    expect(detailed.find((p) => p.userId === editor.id)?.permissions.length).toBeGreaterThan(0);
  });

  test('a stranger gets 404 and a disabled member 403', async () => {
    const path = `/api/v1/vehicles/${vehicleId}/people`;
    expect((await stranger.request('GET', path)).status).toBe(404);
    expect((await disabled.request('GET', path)).status).toBe(403);
  });
});

describe('role assignments', () => {
  const assign = (request: RequestFn, userId: string, roleId: string, scopeId = vehicleId) =>
    request('POST', '/api/v1/role-assignments', { userId, roleId, scopeId });

  test('the owner and a co-owner assign; an editor, viewer, stranger or disabled user cannot', async () => {
    expect((await assign(coOwner.request, viewer.id, builtInRoleId('editor'))).status).toBe(201);
    expect((await assign(editor.request, viewer.id, CO_OWNER)).status).toBe(403);
    expect((await assign(viewer.request, editor.id, CO_OWNER)).status).toBe(403);
    expect((await assign(stranger.request, editor.id, CO_OWNER)).status).toBe(404);
    expect((await assign(disabled.request, editor.id, CO_OWNER)).status).toBe(403);
  });

  test('the owner is not a member to assign, and a held role conflicts', async () => {
    expect((await assign(coOwner.request, ctx.user.id, CO_OWNER)).status).toBe(404);
    expect((await assign(asOwner, coOwner.id, CO_OWNER)).status).toBe(409);
  });

  test('only roles whose permissions the assigner holds can be assigned', async () => {
    await asOwner('PUT', '/api/v1/overrides', override(editor.id, 'vehicle.share.manage', 'allow'));
    expect((await assign(editor.request, viewer.id, builtInRoleId('editor'))).status).toBe(201);
    expect((await assign(editor.request, viewer.id, CO_OWNER)).status).toBe(403);
  });

  test('a custom vehicle role is assignable only on its library owner’s cars', async () => {
    const created = await asOwner('POST', '/api/v1/roles', {
      scope: 'vehicle',
      name: 'Driver',
      permissions: ['vehicle.trip.write'],
    });
    const roleId = (await json<DataEnvelope<{ id: string }>>(created)).data.id;
    expect((await assign(coOwner.request, viewer.id, roleId)).status).toBe(201);
    const otherCar = await seedVehicle(
      { ...ctx, authed: stranger.request },
      { nickname: 'Not yours' }
    );
    await stranger.request('POST', '/api/v1/shares', {
      vehicleId: otherCar,
      email: viewer.email,
      level: 'viewer',
    });
    const invite = ctx.sqlite
      .query('SELECT id FROM vehicle_shares WHERE vehicle_id = ?')
      .get(otherCar) as { id: string };
    await viewer.request('POST', `/api/v1/shares/${invite.id}/accept`);
    expect((await assign(stranger.request, viewer.id, roleId, otherCar)).status).toBe(404);
  });

  test('removing an assignment takes its permissions away', async () => {
    const query = `userId=${coOwner.id}&roleId=${CO_OWNER}&scopeId=${vehicleId}`;
    expect((await editor.request('DELETE', `/api/v1/role-assignments?${query}`)).status).toBe(403);
    expect((await asOwner('DELETE', `/api/v1/role-assignments?${query}`)).status).toBe(200);
    const row = (await people(asOwner)).find((p) => p.userId === coOwner.id);
    expect(row?.permissions.map((p) => p.permission)).not.toContain('vehicle.financing.read');
  });
});

describe('overrides', () => {
  test('a deny override takes write away from an editor; removing it gives it back', async () => {
    const put = await asOwner(
      'PUT',
      '/api/v1/overrides',
      override(editor.id, 'vehicle.expense.read', 'deny')
    );
    expect(put.status).toBe(200);
    const denied = (await people(asOwner)).find((p) => p.userId === editor.id);
    expect(denied?.permissions.map((p) => p.permission)).not.toContain('vehicle.expense.write');
    const query = `userId=${editor.id}&scope=vehicle&scopeId=${vehicleId}&permission=vehicle.expense.read`;
    expect((await asOwner('DELETE', `/api/v1/overrides?${query}`)).status).toBe(200);
    const restored = (await people(asOwner)).find((p) => p.userId === editor.id);
    expect(restored?.permissions.map((p) => p.permission)).toContain('vehicle.expense.write');
  });

  test('a co-owner can allow what they hold; an editor with share.manage cannot', async () => {
    const allowLoan = (request: RequestFn) =>
      request('PUT', '/api/v1/overrides', override(viewer.id, 'vehicle.financing.read', 'allow'));
    expect((await allowLoan(coOwner.request)).status).toBe(200);
    expect((await allowLoan(editor.request)).status).toBe(403);
    await asOwner('PUT', '/api/v1/overrides', override(editor.id, 'vehicle.share.manage', 'allow'));
    expect((await allowLoan(editor.request)).status).toBe(403);
    expect((await allowLoan(stranger.request)).status).toBe(404);
  });

  test('a co-owner cannot change or delete what the owner set; the owner still can', async () => {
    const path = `/api/v1/overrides?userId=${editor.id}&scope=vehicle&scopeId=${vehicleId}&permission=vehicle.trip.read`;
    const set = (request: RequestFn, effect: 'allow' | 'deny') =>
      request('PUT', '/api/v1/overrides', override(editor.id, 'vehicle.trip.read', effect));
    expect((await set(asOwner, 'deny')).status).toBe(200);
    expect((await set(coOwner.request, 'allow')).status).toBe(403);
    expect((await coOwner.request('DELETE', path)).status).toBe(403);
    expect((await set(asOwner, 'allow')).status).toBe(200);
    expect((await asOwner('DELETE', path)).status).toBe(200);
    expect((await set(coOwner.request, 'deny')).status).toBe(200);
    expect((await set(coOwner.request, 'allow')).status).toBe(200);
    expect((await coOwner.request('DELETE', path)).status).toBe(200);
  });

  test('a co-owner cannot remove a role the owner granted', async () => {
    const query = `userId=${editor.id}&roleId=${builtInRoleId('editor')}&scopeId=${vehicleId}`;
    expect((await coOwner.request('DELETE', `/api/v1/role-assignments?${query}`)).status).toBe(403);
    expect(count('role_assignments', editor.id)).toBe(1);
  });

  test('non-grantable permissions, other scopes and the owner are refused', async () => {
    const put = (body: unknown) => asOwner('PUT', '/api/v1/overrides', body);
    expect((await put(override(editor.id, 'vehicle.delete', 'allow'))).status).toBe(400);
    expect((await put(override(editor.id, 'account.delete', 'deny'))).status).toBe(400);
    expect((await put(override(ctx.user.id, 'vehicle.read', 'deny'))).status).toBe(404);
    expect((await put(override(stranger.id, 'vehicle.read', 'allow'))).status).toBe(404);
  });

  test('a member who leaves or is revoked loses their roles and overrides', async () => {
    await asOwner('PUT', '/api/v1/overrides', override(editor.id, 'vehicle.trip.read', 'deny'));
    await asOwner('PUT', '/api/v1/overrides', override(viewer.id, 'vehicle.trip.read', 'deny'));
    expect(
      (await editor.request('POST', `/api/v1/shares/${shareIdOf(editor.id)}/decline`)).status
    ).toBe(200);
    expect((await asOwner('DELETE', `/api/v1/shares/${shareIdOf(viewer.id)}`)).status).toBe(200);
    for (const member of [editor, viewer]) {
      expect(count('role_assignments', member.id)).toBe(0);
      expect(count('permission_overrides', member.id)).toBe(0);
    }
  });

  test('a full restore is refused while the vehicles carry per-person changes', async () => {
    await asOwner('PUT', '/api/v1/overrides', override(editor.id, 'vehicle.trip.read', 'deny'));
    const { backupService } = await import('../../sync/backup');
    const { restoreService } = await import('../../sync/restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    await expect(restoreService.restoreFromBackup(ctx.user.id, zip, 'replace')).rejects.toThrow(
      'full restore would remove them'
    );
    expect(count('permission_overrides', editor.id)).toBe(1);
  });
});

describe('vehicle roles: the owner’s own library', () => {
  const create = (request: RequestFn, body: Record<string, unknown>) =>
    request('POST', '/api/v1/roles', { scope: 'vehicle', name: 'Driver', ...body });

  test('an owner creates, renames, assigns and deletes a custom role', async () => {
    const res = await create(asOwner, { permissions: ['vehicle.trip.write'] });
    expect(res.status).toBe(201);
    const role = (await json<DataEnvelope<{ id: string; key: string | null }>>(res)).data;
    expect(role.key).toBeNull();
    const patch = await asOwner('PATCH', `/api/v1/roles/${role.id}`, { name: 'Weekend driver' });
    expect(patch.status).toBe(200);
    const assign = await asOwner('POST', '/api/v1/role-assignments', {
      userId: viewer.id,
      roleId: role.id,
      scopeId: vehicleId,
    });
    expect(assign.status).toBe(201);
    expect((await stranger.request('GET', `/api/v1/roles/${role.id}/permissions`)).status).toBe(
      404
    );
    expect((await asOwner('DELETE', `/api/v1/roles/${role.id}`)).status).toBe(200);
    expect(count('role_assignments', viewer.id)).toBe(1);
  });

  test('built-in roles can be duplicated but not changed or deleted', async () => {
    const copy = await create(asOwner, { copyFrom: builtInRoleId('editor') });
    expect(copy.status).toBe(201);
    const body = await json<DataEnvelope<{ permissions: string[] }>>(copy);
    expect(body.data.permissions).toContain('vehicle.expense.delete_own');
    const editorRole = `/api/v1/roles/${builtInRoleId('editor')}`;
    expect((await asOwner('PATCH', editorRole, { name: 'Mine' })).status).toBe(403);
    expect((await asOwner('PUT', `${editorRole}/permissions`, { permissions: [] })).status).toBe(
      403
    );
    expect((await asOwner('DELETE', editorRole)).status).toBe(403);
  });

  test('registry validation, reserved keys, fixed scope and disabled users', async () => {
    expect((await create(asOwner, { permissions: ['vehicle.delete'] })).status).toBe(400);
    expect((await create(asOwner, { permissions: ['account.delete'] })).status).toBe(400);
    expect((await create(asOwner, { permissions: ['vehicle.nope.read'] })).status).toBe(400);
    expect((await create(asOwner, { key: 'editor' })).status).toBe(400);
    const role = (await json<DataEnvelope<{ id: string }>>(await create(asOwner, {}))).data;
    expect((await asOwner('PATCH', `/api/v1/roles/${role.id}`, { scope: 'server' })).status).toBe(
      400
    );
    expect((await asOwner('PATCH', `/api/v1/roles/${role.id}`, { key: 'demo' })).status).toBe(400);
    expect((await create(disabled.request, {})).status).toBe(403);
  });

  test('the boot sync survives a custom role holding a built-in key', async () => {
    const role = (await json<DataEnvelope<{ id: string }>>(await create(asOwner, {}))).data;
    ctx.sqlite.run('DELETE FROM roles WHERE id = ?', [CO_OWNER]);
    ctx.sqlite.run("UPDATE roles SET key = 'co_owner' WHERE id = ?", [role.id]);
    expect(() => syncBuiltInRoles(getDb())).not.toThrow();
    expect(ctx.sqlite.query('SELECT key FROM roles WHERE id = ?').get(CO_OWNER)).toEqual({
      key: 'co_owner',
    });
    expect(ctx.sqlite.query('SELECT key FROM roles WHERE id = ?').get(role.id)).toEqual({
      key: null,
    });
  });
});

describe('server roles', () => {
  let admin: RequestFn;

  beforeEach(() => {
    assignServerRole(getDb(), editor.id, 'admin');
    admin = editor.request;
  });

  test('need server.roles.manage, and refuse vehicle permissions', async () => {
    expect((await asOwner('GET', '/api/v1/roles?scope=server')).status).toBe(403);
    expect((await admin('GET', '/api/v1/roles?scope=server')).status).toBe(200);
    const create = (permissions: string[]) =>
      admin('POST', '/api/v1/roles', { scope: 'server', name: 'Support', permissions });
    expect((await create(['vehicle.read'])).status).toBe(400);
    expect((await create(['server.users.read'])).status).toBe(201);
    const demoCopy = await admin('POST', '/api/v1/roles', {
      scope: 'server',
      name: 'Fake demo',
      copyFrom: builtInRoleId('demo'),
    });
    expect(demoCopy.status).toBe(400);
  });

  test('the last holder of server.roles.manage cannot lose it', async () => {
    const query = `userId=${editor.id}&roleId=${builtInRoleId('admin')}`;
    expect((await admin('DELETE', `/api/v1/role-assignments?${query}`)).status).toBe(409);
    const deny = { userId: editor.id, scope: 'server', permission: 'server.roles.manage' };
    expect((await admin('PUT', '/api/v1/overrides', { ...deny, effect: 'deny' })).status).toBe(409);
    const second = await admin('POST', '/api/v1/role-assignments', {
      userId: ctx.user.id,
      roleId: builtInRoleId('admin'),
    });
    expect(second.status).toBe(201);
    expect((await admin('DELETE', `/api/v1/role-assignments?${query}`)).status).toBe(200);
  });

  test('members cannot assign server roles', async () => {
    const res = await asOwner('POST', '/api/v1/role-assignments', {
      userId: viewer.id,
      roleId: builtInRoleId('admin'),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/auth/capabilities rules', () => {
  const actions = async (request: RequestFn) => {
    const res = await request('GET', '/api/v1/auth/capabilities');
    const body = await json<DataEnvelope<{ rules: [string, string][] }>>(res);
    return unpackRules(body.data.rules).flatMap((rule) => [rule.action].flat());
  };

  test('a member gets their server and account rules; a disabled user gets none', async () => {
    const member = await actions(asOwner);
    expect(member).toContain('account.profile.write');
    expect(member).not.toContain('server.roles.manage');
    expect(await actions(disabled.request)).toEqual([]);
  });
});

describe('CORS', () => {
  test('a cross-origin preflight for PATCH is allowed', async () => {
    const origin = CONFIG.cors.origins[0] ?? 'http://localhost:5173';
    const res = await ctx.app.request(`/api/v1/roles/any`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
  });
});
