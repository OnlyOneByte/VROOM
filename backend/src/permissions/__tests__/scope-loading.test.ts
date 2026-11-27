import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { ScopeNotLoadedError } from '../../errors';
import { errorHandler } from '../../middleware';
import {
  createTestApp,
  requestAs,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../test-helpers/http-client';
import { type Members, seedCar, seedMembers } from '../../test-helpers/members';
import { type SweepCall, sendSweepCall, writeRouteCalls } from '../../test-helpers/route-bodies';
import { logger } from '../../utils/logger';
import { loadResolver, requestResolver } from '../grants';
import {
  type AsyncGrantSource,
  createLoadingResolver,
  type Resource,
  type ScopeGrants,
} from '../resolve';
import { isPublicRule, ROUTE_PERMISSIONS } from '../route-map';

const NO_GRANTS: ScopeGrants = { roles: [], overrides: [] };
const CAR: Resource = { kind: 'vehicle', vehicleId: 'car-a' };
const OTHER_CAR: Resource = { kind: 'vehicle', vehicleId: 'car-b' };
const SERVER: Resource = { kind: 'server' };

const ownerSource: AsyncGrantSource = {
  serverGrants: async () => NO_GRANTS,
  vehicleFacts: async () => ({ owner: true, member: false, demoGarage: false, grants: NO_GRANTS }),
};

describe('a resolver that loads before it checks', () => {
  test('refuses to decide a scope it has not loaded, even for the owner', async () => {
    const resolver = createLoadingResolver({ userId: 'u', disabled: false }, ownerSource);
    expect(() => resolver.can('vehicle.read', CAR)).toThrow(ScopeNotLoadedError);
    expect(() => resolver.can('server.roles.manage', SERVER)).toThrow(ScopeNotLoadedError);
    expect(() => resolver.rulesFor(CAR)).toThrow(ScopeNotLoadedError);

    await resolver.load([CAR]);
    expect(resolver.can('vehicle.read', CAR).allow).toBe(true);
    expect(() => resolver.can('vehicle.read', OTHER_CAR)).toThrow(ScopeNotLoadedError);

    await resolver.load([OTHER_CAR]);
    expect(resolver.can('vehicle.read', OTHER_CAR).allow).toBe(true);
  });

  test('a missed load becomes a 500 response, never an allow', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.use('*', async (c, next) => {
      c.set('user', { id: 'u' } as never);
      await next();
    });
    app.get('/unloaded', async (c) => {
      const resolver = createLoadingResolver({ userId: 'u', disabled: false }, ownerSource);
      await resolver.load([SERVER]);
      c.set('resolver', resolver);
      const decision = requestResolver(c).can('vehicle.read', CAR);
      return c.json({ allowed: decision.allow });
    });
    const logged = spyOn(logger, 'error');
    const res = await app.request('/unloaded');
    const logs = JSON.stringify(logged.mock.calls);
    logged.mockRestore();
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain('ScopeNotLoadedError');
    expect(body).not.toContain('car-a');
    expect(logs).toContain('car-a');
  });
});

const VEHICLE_ID = 'sweep-car';

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const SWEPT_KEYS = Object.entries(ROUTE_PERMISSIONS)
  .filter(([, rule]) => !isPublicRule(rule))
  .map(([key]) => key)
  .sort(
    (a, b) =>
      METHOD_ORDER.indexOf(a.split(' ')[0] ?? '') - METHOD_ORDER.indexOf(b.split(' ')[0] ?? '')
  );

const isWrite = (method: string) => method !== 'GET' && method !== 'DELETE';

const HANDLER_PRECONDITIONS: Record<string, string> = {
  'POST /api/v1/vehicles/:vehicleId/photos': 'the account has no storage provider',
  'POST /api/v1/photos/:entityType/:entityId': 'the account has no storage provider',
  'POST /api/v1/providers': 'a Google provider needs the nonce from its OAuth start',
  'POST /api/v1/assistant/chat': 'the account has no LLM provider',
  'POST /api/v1/sync/restore/from-provider': 'the account has no backup provider',
  'POST /api/v1/sync/restore/from-backup': 'the uploaded bytes are not a backup ZIP',
};

