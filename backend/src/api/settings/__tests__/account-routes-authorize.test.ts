import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'acct-car';

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'acct');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const status = (request: RequestFn, path: string) => request('GET', path).then((res) => res.status);

const ACCOUNT_READS = [
  '/api/v1/settings',
  '/api/v1/sync/status',
  '/api/v1/providers',
  '/api/v1/push/vapid-public-key',
  '/api/v1/auth/accounts',
];

describe('account routes resolve through can()', () => {
  test('a member reads their own account; a disabled account is refused', async () => {
    for (const path of ACCOUNT_READS) {
      expect(await status(m.stranger.request, path)).not.toBe(403);
      expect(await status(m.disabled.request, path)).toBe(403);
    }
  });

  test('an account without a server role is refused', async () => {
    ctx.sqlite.run('DELETE FROM role_assignments WHERE user_id = ? AND scope_id IS NULL', [
      m.stranger.id,
    ]);
    for (const path of ACCOUNT_READS) {
      expect(await status(m.stranger.request, path)).toBe(403);
    }
    const feed = await m.stranger.request('POST', '/api/v1/calendar/feed', {});
    expect(feed.status).toBe(403);
  });

  test('the community comparison follows vehicle.community.read on the car', async () => {
    const compare = `/api/v1/community/compare?vehicleId=${CAR}`;
    expect(await status(m.viewer.request, compare)).toBe(200);
    expect(await status(m.stranger.request, compare)).toBe(404);
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.community.read', 'deny');
    expect(await status(m.viewer.request, compare)).toBe(403);
  });
});
