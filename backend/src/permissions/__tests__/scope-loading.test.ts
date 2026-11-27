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
    app.get('/unloaded', (c) => {
      const decision = requestResolver(c).can('vehicle.read', CAR);
      return c.json({ allowed: decision.allow });
    });
    const res = await app.request('/unloaded');
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain('ScopeNotLoadedError');
    expect(body).not.toContain(CAR.kind === 'vehicle' ? CAR.vehicleId : '');
  });
});

const VEHICLE_ID = 'sweep-car';

function concretePath(key: string): [method: string, path: string] {
  const [method = 'GET', template = '/'] = key.split(' ');
  const path = template.replace(/:[A-Za-z]+/g, VEHICLE_ID);
  return [method, `${path}${path.includes('?') ? '&' : '?'}vehicleId=${VEHICLE_ID}`];
}

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const SWEEP = Object.entries(ROUTE_PERMISSIONS)
  .filter(([, rule]) => !isPublicRule(rule))
  .map(([key]) => concretePath(key))
  .sort(([a], [b]) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b));

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
      for (const [method, path] of SWEEP) {
        const before = stack.mock.calls.filter(([, ctor]) => ctor === ScopeNotLoadedError).length;
        const { request } = await requestAs(ctx, userId);
        const res = await request(
          method,
          path,
          method === 'GET' ? undefined : { vehicleId: VEHICLE_ID }
        );
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
