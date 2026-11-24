import type { RouteRule } from './route-map';

export const ROUTE_MAP_FILE = 'backend/src/permissions/route-map.ts';

const MIDDLEWARE_METHOD = 'ALL';

interface RouteSource {
  routes: readonly { method: string; path: string }[];
}

export interface RouteMapGaps {
  unmapped: string[];
  stale: string[];
}

export function routeKeys(app: RouteSource): string[] {
  const keys = app.routes
    .filter((route) => route.method !== MIDDLEWARE_METHOD)
    .map((route) => `${route.method} ${route.path}`);
  return [...new Set(keys)].sort();
}

export function findRouteMapGaps(
  app: RouteSource,
  routeMap: Readonly<Record<string, RouteRule>>
): RouteMapGaps {
  const live = routeKeys(app);
  const liveSet = new Set(live);
  return {
    unmapped: live.filter((key) => !(key in routeMap)),
    stale: Object.keys(routeMap)
      .filter((key) => !liveSet.has(key))
      .sort(),
  };
}

export function describeUnmapped(keys: readonly string[]): string {
  return keys
    .map(
      (key) =>
        `${key} has no permission. Add "${key}" to ${ROUTE_MAP_FILE} with the permission id it needs, ` +
        `or { public: '<reason>' } if anyone may call it.`
    )
    .join('\n');
}

export function describeStale(keys: readonly string[]): string {
  return keys
    .map(
      (key) =>
        `${key} is in ${ROUTE_MAP_FILE} but no route matches it. Delete the entry, or fix its method or path.`
    )
    .join('\n');
}
