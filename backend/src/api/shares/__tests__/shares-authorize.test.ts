import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

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
