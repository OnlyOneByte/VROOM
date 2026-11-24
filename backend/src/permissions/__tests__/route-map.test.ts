import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { app } from '../../app';
import { PERMISSION_REGISTRY } from '../registry';
import {
  describeStale,
  describeUnmapped,
  findRouteMapGaps,
  ROUTE_MAP_FILE,
  routeKeys,
} from '../route-contract';
import { ROUTE_PERMISSIONS } from '../route-map';

describe('route map contract', () => {
  const gaps = findRouteMapGaps(app, ROUTE_PERMISSIONS);

  test('every route mounted in app.ts has a permission or a public reason', () => {
    expect(gaps.unmapped, describeUnmapped(gaps.unmapped)).toEqual([]);
  });

  test('every route-map entry matches a real route', () => {
    expect(gaps.stale, describeStale(gaps.stale)).toEqual([]);
  });

  test('every mapped permission is declared in the registry', () => {
    const unknown = Object.entries(ROUTE_PERMISSIONS).filter(
      ([, rule]) => typeof rule === 'string' && !PERMISSION_REGISTRY.has(rule)
    );
    expect(unknown).toEqual([]);
  });

  test('every public route gives a reason', () => {
    const blank = Object.entries(ROUTE_PERMISSIONS).filter(
      ([, rule]) => typeof rule !== 'string' && rule.public.trim() === ''
    );
    expect(blank).toEqual([]);
  });

  test('the capabilities endpoint is part of the map', () => {
    expect(ROUTE_PERMISSIONS['GET /api/v1/auth/capabilities']).toBe('account.profile.read');
  });
});

describe('route map kit', () => {
  function probeApp(): Hono {
    const child = new Hono();
    child.use('*', async (_c, next) => next());
    child.get('/items', (c) => c.text('ok'));
    child.post('/items/:id/archive', (c) => c.text('ok'));
    const root = new Hono();
    root.get('/health', (c) => c.text('ok'));
    root.route('/api/v1/things', child);
    return root;
  }

  test('lists mounted routes with full paths and skips middleware', () => {
    expect(routeKeys(probeApp())).toEqual([
      'GET /api/v1/things/items',
      'GET /health',
      'POST /api/v1/things/items/:id/archive',
    ]);
  });

  test('catches a deliberately unmapped route and says how to fix it', () => {
    const gaps = findRouteMapGaps(probeApp(), {
      'GET /health': { public: 'probe' },
      'GET /api/v1/things/items': 'vehicle.read',
    });
    expect(gaps.unmapped).toEqual(['POST /api/v1/things/items/:id/archive']);
    const message = describeUnmapped(gaps.unmapped);
    expect(message).toContain('POST /api/v1/things/items/:id/archive');
    expect(message).toContain(ROUTE_MAP_FILE);
    expect(message).toContain('public');
  });

  test('catches an entry that matches no route', () => {
    const gaps = findRouteMapGaps(probeApp(), {
      'GET /health': { public: 'probe' },
      'GET /api/v1/things/items': 'vehicle.read',
      'POST /api/v1/things/items/:id/archive': 'vehicle.write',
      'DELETE /api/v1/things/items/:id': 'vehicle.delete',
    });
    expect(gaps.unmapped).toEqual([]);
    expect(gaps.stale).toEqual(['DELETE /api/v1/things/items/:id']);
    expect(describeStale(gaps.stale)).toContain('DELETE /api/v1/things/items/:id');
  });
});
