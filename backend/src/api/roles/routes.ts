import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { appContext } from '../../app-context';
import {
  permissionOverrides,
  type Role,
  roleAssignments,
  rolePermissions,
  roles,
  users,
  vehicleShares,
  vehicles,
} from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import {
  ConflictError,
  ForbiddenError,
  isUniqueConstraintError,
  NotFoundError,
  ValidationError,
} from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, enforce, type ResourceOf } from '../../permissions/authorize';
import {
  isVehicleMember,
  keepingARoleManager,
  loadResolver,
  ROLE_MANAGE_PERMISSION,
  refuseUngrantable,
  refuseUnheld,
  requestResolver,
  syncResolverFor,
} from '../../permissions/grants';
import { PERMISSION_REGISTRY } from '../../permissions/registry';
import type { Resource } from '../../permissions/resolve';
import { DEMO_ROLE_KEY, type RoleScope } from '../../permissions/roles';
import { readJsonBody } from '../../utils/request-body';
import { commonSchemas, zValidator } from '../../utils/validation';

const SCOPES = ['server', 'vehicle'] as const;
const SERVER: Resource = { kind: 'server' };
const VEHICLE_PERMISSIONS = PERMISSION_REGISTRY.list.filter((d) => d.scope === 'vehicle');

function scopedResource(scopeId: string | null | undefined): Resource {
  return scopeId ? { kind: 'vehicle', vehicleId: scopeId } : SERVER;
}

const assignmentResource: ResourceOf = async (c) =>
  scopedResource(
    c.req.method === 'POST'
      ? (await readJsonBody<{ scopeId?: string | null }>(c)).scopeId
      : c.req.query('scopeId')
  );

const overrideResource: ResourceOf = async (c) => {
  const target =
    c.req.method === 'PUT'
      ? await readJsonBody<{ scope?: string; scopeId?: string | null }>(c)
      : { scope: c.req.query('scope'), scopeId: c.req.query('scopeId') };
  return scopedResource(target.scope === 'vehicle' ? target.scopeId : null);
};

function writeAt<T>(scope: RoleScope, change: (tx: DrizzleTransaction) => T): T {
  const db = appContext().db;
  return scope === 'server' ? keepingARoleManager(db, change) : db.transaction(change);
}

function permissionsOf(roleId: string): string[] {
  return appContext()
    .db.select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId))
    .all()
    .map((row) => row.permission);
}

function roleView(role: Role) {
  const { id, scope, key, name, color, builtIn, ownerUserId } = role;
  return { id, scope, key, name, color, builtIn, ownerUserId, permissions: permissionsOf(id) };
}

function findRole(id: string): Role {
  const role = appContext().db.select().from(roles).where(eq(roles.id, id)).get();
  if (!role) throw new NotFoundError('Role');
  return role;
}

interface Authority {
  scopeId: string | null;
  ownerId: string | null;
  holds: (permission: string) => boolean;
}

function authorityAt(c: Context, scope: RoleScope, scopeId: string | null | undefined): Authority {
  const resolver = requestResolver(c);
  if (scope === 'server') {
    if (scopeId) throw new ValidationError('A server role or override takes no scopeId');
    enforce(resolver.can(ROLE_MANAGE_PERMISSION, SERVER), 'Role');
    return { scopeId: null, ownerId: null, holds: (p) => resolver.can(p, SERVER).allow };
  }
  if (!scopeId) throw new ValidationError('A vehicle role or override needs the vehicle id');
  const vehicle: Resource = { kind: 'vehicle', vehicleId: scopeId };
  enforce(resolver.can('vehicle.share.manage', vehicle), 'Vehicle');
  const owner = appContext()
    .db.select({ id: vehicles.userId })
    .from(vehicles)
    .where(eq(vehicles.id, scopeId))
    .get();
  return {
    scopeId,
    ownerId: owner?.id ?? null,
    holds: (p) => resolver.can(p, vehicle).allow,
  };
}

function refuseOverOwner(c: Context, authority: Authority, setBy: string | null | undefined) {
  if (authority.ownerId && setBy === authority.ownerId && c.get('user').id !== authority.ownerId) {
    throw new ForbiddenError('Only the owner can change what the owner set');
  }
}

function requireTarget(authority: Authority, userId: string): void {
  if (authority.scopeId) {
    if (!isVehicleMember(appContext().db, authority.scopeId, userId))
      throw new NotFoundError('Member');
    return;
  }
  const user = appContext()
    .db.select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) throw new NotFoundError('User');
}

