import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { DEMO_USER_ID } from '../../api/auth/demo-account';
import { app } from '../../app';
import { getDb } from '../../db/connection';
import type { AppError } from '../../errors';
import { createTestApp, requestAs } from '../../test-helpers/http-client';
import { assignServerRole, resolverFor } from '../grants';
import { routeGuard } from '../route-guard';
import { isPublicRule, ROUTE_PERMISSIONS } from '../route-map';

const SELF_CHECKED_ROUTES: Record<string, string> = {
  'GET /api/v1/auth/me': 'reads the session cookie itself and answers 401 without one',
  'GET /api/v1/auth/capabilities': 'reports the caller’s own rules, pending accounts included',
  'POST /api/v1/auth/logout': 'must clear any session, expired ones included',
  'POST /api/v1/auth/refresh': 'reads the session cookie itself and answers 401 without one',
  'GET /api/v1/auth/callback/link/:authProvider':
    'OAuth return: checks its stored state, the session and the permission it started with',
  'GET /api/v1/auth/callback/provider/google':
    'OAuth return: checks its stored state, the session and the permission it started with',
  'GET /api/v1/overrides':
    'anyone reads their own overrides; reading another person’s is checked inside',
  'GET /api/v1/roles': 'server roles need server.roles.manage, vehicle roles the owner’s library',
  'POST /api/v1/roles': 'server roles need server.roles.manage, vehicle roles the owner’s library',
  'PATCH /api/v1/roles/:id': 'checked by the role’s scope inside',
  'DELETE /api/v1/roles/:id': 'checked by the role’s scope inside',
  'GET /api/v1/roles/:id/permissions': 'checked by the role’s scope inside',
  'PUT /api/v1/roles/:id/permissions': 'checked by the role’s scope inside',
};

type Probe = [method: string, path: string, body?: unknown];

const PROBE_ROLE = 'probe-server-role';

const SELF_CHECK_PROBES: Record<string, Probe> = {
  'GET /api/v1/overrides': ['GET', '/api/v1/overrides?userId=OWNER&scope=server'],
  'GET /api/v1/roles': ['GET', '/api/v1/roles?scope=server'],
  'POST /api/v1/roles': ['POST', '/api/v1/roles', { scope: 'server', name: 'Probe' }],
  'PATCH /api/v1/roles/:id': ['PATCH', `/api/v1/roles/${PROBE_ROLE}`, { name: 'Renamed' }],
  'DELETE /api/v1/roles/:id': ['DELETE', `/api/v1/roles/${PROBE_ROLE}`],
  'GET /api/v1/roles/:id/permissions': ['GET', `/api/v1/roles/${PROBE_ROLE}/permissions`],
  'PUT /api/v1/roles/:id/permissions': [
    'PUT',
    `/api/v1/roles/${PROBE_ROLE}/permissions`,
    { permissions: [] },
  ],
};

describe('routes that check inside really refuse', () => {
  test('every self-checked route outside the session flow has a probe', () => {
    const unprobed = Object.keys(SELF_CHECKED_ROUTES).filter(
      (key) => !key.includes(' /api/v1/auth/') && !(key in SELF_CHECK_PROBES)
    );
    expect(unprobed).toEqual([]);
  });

  test('an account without a server role is refused by each of them', async () => {
    const ctx = await createTestApp();
    try {
      ctx.sqlite.run(
        `INSERT INTO roles (id, scope, name, built_in) VALUES ('${PROBE_ROLE}', 'server', 'Probe', 0)`
      );
      ctx.sqlite.run(
        "INSERT INTO users (id, email, display_name) VALUES ('no-role', 'n@x.test', 'N')"
      );
      const caller = await requestAs(ctx, 'no-role');
      const answered: string[] = [];
      for (const [key, [method, path, body]] of Object.entries(SELF_CHECK_PROBES)) {
        const res = await caller.request(method, path.replace('OWNER', ctx.user.id), body);
        if (res.status !== 403 && res.status !== 404) answered.push(`${key} -> ${res.status}`);
      }
      expect(answered).toEqual([]);
    } finally {
      ctx.close();
    }
  });
});

describe('every mapped route enforces its permission', () => {
  test('each non-public route runs authorize(), apart from the routes that check inside', () => {
    const authorized = new Set(
      app.routes
        .filter((route) => route.handler.name === 'authorized')
        .map((route) => `${route.method} ${route.path}`)
    );
    const missing = Object.entries(ROUTE_PERMISSIONS)
      .filter(([key, rule]) => !isPublicRule(rule) && !(key in SELF_CHECKED_ROUTES))
      .map(([key]) => key)
      .filter((key) => !authorized.has(key));
    expect(missing).toEqual([]);
  });

  test('the routes that check inside are still mapped', () => {
    for (const key of Object.keys(SELF_CHECKED_ROUTES))
      expect(ROUTE_PERMISSIONS[key]).toBeDefined();
  });
});

