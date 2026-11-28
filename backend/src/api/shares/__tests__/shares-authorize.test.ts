import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { builtInRoleId } from '../../../permissions/grants';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import {
  type Members,
  overrideOn,
  seedCar,
  seedMembers,
  shareCar,
} from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'sh-car';

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'sh');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const invite = (request: RequestFn, email: string) =>
  request('POST', '/api/v1/shares', { vehicleId: CAR, email, level: 'viewer' });

const editorShare = () => `/api/v1/shares/share-${CAR}-${m.editor.id}`;

describe('share management resolves through can() for every role', () => {
  test('a co-owner invites on the owner’s behalf; editors and viewers cannot', async () => {
    const res = await invite(m.coOwner.request, 'friend@example.com');
    expect(res.status).toBe(201);
    const granted = await json<DataEnvelope<{ invitedEmail: string }[]>>(
      await ctx.authed('GET', '/api/v1/shares/granted')
    );
    expect(granted.data.map((s) => s.invitedEmail)).toContain('friend@example.com');

    expect((await invite(m.editor.request, 'a@example.com')).status).toBe(403);
    expect((await invite(m.viewer.request, 'b@example.com')).status).toBe(403);
    expect((await invite(m.disabled.request, 'c@example.com')).status).toBe(403);
    expect((await invite(m.stranger.request, 'd@example.com')).status).toBe(404);
  });

  test('nobody can invite the owner to their own car', async () => {
    expect((await invite(m.coOwner.request, ctx.user.email)).status).toBe(400);
  });

  test('a co-owner changes and revokes access; editors cannot', async () => {
    expect((await m.editor.request('PUT', editorShare(), { level: 'viewer' })).status).toBe(403);
    expect((await m.viewer.request('DELETE', editorShare())).status).toBe(403);
    expect((await m.stranger.request('DELETE', editorShare())).status).toBe(404);
    expect((await m.coOwner.request('PUT', editorShare(), { level: 'viewer' })).status).toBe(200);
    expect((await m.coOwner.request('DELETE', editorShare())).status).toBe(200);
  });

  test('overrides on vehicle.share.manage take effect', async () => {
    await overrideOn(ctx, CAR, m.coOwner, 'vehicle.share.manage', 'deny');
    expect((await invite(m.coOwner.request, 'e@example.com')).status).toBe(403);
    expect((await m.coOwner.request('DELETE', editorShare())).status).toBe(403);
    await overrideOn(ctx, CAR, m.editor, 'vehicle.share.manage', 'allow');
    expect((await invite(m.editor.request, 'f@example.com')).status).toBe(201);
  });

  test('a disabled account cannot list or answer its invitations', async () => {
    expect((await m.disabled.request('GET', '/api/v1/shares/received')).status).toBe(403);
    expect((await m.stranger.request('GET', '/api/v1/shares/received')).status).toBe(200);
  });
});

