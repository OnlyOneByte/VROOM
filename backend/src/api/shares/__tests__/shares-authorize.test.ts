import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { builtInRoleId } from '../../../permissions/grants';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
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
  seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'sh');
});
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
    overrideOn(ctx, CAR, m.coOwner, 'vehicle.share.manage', 'deny');
    expect((await invite(m.coOwner.request, 'e@example.com')).status).toBe(403);
    expect((await m.coOwner.request('DELETE', editorShare())).status).toBe(403);
    overrideOn(ctx, CAR, m.editor, 'vehicle.share.manage', 'allow');
    expect((await invite(m.editor.request, 'f@example.com')).status).toBe(201);
  });

  test('a disabled account cannot list or answer its invitations', async () => {
    expect((await m.disabled.request('GET', '/api/v1/shares/received')).status).toBe(403);
    expect((await m.stranger.request('GET', '/api/v1/shares/received')).status).toBe(200);
  });
});

describe('share management cannot be used to escalate', () => {
  const shareOf = (member: { id: string }) => `/api/v1/shares/share-${CAR}-${member.id}`;
  const grantedBy = (userId: string) =>
    (
      ctx.sqlite
        .query('SELECT granted_by FROM role_assignments WHERE user_id = ? AND scope_id = ?')
        .all(userId, CAR) as { granted_by: string }[]
    ).map((row) => row.granted_by);

  test('a manager grants only what they hold and never changes their own share', async () => {
    overrideOn(ctx, CAR, m.viewer, 'vehicle.share.manage', 'allow');
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

  test('an owner-set deny limits what a co-owner can hand out', async () => {
    overrideOn(ctx, CAR, m.coOwner, 'vehicle.expense.write', 'deny');
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
    shareCar(ctx, CAR, other, 'viewer');
    ctx.sqlite.run(
      'INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES (?, ?, ?, ?, ?)',
      [`ra-${other.id}`, other.id, builtInRoleId('co_owner'), CAR, ctx.user.id]
    );
    expect((await m.coOwner.request('DELETE', shareOf(other))).status).toBe(403);
    expect((await m.coOwner.request('PUT', shareOf(other), { level: 'editor' })).status).toBe(403);
    expect((await ctx.authed('DELETE', shareOf(other))).status).toBe(200);
  });

  test('a manager only changes or removes people whose access they hold themselves', async () => {
    overrideOn(ctx, CAR, m.viewer, 'vehicle.share.manage', 'allow');
    expect((await m.viewer.request('PUT', editorShare(), { level: 'viewer' })).status).toBe(403);
    expect((await m.viewer.request('DELETE', editorShare())).status).toBe(403);

    const appointed = await createInvitee(ctx, 'sh-co-owner-3');
    shareCar(ctx, CAR, appointed, 'viewer');
    ctx.sqlite.run(
      'INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES (?, ?, ?, ?, ?)',
      [`ra-${appointed.id}`, appointed.id, builtInRoleId('co_owner'), CAR, m.coOwner.id]
    );
    overrideOn(ctx, CAR, m.editor, 'vehicle.share.manage', 'allow');
    expect((await m.editor.request('DELETE', shareOf(appointed))).status).toBe(403);
    expect((await m.coOwner.request('DELETE', shareOf(appointed))).status).toBe(200);
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
    expect(grantedBy(m.editor.id)).toEqual([ctx.user.id]);
  });

  test('another car’s share is not found, and the owner’s email matches in any case', async () => {
    seedCar(ctx, 'sh-other-car');
    const outsider = await createInvitee(ctx, 'sh-outsider');
    shareCar(ctx, 'sh-other-car', outsider, 'viewer');
    const foreign = `/api/v1/shares/share-sh-other-car-${outsider.id}`;
    expect((await m.coOwner.request('DELETE', foreign)).status).toBe(404);
    expect((await invite(m.coOwner.request, ctx.user.email.toUpperCase())).status).toBe(400);
  });
});