describe('the route guard', () => {
  function guarded(userId?: string): Hono {
    const probe = new Hono();
    probe.onError((error, c) =>
      c.json({ code: (error as AppError).code }, (error as AppError).statusCode as 403)
    );
    probe.use('*', async (c, next) => {
      if (userId) c.set('user', { id: userId } as never);
      await next();
    });
    probe.use('*', routeGuard);
    probe.get('/health', (c) => c.text('ok'));
    probe.get('/api/v1/unmapped-probe', (c) => c.text('reached'));
    probe.get('/api/v1/settings', (c) => c.text('reached'));
    probe.put('/api/v1/settings', (c) => c.text('reached'));
    probe.post('/api/v1/auth/demo', (c) => c.text('reached'));
    return probe;
  }

  test('a route missing from the map is refused at runtime', async () => {
    expect((await guarded('someone').request('/api/v1/unmapped-probe')).status).toBe(403);
    expect((await guarded().request('/api/v1/unmapped-probe')).status).toBe(403);
    expect((await guarded().request('/health')).status).toBe(200);
  });

  test('the demo account may only call routes its role covers', async () => {
    const demo = guarded(DEMO_USER_ID);
    expect((await demo.request('/api/v1/settings')).status).toBe(200);
    const write = await demo.request('/api/v1/settings', { method: 'PUT' });
    expect(write.status).toBe(403);
    expect(((await write.json()) as { code: string }).code).toBe('DEMO_READ_ONLY');
    expect((await demo.request('/api/v1/auth/demo', { method: 'POST' })).status).toBe(403);
    expect((await guarded('someone').request('/api/v1/settings', { method: 'PUT' })).status).toBe(
      200
    );
  });
});

describe('the Demo role on its own garage', () => {
  test('reads its own cars but never acts as their owner', async () => {
    const ctx = await createTestApp();
    try {
      ctx.sqlite.run(
        "INSERT INTO users (id, email, display_name) VALUES ('demo-probe', 'd@x.test', 'D')"
      );
      assignServerRole(getDb(), 'demo-probe', 'demo');
      ctx.sqlite.run(
        "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('demo-car', 'demo-probe', 'Kia', 'Rio', 2020)"
      );
      const resolver = resolverFor(getDb(), 'demo-probe');
      const car = { kind: 'vehicle' as const, vehicleId: 'demo-car' };
      const own = { kind: 'account' as const, userId: 'demo-probe' };
      expect(resolver.can('vehicle.read', car).allow).toBe(true);
      expect(resolver.can('vehicle.expense.read', car).allow).toBe(true);
      expect(resolver.can('vehicle.write', car).allow).toBe(false);
      expect(resolver.can('vehicle.expense.write', car).allow).toBe(false);
      expect(resolver.can('vehicle.delete', car).allow).toBe(false);
      expect(resolver.can('vehicle.expense.read', own).allow).toBe(true);
      expect(resolver.can('vehicle.expense.write', own).allow).toBe(false);
      expect(resolverFor(getDb(), ctx.user.id).can('vehicle.read', car).allow).toBe(false);
      ctx.sqlite.run(
        "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('own-car', ?, 'Kia', 'Rio', 2020)",
        [ctx.user.id]
      );
      const owner = resolverFor(getDb(), ctx.user.id);
      expect(owner.can('vehicle.write', { kind: 'vehicle', vehicleId: 'own-car' }).allow).toBe(
        true
      );
      expect(owner.can('vehicle.delete', { kind: 'vehicle', vehicleId: 'own-car' }).allow).toBe(
        true
      );
    } finally {
      ctx.close();
    }
  });
});

describe('the roles routes check by scope', () => {
  test('a custom server role with only server.roles.manage lists server roles', async () => {
    const ctx = await createTestApp();
    try {
      ctx.sqlite.run(
        "INSERT INTO roles (id, scope, name, built_in) VALUES ('role-managers', 'server', 'Role managers', 0)"
      );
      ctx.sqlite.run(
        "INSERT INTO role_permissions (role_id, permission) VALUES ('role-managers', 'server.roles.manage')"
      );
      ctx.sqlite.run('DELETE FROM role_assignments WHERE user_id = ?', [ctx.user.id]);
      ctx.sqlite.run(
        "INSERT INTO role_assignments (id, user_id, role_id) VALUES ('ra-managers', ?, 'role-managers')",
        [ctx.user.id]
      );
      expect((await ctx.authed('GET', '/api/v1/roles?scope=server')).status).toBe(200);
    } finally {
      ctx.close();
    }
  });
});

describe('the Demo role stays with the demo garage', () => {
  test('it cannot be assigned or copied through the roles API', async () => {
    const ctx = await createTestApp();
    try {
      const other = 'demo-target';
      ctx.sqlite.run("INSERT INTO users (id, email, display_name) VALUES (?, 't@x.test', 'T')", [
        other,
      ]);
      ctx.sqlite.run(
        "INSERT INTO role_assignments (id, user_id, role_id) VALUES ('ra-admin', ?, 'builtin_admin')",
        [ctx.user.id]
      );
      const assign = await ctx.authed('POST', '/api/v1/role-assignments', {
        userId: other,
        roleId: 'builtin_demo',
      });
      expect(assign.status).toBe(400);
      const copy = await ctx.authed('POST', '/api/v1/roles', {
        scope: 'server',
        name: 'Copy',
        copyFrom: 'builtin_demo',
      });
      expect(copy.status).toBe(400);
    } finally {
      ctx.close();
    }
  });
});

describe('unversioned API paths', () => {
  test('redirect to v1, including paths that start with a v', async () => {
    const ctx = await createTestApp();
    try {
      for (const path of ['/api/vehicles', '/api/vehicles/abc', '/api/settings']) {
        const res = await ctx.authed('GET', path);
        expect(`${path} ${res.status}`).toBe(`${path} 308`);
      }
      expect((await ctx.authed('GET', '/api/v1/vehicles')).status).toBe(200);
    } finally {
      ctx.close();
    }
  });
});