function requireRoleManager(c: Context): null {
  enforce(requestResolver(c).can(ROLE_MANAGE_PERMISSION, SERVER), 'Role');
  return null;
}

function requireLibrary(c: Context): string {
  const userId = c.get('user').id;
  enforce(requestResolver(c).can('account.roles.manage', { kind: 'account', userId }), 'Role');
  return userId;
}

function roleFor(c: Context, id: string, change: boolean): Role {
  const role = findRole(id);
  if (role.scope === 'server') {
    requireRoleManager(c);
  } else if (requireLibrary(c) !== role.ownerUserId && !role.builtIn) {
    throw new NotFoundError('Role');
  }
  if (change && role.builtIn) {
    throw new ForbiddenError("Built-in roles can't be changed. Duplicate one instead");
  }
  return role;
}

function visibleRoles(c: Context, scope: RoleScope) {
  if (scope === 'server') {
    requireRoleManager(c);
    return eq(roles.scope, 'server');
  }
  return and(
    eq(roles.scope, 'vehicle'),
    or(eq(roles.builtIn, true), eq(roles.ownerUserId, requireLibrary(c)))
  );
}

function holdsForRole(c: Context, scope: RoleScope): (permission: string) => boolean {
  if (scope === 'vehicle') return () => true;
  const resolver = requestResolver(c);
  return (p) => resolver.can(p, SERVER).allow;
}

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #4f46e5')
  .nullish();
const permissionList = z.array(z.string().min(1)).max(PERMISSION_REGISTRY.list.length);

const createRoleSchema = z.strictObject({
  scope: z.enum(SCOPES),
  name: z.string().trim().min(1).max(50),
  color: colorSchema,
  permissions: permissionList.default([]),
  copyFrom: z.string().min(1).optional(),
});

const updateRoleSchema = z.strictObject({
  name: z.string().trim().min(1).max(50).optional(),
  color: colorSchema,
});

const loadRoleScopes: MiddlewareHandler = async (c, next) => {
  const scopeId = c.req.query('scopeId');
  await loadResolver(c, scopeId ? [{ kind: 'vehicle', vehicleId: scopeId }] : []);
  await next();
};

export const roleRoutes = new Hono();
roleRoutes.use('*', requireAuth);
roleRoutes.use('*', changeTracker);
roleRoutes.use('*', loadRoleScopes);

roleRoutes.get('/', zValidator('query', z.object({ scope: z.enum(SCOPES) })), (c) => {
  const { scope } = c.req.valid('query');
  const rows = appContext()
    .db.select()
    .from(roles)
    .where(visibleRoles(c, scope))
    .orderBy(roles.createdAt)
    .all();
  return c.json({ success: true, data: rows.map(roleView) });
});

roleRoutes.post('/', zValidator('json', createRoleSchema), (c) => {
  const { scope, name, color, copyFrom } = c.req.valid('json');
  const ownerUserId = scope === 'vehicle' ? requireLibrary(c) : requireRoleManager(c);
  const copied = copyFrom ? roleFor(c, copyFrom, false) : null;
  if (copied) refuseDemoRole(copied);
  if (copied && copied.scope !== scope) {
    throw new ValidationError('A role can only be copied into a role of the same scope');
  }
  const permissions = [
    ...new Set([...(copied ? permissionsOf(copied.id) : []), ...c.req.valid('json').permissions]),
  ];
  refuseUngrantable(scope, permissions);
  refuseUnheld(permissions, holdsForRole(c, scope));
  const role = appContext().db.transaction((tx) => {
    const created = tx
      .insert(roles)
      .values({ scope, name, color: color ?? null, ownerUserId })
      .returning()
      .get();
    if (permissions.length > 0) {
      tx.insert(rolePermissions)
        .values(permissions.map((permission) => ({ roleId: created.id, permission })))
        .run();
    }
    return created;
  });
  return c.json({ success: true, data: roleView(role) }, 201);
});

roleRoutes.patch(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateRoleSchema),
  (c) => {
    const role = roleFor(c, c.req.valid('param').id, true);
    const updated = appContext()
      .db.update(roles)
      .set({ ...c.req.valid('json'), updatedAt: new Date() })
      .where(eq(roles.id, role.id))
      .returning()
      .get();
    return c.json({ success: true, data: roleView(updated ?? role) });
  }
);

