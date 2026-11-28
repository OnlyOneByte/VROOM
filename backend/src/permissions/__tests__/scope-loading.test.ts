import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { setPushSenderForTest } from '../../api/push/push-service';
import { CONFIG } from '../../config';
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
import { seedSweepRecords, storeSweepPhotos } from '../../test-helpers/sweep-records';
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

const VEHICLE_DELETE = 'DELETE /api/v1/vehicles/:id';

const sweepRank = (key: string): [number, number, number] => {
  const [method = '', path = ''] = key.split(' ');
  const methodRank = METHOD_ORDER.indexOf(method);
  if (method !== 'DELETE') return [methodRank, 0, 0];
  return [methodRank, key === VEHICLE_DELETE ? 1 : 0, -path.split('/').length];
};

const SWEPT_KEYS = Object.entries(ROUTE_PERMISSIONS)
  .filter(([, rule]) => !isPublicRule(rule))
  .map(([key]) => key)
  .sort((a, b) => {
    const [ra, rb] = [sweepRank(a), sweepRank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });

const isWrite = (method: string) => method !== 'GET' && method !== 'DELETE';

type Preconditions = Record<string, string>;

const WRITE_PRECONDITIONS: Preconditions = {
  'POST /api/v1/vehicles/:vehicleId/photos': 'No storage provider configured',
  'POST /api/v1/photos/:entityType/:entityId': 'No storage provider configured',
  'POST /api/v1/providers': 'Missing nonce',
  'POST /api/v1/assistant/chat': 'No assistant (LLM) provider is configured',
  'POST /api/v1/sync/restore/from-provider': 'Provider not found or inactive',
  'POST /api/v1/sync/restore/from-backup': 'not a readable VROOM backup ZIP',
};

const READ_PRECONDITIONS: Preconditions = {
  'GET /api/v1/photos/receipt-drafts': 'Connect Google Photos in Settings',
};

const quietPush = { send: async () => ({ kind: 'ok' as const }) };

const config = CONFIG as { disableRateLimit: boolean; allowFakeStorageProvider: boolean };
const configWas = {
  disableRateLimit: config.disableRateLimit,
  allowFakeStorageProvider: config.allowFakeStorageProvider,
};
const sweepConfig = (on: boolean) => {
  config.disableRateLimit = on || configWas.disableRateLimit;
  config.allowFakeStorageProvider = on || configWas.allowFakeStorageProvider;
};

function sweepRequests(
  memberId: string
): [key: string, method: string, path: string, call: SweepCall | undefined][] {
  const calls = writeRouteCalls(VEHICLE_ID, memberId);
  return SWEPT_KEYS.map((key) => {
    const [method = 'GET', template = '/'] = key.split(' ');
    const call = calls[key] ?? (isWrite(method) ? { body: { vehicleId: VEHICLE_ID } } : undefined);
    const path = call?.path ?? template.replace(/:[A-Za-z]+/g, VEHICLE_ID);
    return [key, method, `${path}${path.includes('?') ? '&' : '?'}vehicleId=${VEHICLE_ID}`, call];
  });
}

async function inputOutcome(
  preconditions: Preconditions,
  key: string,
  res: Response
): Promise<string | 'precondition' | null> {
  if (res.status === 401 || res.status === 429 || res.status >= 500) return String(res.status);
  if (res.status !== 400) return null;
  const text = await res.text();
  const expected = preconditions[key];
  return expected && text.includes(expected) ? 'precondition' : text.slice(0, 160);
}

async function seedSweepCar(ctx: TestApp): Promise<Members> {
  await seedCar(ctx, VEHICLE_ID);
  ctx.sqlite.run('UPDATE vehicles SET car_share_enabled = 1 WHERE id = ?', [VEHICLE_ID]);
  const members = await seedMembers(ctx, VEHICLE_ID, 'sweep');
  seedSweepRecords(ctx, VEHICLE_ID, members.stranger.id);
  await storeSweepPhotos(ctx, VEHICLE_ID);
  return members;
}

describe('the sweep sends each route with a body one it accepts', () => {
  let ctx: TestApp;
  let members: Members;

  beforeEach(async () => {
    ctx = await createTestApp();
    sweepConfig(true);
    members = await seedSweepCar(ctx);
    setPushSenderForTest(quietPush);
  }, SETUP_TIMEOUT_MS);
  afterEach(() => {
    setPushSenderForTest(null);
    sweepConfig(false);
    ctx.close();
  });

  test('every call entry names a mapped route', () => {
    const keys = new Set(SWEPT_KEYS);
    const stale = Object.keys(writeRouteCalls(VEHICLE_ID, 'u')).filter((key) => !keys.has(key));
    expect(stale).toEqual([]);
  });

  test('the owner gets past input validation on every route that takes input', async () => {
    const refused: string[] = [];
    const preconditionsHit = new Set<string>();
    for (const [key, method, path, call] of sweepRequests(members.editor.id)) {
      if (!call || method === 'GET') continue;
      const { cookie } = await requestAs(ctx, ctx.user.id);
      const outcome = await inputOutcome(
        WRITE_PRECONDITIONS,
        key,
        await sendSweepCall(ctx.app, cookie, method, path, call)
      );
      if (outcome === 'precondition') preconditionsHit.add(key);
      else if (outcome) refused.push(`${key} -> ${outcome}`);
    }
    expect(refused).toEqual([]);
    expect([...preconditionsHit].sort()).toEqual(Object.keys(WRITE_PRECONDITIONS).sort());
  }, 120_000);

  test('in sweep order, the owner finds the record behind every path id', async () => {
    const missing: string[] = [];
    for (const [key, method, path, call] of sweepRequests(members.editor.id)) {
      const { cookie } = await requestAs(ctx, ctx.user.id);
      const res = await sendSweepCall(ctx.app, cookie, method, path, call ?? {});
      if (res.status === 404) missing.push(`${key} -> ${(await res.text()).slice(0, 120)}`);
    }
    expect(missing).toEqual([]);
  }, 120_000);

  test('the owner gets past input validation and stored-data checks on every read', async () => {
    const refused: string[] = [];
    const preconditionsHit = new Set<string>();
    for (const [key, method, path, call] of sweepRequests(members.editor.id)) {
      if (method !== 'GET') continue;
      const { cookie } = await requestAs(ctx, ctx.user.id);
      const res = await sendSweepCall(ctx.app, cookie, method, path, call ?? {});
      const outcome =
        res.status === 422
          ? `422 ${(await res.text()).slice(0, 160)}`
          : await inputOutcome(READ_PRECONDITIONS, key, res);
      if (outcome === 'precondition') preconditionsHit.add(key);
      else if (outcome) refused.push(`${key} -> ${outcome}`);
    }
    expect(refused).toEqual([]);
    expect([...preconditionsHit].sort()).toEqual(Object.keys(READ_PRECONDITIONS).sort());
  }, 120_000);
});

describe('every mapped route loads the scopes it checks', () => {
  let ctx: TestApp;
  let members: Members;

  beforeEach(async () => {
    ctx = await createTestApp();
    sweepConfig(true);
    members = await seedSweepCar(ctx);
    setPushSenderForTest(quietPush);
  }, SETUP_TIMEOUT_MS);
  afterEach(() => {
    setPushSenderForTest(null);
    sweepConfig(false);
    ctx.close();
  });

  async function sweepAs(userId: string): Promise<string[]> {
    const raised: string[] = [];
    const stack = spyOn(Error, 'captureStackTrace');
    try {
      for (const [, method, path, call] of sweepRequests(members.editor.id)) {
        const before = stack.mock.calls.filter(([, ctor]) => ctor === ScopeNotLoadedError).length;
        const { cookie } = await requestAs(ctx, userId);
        const res = await sendSweepCall(ctx.app, cookie, method, path, call ?? {});
        const after = stack.mock.calls.filter(([, ctor]) => ctor === ScopeNotLoadedError).length;
        const body = await res.text();
        if (after > before || body.includes('ScopeNotLoadedError')) {
          raised.push(`${method} ${path} -> ${res.status}`);
        } else if (res.status === 401 || res.status === 429) {
          raised.push(`${method} ${path} -> ${res.status}, so the route was never checked`);
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
