import type { Context, MiddlewareHandler } from 'hono';
import { appContext } from '../app-context';
import { ForbiddenError, NotFoundError } from '../errors';
import { requestResolver } from './grants';
import type { Decision, Resource } from './resolve';
import { isPublicRule, ROUTE_PERMISSIONS, type RouteRule } from './route-map';

export type ResourceOf = (c: Context) => Resource | Resource[] | Promise<Resource | Resource[]>;

export function enforce(decision: Decision, resource: string): void {
  if (decision.allow) return;
  if (decision.reason === 'not_found') throw new NotFoundError(resource);
  throw new ForbiddenError();
}

function labelOf(resource: Resource): string {
  return resource.kind === 'vehicle' ? 'Vehicle' : 'Resource';
}

export function requireCan(c: Context, permission: string, resource: Resource): void {
  enforce(requestResolver(c, appContext().db).can(permission, resource), labelOf(resource));
}

function requiredFor(rule: RouteRule, resource: Resource, entityType: string | undefined) {
  if (typeof rule === 'string') return [rule];
  if ('byScope' in rule) {
    return [resource.kind === 'vehicle' ? rule.byScope.vehicle : rule.byScope.server];
  }
  if ('byEntity' in rule) {
    const permissions = entityType ? rule.byEntity[entityType] : undefined;
    if (!permissions) throw new NotFoundError('Resource');
    return permissions;
  }
  return null;
}

export function routeRuleOf(c: Context): RouteRule | undefined {
  const method = c.req.method === 'HEAD' ? 'GET' : c.req.method;
  return ROUTE_PERMISSIONS[`${method} ${c.req.routePath}`];
}

function checkRule(c: Context, rule: RouteRule, resource: Resource): void {
  const permissions = requiredFor(rule, resource, c.req.param('entityType')) ?? [];
  if (permissions.length === 0) throw new ForbiddenError();
  for (const permission of permissions) requireCan(c, permission, resource);
}

export function authorize(resourceOf: ResourceOf): MiddlewareHandler {
  return async function authorized(c, next) {
    const rule = routeRuleOf(c);
    if (!rule || isPublicRule(rule)) throw new ForbiddenError();
    const found = await resourceOf(c);
    const resources = Array.isArray(found) ? found : [found];
    if (resources.length === 0) throw new ForbiddenError();
    for (const resource of resources) checkRule(c, rule, resource);
    await next();
  };
}

export const ownAccount: ResourceOf = (c) => ({ kind: 'account', userId: c.get('user').id });

export function vehicleOrOwnAccount(vehicleId: string | undefined, c: Context): Resource {
  return vehicleId ? { kind: 'vehicle', vehicleId } : { kind: 'account', userId: c.get('user').id };
}

export function vehicleParam(name: string): ResourceOf {
  return (c) => ({ kind: 'vehicle', vehicleId: c.req.param(name) ?? '' });
}

export function vehicleEntry(
  vehicleId: string,
  ownerId: string,
  createdBy: string | null
): Resource {
  return { kind: 'vehicle', vehicleId, entryCreatedBy: createdBy ?? ownerId };
}
