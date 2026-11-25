import type { Context, MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';
import { DEMO_USER_ID } from '../api/auth/demo-account';
import { DemoReadOnlyError, ForbiddenError } from '../errors';
import { DEMO_ROLE_KEY, ROLE_TEMPLATES } from './roles';
import { isPublicRule, ROUTE_PERMISSIONS, rulePermissions } from './route-map';

const DEMO_PERMISSIONS: ReadonlySet<string> = new Set(
  ROLE_TEMPLATES.find((template) => template.key === DEMO_ROLE_KEY)?.permissions ?? []
);

function matchedRouteKey(c: Context): string | null {
  const method = c.req.method === 'HEAD' ? 'GET' : c.req.method;
  const route = matchedRoutes(c).find((candidate) => candidate.method === method);
  return route ? `${method} ${route.path}` : null;
}

export const routeGuard: MiddlewareHandler = async (c, next) => {
  const key = matchedRouteKey(c);
  if (!key) return next();
  const rule = ROUTE_PERMISSIONS[key];
  if (!rule) throw new ForbiddenError();
  const demo = c.get('user')?.id === DEMO_USER_ID;
  if (isPublicRule(rule)) {
    if (demo && c.req.method !== 'GET' && c.req.method !== 'HEAD') throw new DemoReadOnlyError();
    return next();
  }
  if (demo && !rulePermissions(rule).every((permission) => DEMO_PERMISSIONS.has(permission))) {
    throw new DemoReadOnlyError();
  }
  return next();
};