roleRoutes.delete('/:id', zValidator('param', commonSchemas.idParam), (c) => {
  const role = roleFor(c, c.req.valid('param').id, true);
  writeAt(role.scope, (tx) => tx.delete(roles).where(eq(roles.id, role.id)).run());
  return c.json({ success: true, message: 'Role deleted' });
});

roleRoutes.get('/:id/permissions', zValidator('param', commonSchemas.idParam), (c) => {
  const role = roleFor(c, c.req.valid('param').id, false);
  return c.json({ success: true, data: { permissions: permissionsOf(role.id) } });
});

roleRoutes.put(
  '/:id/permissions',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', z.strictObject({ permissions: permissionList })),
  (c) => {
    const role = roleFor(c, c.req.valid('param').id, true);
    const permissions = [...new Set(c.req.valid('json').permissions)];
    const current = new Set(permissionsOf(role.id));
    refuseUngrantable(role.scope, permissions);
    refuseUnheld(
      permissions.filter((p) => !current.has(p)),
      holdsForRole(c, role.scope)
    );
    writeAt(role.scope, (tx) => {
      tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id)).run();
      if (permissions.length > 0) {
        tx.insert(rolePermissions)
          .values(permissions.map((permission) => ({ roleId: role.id, permission })))
          .run();
      }
    });
    return c.json({ success: true, data: { permissions } });
  }
);

const assignmentSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().min(1),
  scopeId: z.string().min(1).nullish(),
});

function refuseDemoRole(role: Role): void {
  if (role.builtIn && role.key === DEMO_ROLE_KEY) {
    throw new ValidationError('The Demo role belongs to the demo garage and cannot be given out');
  }
}

function assignable(c: Context, input: z.infer<typeof assignmentSchema>) {
  const role = findRole(input.roleId);
  const authority = authorityAt(c, role.scope, input.scopeId);
  if (role.scope === 'vehicle' && !role.builtIn && role.ownerUserId !== authority.ownerId) {
    throw new NotFoundError('Role');
  }
  requireTarget(authority, input.userId);
  refuseUnheld(permissionsOf(role.id), authority.holds);
  return { role, scopeId: authority.scopeId, authority };
}

export const assignmentRoutes = new Hono();
assignmentRoutes.use('*', requireAuth);
assignmentRoutes.use('*', changeTracker);
assignmentRoutes.use('*', loadRoleScopes);

assignmentRoutes.post(
  '/',
  zValidator('json', assignmentSchema),
  authorize(assignmentResource),
  (c) => {
    const input = c.req.valid('json');
    refuseDemoRole(findRole(input.roleId));
    const { role, scopeId } = assignable(c, input);
    try {
      const created = appContext()
        .db.insert(roleAssignments)
        .values({ userId: input.userId, roleId: role.id, scopeId, grantedBy: c.get('user').id })
        .returning()
        .get();
      return c.json({ success: true, data: created }, 201);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError('They already hold this role');
      throw error;
    }
  }
);

assignmentRoutes.delete(
  '/',
  zValidator('query', assignmentSchema),
  authorize(assignmentResource),
  (c) => {
    const input = c.req.valid('query');
    const { role, scopeId, authority } = assignable(c, input);
    const where = and(
      eq(roleAssignments.userId, input.userId),
      eq(roleAssignments.roleId, role.id),
      scopeId ? eq(roleAssignments.scopeId, scopeId) : isNull(roleAssignments.scopeId)
    );
    const existing = appContext().db.select().from(roleAssignments).where(where).get();
    if (!existing) throw new NotFoundError('Role assignment');
    refuseOverOwner(c, authority, existing.grantedBy);
    writeAt(role.scope, (tx) => tx.delete(roleAssignments).where(where).run());
    return c.json({ success: true, message: 'Role removed' });
  }
);

const overrideTargetSchema = z.object({
  userId: z.string().min(1),
  scope: z.enum(SCOPES),
  scopeId: z.string().min(1).nullish(),
});

function overrideWhere(scope: RoleScope, userId: string, scopeId: string | null) {
  return and(
    eq(permissionOverrides.userId, userId),
    eq(permissionOverrides.scope, scope),
    scopeId ? eq(permissionOverrides.scopeId, scopeId) : isNull(permissionOverrides.scopeId)
  );
}

export const overrideRoutes = new Hono();
overrideRoutes.use('*', requireAuth);
overrideRoutes.use('*', changeTracker);
overrideRoutes.use('*', loadRoleScopes);