describe('share management cannot be used to escalate', () => {
  const shareOf = (member: { id: string }) => `/api/v1/shares/share-${CAR}-${member.id}`;
  const grantedBy = async (userId: string) =>
    (
      (await ctx.sql.all(
        'SELECT granted_by FROM role_assignments WHERE user_id = ? AND scope_id = ?',
        [userId, CAR]
      )) as { granted_by: string }[]
    ).map((row) => row.granted_by);

  test('a manager grants only what they hold and never changes their own share', async () => {
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.share.manage', 'allow');
    expect((await m.viewer.request('PUT', shareOf(m.viewer), { level: 'editor' })).status).toBe(
      403
    );
    const asEditor = await m.viewer.request('POST', '/api/v1/shares', {
      vehicleId: CAR,
      email: 'g@example.com',
      level: 'editor',
    });
    expect(asEditor.status).toBe(403);
    expect((await invite(m.viewer.request, 'h@example.com')).status).toBe(201);
  });

  test('a manager cannot change their own share even to a level they hold', async () => {
    const res = await m.coOwner.request('PUT', shareOf(m.coOwner), { level: 'viewer' });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("You can't change your own access");
  });

  test('an owner-set deny limits what a co-owner can hand out', async () => {
    await overrideOn(ctx, CAR, m.coOwner, 'vehicle.expense.write', 'deny');
    const asEditor = await m.coOwner.request('POST', '/api/v1/shares', {
      vehicleId: CAR,
      email: 'i@example.com',
      level: 'editor',
    });
    expect(asEditor.status).toBe(403);
    expect((await m.coOwner.request('PUT', editorShare(), { level: 'editor' })).status).toBe(403);
  });

  test('only the owner removes or changes a co-owner the owner appointed', async () => {
    const other = await createInvitee(ctx, 'sh-co-owner-2');
    await shareCar(ctx, CAR, other, 'viewer');
    await ctx.sql.run(
      'INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES (?, ?, ?, ?, ?)',
      [`ra-${other.id}`, other.id, builtInRoleId('co_owner'), CAR, ctx.user.id]
    );
    expect((await m.coOwner.request('DELETE', shareOf(other))).status).toBe(403);
    expect((await m.coOwner.request('PUT', shareOf(other), { level: 'editor' })).status).toBe(403);
    expect((await ctx.authed('DELETE', shareOf(other))).status).toBe(200);
  });

  test('a manager only changes or removes people whose access they hold themselves', async () => {
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.share.manage', 'allow');
    expect((await m.viewer.request('PUT', editorShare(), { level: 'viewer' })).status).toBe(403);
    expect((await m.viewer.request('DELETE', editorShare())).status).toBe(403);

    const appointed = await createInvitee(ctx, 'sh-co-owner-3');
    await shareCar(ctx, CAR, appointed, 'viewer');
    await ctx.sql.run(
      'INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES (?, ?, ?, ?, ?)',
      [`ra-${appointed.id}`, appointed.id, builtInRoleId('co_owner'), CAR, m.coOwner.id]
    );
    await overrideOn(ctx, CAR, m.editor, 'vehicle.share.manage', 'allow');
    expect((await m.editor.request('DELETE', shareOf(appointed))).status).toBe(403);
    expect((await m.coOwner.request('DELETE', shareOf(appointed))).status).toBe(200);
  });

  test('revoking someone needs the rank to remove their overrides', async () => {
    const setOverride = async (by: string, permission: string) =>
      await ctx.sql.run(
        "INSERT INTO permission_overrides (id, user_id, scope, scope_id, permission, effect, set_by) VALUES (?, ?, 'vehicle', ?, ?, 'allow', ?)",
        [`po-${by}-${permission}`, m.viewer.id, CAR, permission, by]
      );
    await setOverride(ctx.user.id, 'vehicle.financing.read');
    expect((await m.coOwner.request('DELETE', shareOf(m.viewer))).status).toBe(403);

    await ctx.sql.run('DELETE FROM permission_overrides WHERE user_id = ?', [m.viewer.id]);
    await setOverride(m.coOwner.id, 'vehicle.insurance.read');
    await overrideOn(ctx, CAR, m.editor, 'vehicle.share.manage', 'allow');
    expect((await m.editor.request('DELETE', shareOf(m.viewer))).status).toBe(403);
    expect((await m.coOwner.request('DELETE', shareOf(m.viewer))).status).toBe(200);
  });

  test('owner-set overrides limit revoking, not level changes or the owner', async () => {
    await ctx.sql.run(
      "INSERT INTO permission_overrides (id, user_id, scope, scope_id, permission, effect, set_by) VALUES ('po-owner-switch', ?, 'vehicle', ?, 'vehicle.financing.read', 'allow', ?)",
      [m.viewer.id, CAR, ctx.user.id]
    );
    expect((await m.coOwner.request('PUT', shareOf(m.viewer), { level: 'editor' })).status).toBe(
      200
    );
    expect((await ctx.authed('DELETE', shareOf(m.viewer))).status).toBe(200);
  });

  test('revoking your own share points you to Decline', async () => {
    const res = await m.coOwner.request('DELETE', shareOf(m.coOwner));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      'decline'
    );
  });

  test('roles granted through a share stay set by the owner', async () => {
    expect((await m.coOwner.request('PUT', editorShare(), { level: 'viewer' })).status).toBe(200);
    expect(await grantedBy(m.editor.id)).toEqual([ctx.user.id]);
  });

  test('another car’s share is not found, and the owner’s email matches in any case', async () => {
    await seedCar(ctx, 'sh-other-car');
    const outsider = await createInvitee(ctx, 'sh-outsider');
    await shareCar(ctx, 'sh-other-car', outsider, 'viewer');
    const foreign = `/api/v1/shares/share-sh-other-car-${outsider.id}`;
    expect((await m.coOwner.request('DELETE', foreign)).status).toBe(404);
    expect((await invite(m.coOwner.request, ctx.user.email.toUpperCase())).status).toBe(400);
  });
});