function sweepRequests(
  ownerId: string
): [key: string, method: string, path: string, call: SweepCall][] {
  const calls = writeRouteCalls(VEHICLE_ID, ownerId);
  return SWEPT_KEYS.map((key) => {
    const [method = 'GET', template = '/'] = key.split(' ');
    const call = calls[key] ?? (isWrite(method) ? { body: { vehicleId: VEHICLE_ID } } : {});
    const path = call.path ?? template.replace(/:[A-Za-z]+/g, VEHICLE_ID);
    return [key, method, `${path}${path.includes('?') ? '&' : '?'}vehicleId=${VEHICLE_ID}`, call];
  });
}

describe('the sweep sends write routes a body they accept', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
    seedCar(ctx, VEHICLE_ID);
  }, SETUP_TIMEOUT_MS);
  afterEach(() => ctx.close());

  test('every body entry names a mapped write route', () => {
    const keys = new Set(SWEPT_KEYS);
    const stale = Object.keys(writeRouteCalls(VEHICLE_ID, 'u')).filter((key) => !keys.has(key));
    expect(stale).toEqual([]);
  });

  test('the owner gets past input validation on every write route', async () => {
    const refused: string[] = [];
    const preconditionsHit = new Set<string>();
    for (const [key, method, path, call] of sweepRequests(ctx.user.id)) {
      if (!isWrite(method)) continue;
      const { cookie } = await requestAs(ctx, ctx.user.id);
      const res = await sendSweepCall(ctx.app, cookie, method, path, call);
      expect(res.status, key).not.toBe(401);
      if (res.status !== 400) continue;
      if (key in HANDLER_PRECONDITIONS) preconditionsHit.add(key);
      else refused.push(`${key} -> ${(await res.text()).slice(0, 160)}`);
    }
    expect(refused).toEqual([]);
    expect([...preconditionsHit].sort()).toEqual(Object.keys(HANDLER_PRECONDITIONS).sort());
  }, 120_000);
});

describe('every mapped route loads the scopes it checks', () => {
  let ctx: TestApp;
  let members: Members;

  beforeEach(async () => {
    ctx = await createTestApp();
    seedCar(ctx, VEHICLE_ID);
    members = await seedMembers(ctx, VEHICLE_ID, 'sweep');
  }, SETUP_TIMEOUT_MS);
  afterEach(() => ctx.close());

  async function sweepAs(userId: string): Promise<string[]> {
    const raised: string[] = [];
    const stack = spyOn(Error, 'captureStackTrace');
    try {
      for (const [, method, path, call] of sweepRequests(ctx.user.id)) {
        const before = stack.mock.calls.filter(([, ctor]) => ctor === ScopeNotLoadedError).length;
        const { cookie } = await requestAs(ctx, userId);
        const res = await sendSweepCall(ctx.app, cookie, method, path, call);
        const after = stack.mock.calls.filter(([, ctor]) => ctor === ScopeNotLoadedError).length;
        const body = await res.text();
        if (after > before || body.includes('ScopeNotLoadedError')) {
          raised.push(`${method} ${path} -> ${res.status}`);
        }
      }
    } finally {
      stack.mockRestore();
    }
    return raised;
  }

  test('two loads racing on a fresh request share one resolver', async () => {
    const car: Resource = { kind: 'vehicle', vehicleId: VEHICLE_ID };
    const app = new Hono();
    app.onError(errorHandler);
    app.use('*', async (c, next) => {
      c.set('user', { id: ctx.user.id } as never);
      await next();
    });
    app.get('/race', async (c) => {
      await Promise.all([loadResolver(c, [car]), loadResolver(c, [SERVER])]);
      return c.json({ allowed: requestResolver(c).can('vehicle.read', car).allow });
    });
    const res = await app.request('/race');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: true });
  });

  test('as the owner', async () => {
    expect(await sweepAs(ctx.user.id)).toEqual([]);
  }, 120_000);

  test('as an editor and a viewer on the car', async () => {
    expect(await sweepAs(members.editor.id)).toEqual([]);
    expect(await sweepAs(members.viewer.id)).toEqual([]);
  }, 120_000);

  test('as a stranger to the car', async () => {
    expect(await sweepAs(members.stranger.id)).toEqual([]);
  }, 120_000);
});