overrideRoutes.get('/', zValidator('query', overrideTargetSchema), (c) => {
  const { userId, scope, scopeId } = c.req.valid('query');
  if (userId !== c.get('user').id) requireTarget(authorityAt(c, scope, scopeId), userId);
  const rows = appContext()
    .db.select()
    .from(permissionOverrides)
    .where(overrideWhere(scope, userId, scope === 'server' ? null : (scopeId ?? null)))
    .all();
  return c.json({ success: true, data: rows });
});

overrideRoutes.put(
  '/',
  zValidator(
    'json',
    overrideTargetSchema.extend({
      permission: z.string().min(1),
      effect: z.enum(['allow', 'deny']),
    })
  ),
  authorize(overrideResource),
  (c) => {
    const { userId, scope, scopeId, permission, effect } = c.req.valid('json');
    const authority = authorityAt(c, scope, scopeId);
    requireTarget(authority, userId);
    refuseUngrantable(scope, [permission]);
    refuseUnheld([permission], authority.holds);
    const where = and(
      overrideWhere(scope, userId, authority.scopeId),
      eq(permissionOverrides.permission, permission)
    );
    refuseOverOwner(
      c,
      authority,
      appContext().db.select().from(permissionOverrides).where(where).get()?.setBy
    );
    const saved = writeAt(scope, (tx) => {
      tx.delete(permissionOverrides).where(where).run();
      return tx
        .insert(permissionOverrides)
        .values({
          userId,
          scope,
          scopeId: authority.scopeId,
          permission,
          effect,
          setBy: c.get('user').id,
        })
        .returning()
        .get();
    });
    return c.json({ success: true, data: saved });
  }
);

overrideRoutes.delete(
  '/',
  zValidator('query', overrideTargetSchema.extend({ permission: z.string().min(1) })),
  authorize(overrideResource),
  (c) => {
    const { userId, scope, scopeId, permission } = c.req.valid('query');
    const authority = authorityAt(c, scope, scopeId);
    refuseUnheld([permission], authority.holds);
    const where = and(
      overrideWhere(scope, userId, authority.scopeId),
      eq(permissionOverrides.permission, permission)
    );
    const existing = appContext().db.select().from(permissionOverrides).where(where).get();
    if (!existing) throw new NotFoundError('Override');
    refuseOverOwner(c, authority, existing.setBy);
    writeAt(scope, (tx) => tx.delete(permissionOverrides).where(where).run());
    return c.json({ success: true, message: 'Override removed' });
  }
);

export function vehiclePeople(c: Context) {
  const vehicleId = c.req.param('id') ?? '';
  const vehicle: Resource = { kind: 'vehicle', vehicleId };
  const caller = requestResolver(c);
  enforce(caller.can('vehicle.share.read', vehicle), 'Vehicle');
  const detailed = caller.can('vehicle.share.manage', vehicle).allow;
  const db = appContext().db;
  const owner = db
    .select({ id: vehicles.userId })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .get();
  const memberIds = db
    .select({ id: vehicleShares.sharedWithId })
    .from(vehicleShares)
    .where(and(eq(vehicleShares.vehicleId, vehicleId), eq(vehicleShares.status, 'accepted')))
    .all()
    .flatMap((row) => (row.id ? [row.id] : []));
  const people = db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [owner?.id ?? '', ...memberIds]))
    .all()
    .map((person) => {
      const heldRoles = db
        .select({ id: roles.id, key: roles.key, name: roles.name, builtIn: roles.builtIn })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(and(eq(roleAssignments.userId, person.id), eq(roleAssignments.scopeId, vehicleId)))
        .all();
      const owned = person.id === owner?.id;
      if (!detailed) {
        return {
          displayName: person.displayName,
          owner: owned,
          roles: heldRoles.map(({ name }) => ({ name })),
        };
      }
      const resolver = syncResolverFor(db, person.id);
      return {
        userId: person.id,
        displayName: person.displayName,
        owner: owned,
        roles: heldRoles,
        overrides: db
          .select({
            permission: permissionOverrides.permission,
            effect: permissionOverrides.effect,
          })
          .from(permissionOverrides)
          .where(overrideWhere('vehicle', person.id, vehicleId))
          .all(),
        permissions: VEHICLE_PERMISSIONS.flatMap(({ id }) => {
          const decision = resolver.can(id, vehicle);
          return decision.allow
            ? [{ permission: id, via: decision.via, roleIds: decision.roleIds }]
            : [];
        }),
      };
    });
  return c.json({ success: true, data: people });
}
