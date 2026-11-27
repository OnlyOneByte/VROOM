import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { appContext } from '../../app-context';
import type { AsyncHandle } from '../../db/async-sqlite';
import { firstRow } from '../../db/first-row';
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
  resolverFor,
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

function inTransaction<T>(work: (tx: AsyncHandle) => Promise<T>): Promise<T> {
  return appContext().asyncDb.transaction(work);
}

function writeAt<T>(
  tx: AsyncHandle,
  scope: RoleScope,
  change: (tx: AsyncHandle) => Promise<T>
): Promise<T> {
  return scope === 'server' ? keepingARoleManager(appContext().asyncDb, change) : change(tx);
}

async function permissionsOf(db: AsyncHandle, roleId: string): Promise<string[]> {
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((row) => row.permission);
}

async function roleView(db: AsyncHandle, role: Role) {
  const { id, scope, key, name, color, builtIn, ownerUserId } = role;
  const permissions = await permissionsOf(db, id);
  return { id, scope, key, name, color, builtIn, ownerUserId, permissions };
}

async function findRole(db: AsyncHandle, id: string): Promise<Role> {
  const role = await db.select().from(roles).where(eq(roles.id, id)).then(firstRow);
  if (!role) throw new NotFoundError('Role');
  return role;
}

interface Authority {
  scopeId: string | null;
  ownerId: string | null;
  holds: (permission: string) => boolean;
}

async function authorityAt(
  c: Context,
  db: AsyncHandle,
  scope: RoleScope,
  scopeId: string | null | undefined
): Promise<Authority> {
  const resolver = requestResolver(c);
  if (scope === 'server') {
    if (scopeId) throw new ValidationError('A server role or override takes no scopeId');
    enforce(resolver.can(ROLE_MANAGE_PERMISSION, SERVER), 'Role');
    return { scopeId: null, ownerId: null, holds: (p) => resolver.can(p, SERVER).allow };
  }
  if (!scopeId) throw new ValidationError('A vehicle role or override needs the vehicle id');
  const vehicle: Resource = { kind: 'vehicle', vehicleId: scopeId };
  enforce(resolver.can('vehicle.share.manage', vehicle), 'Vehicle');
  const owner = await db
    .select({ id: vehicles.userId })
    .from(vehicles)
    .where(eq(vehicles.id, scopeId))
    .then(firstRow);
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

async function requireTarget(db: AsyncHandle, authority: Authority, userId: string) {
  if (authority.scopeId) {
    if (!(await isVehicleMember(db, authority.scopeId, userId))) throw new NotFoundError('Member');
    return;
  }
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .then(firstRow);
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

async function roleFor(c: Context, db: AsyncHandle, id: string, change: boolean): Promise<Role> {
  const role = await findRole(db, id);
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

roleRoutes.get('/', zValidator('query', z.object({ scope: z.enum(SCOPES) })), async (c) => {
  const { scope } = c.req.valid('query');
  const db = appContext().asyncDb;
  const rows = await db.select().from(roles).where(visibleRoles(c, scope)).orderBy(roles.createdAt);
  const data = [];
  for (const row of rows) data.push(await roleView(db, row));
  return c.json({ success: true, data });
});

roleRoutes.post('/', zValidator('json', createRoleSchema), async (c) => {
  const { scope, name, color, copyFrom } = c.req.valid('json');
  const ownerUserId = scope === 'vehicle' ? requireLibrary(c) : requireRoleManager(c);
  const data = await inTransaction(async (tx) => {
    const copied = copyFrom ? await roleFor(c, tx, copyFrom, false) : null;
    if (copied) refuseDemoRole(copied);
    if (copied && copied.scope !== scope) {
      throw new ValidationError('A role can only be copied into a role of the same scope');
    }
    const permissions = [
      ...new Set([
        ...(copied ? await permissionsOf(tx, copied.id) : []),
        ...c.req.valid('json').permissions,
      ]),
    ];
    refuseUngrantable(scope, permissions);
    refuseUnheld(permissions, holdsForRole(c, scope));
    const [created] = await tx
      .insert(roles)
      .values({ scope, name, color: color ?? null, ownerUserId })
      .returning();
    if (!created) throw new Error('Role insert returned no row');
    if (permissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(permissions.map((permission) => ({ roleId: created.id, permission })));
    }
    return roleView(tx, created);
  });
  return c.json({ success: true, data }, 201);
});

roleRoutes.patch(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateRoleSchema),
  async (c) => {
    const data = await inTransaction(async (tx) => {
      const role = await roleFor(c, tx, c.req.valid('param').id, true);
      const [updated] = await tx
        .update(roles)
        .set({ ...c.req.valid('json'), updatedAt: new Date() })
        .where(eq(roles.id, role.id))
        .returning();
      return roleView(tx, updated ?? role);
    });
    return c.json({ success: true, data });
  }
);

roleRoutes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  await inTransaction(async (tx) => {
    const role = await roleFor(c, tx, c.req.valid('param').id, true);
    await writeAt(tx, role.scope, (write) => write.delete(roles).where(eq(roles.id, role.id)));
  });
  return c.json({ success: true, message: 'Role deleted' });
});

roleRoutes.get('/:id/permissions', zValidator('param', commonSchemas.idParam), async (c) => {
  const db = appContext().asyncDb;
  const role = await roleFor(c, db, c.req.valid('param').id, false);
  return c.json({ success: true, data: { permissions: await permissionsOf(db, role.id) } });
});

roleRoutes.put(
  '/:id/permissions',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', z.strictObject({ permissions: permissionList })),
  async (c) => {
    const permissions = [...new Set(c.req.valid('json').permissions)];
    await inTransaction(async (tx) => {
      const role = await roleFor(c, tx, c.req.valid('param').id, true);
      const current = new Set(await permissionsOf(tx, role.id));
      refuseUngrantable(role.scope, permissions);
      refuseUnheld(
        permissions.filter((p) => !current.has(p)),
        holdsForRole(c, role.scope)
      );
      await writeAt(tx, role.scope, async (write) => {
        await write.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
        if (permissions.length > 0) {
          await write
            .insert(rolePermissions)
            .values(permissions.map((permission) => ({ roleId: role.id, permission })));
        }
      });
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

async function assignable(c: Context, tx: AsyncHandle, input: z.infer<typeof assignmentSchema>) {
  const role = await findRole(tx, input.roleId);
  const authority = await authorityAt(c, tx, role.scope, input.scopeId);
  if (role.scope === 'vehicle' && !role.builtIn && role.ownerUserId !== authority.ownerId) {
    throw new NotFoundError('Role');
  }
  await requireTarget(tx, authority, input.userId);
  refuseUnheld(await permissionsOf(tx, role.id), authority.holds);
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
  async (c) => {
    const input = c.req.valid('json');
    try {
      const created = await inTransaction(async (tx) => {
        refuseDemoRole(await findRole(tx, input.roleId));
        const { role, scopeId } = await assignable(c, tx, input);
        const [row] = await tx
          .insert(roleAssignments)
          .values({ userId: input.userId, roleId: role.id, scopeId, grantedBy: c.get('user').id })
          .returning();
        return row;
      });
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
  async (c) => {
    const input = c.req.valid('query');
    await inTransaction(async (tx) => {
      const { role, scopeId, authority } = await assignable(c, tx, input);
      const where = and(
        eq(roleAssignments.userId, input.userId),
        eq(roleAssignments.roleId, role.id),
        scopeId ? eq(roleAssignments.scopeId, scopeId) : isNull(roleAssignments.scopeId)
      );
      const existing = await tx.select().from(roleAssignments).where(where).then(firstRow);
      if (!existing) throw new NotFoundError('Role assignment');
      refuseOverOwner(c, authority, existing.grantedBy);
      await writeAt(tx, role.scope, (write) => write.delete(roleAssignments).where(where));
    });
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

overrideRoutes.get('/', zValidator('query', overrideTargetSchema), async (c) => {
  const { userId, scope, scopeId } = c.req.valid('query');
  const db = appContext().asyncDb;
  if (userId !== c.get('user').id) {
    await requireTarget(db, await authorityAt(c, db, scope, scopeId), userId);
  }
  const rows = await db
    .select()
    .from(permissionOverrides)
    .where(overrideWhere(scope, userId, scope === 'server' ? null : (scopeId ?? null)));
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
  async (c) => {
    const { userId, scope, scopeId, permission, effect } = c.req.valid('json');
    const saved = await inTransaction(async (tx) => {
      const authority = await authorityAt(c, tx, scope, scopeId);
      await requireTarget(tx, authority, userId);
      refuseUngrantable(scope, [permission]);
      refuseUnheld([permission], authority.holds);
      const where = and(
        overrideWhere(scope, userId, authority.scopeId),
        eq(permissionOverrides.permission, permission)
      );
      const existing = await tx.select().from(permissionOverrides).where(where).then(firstRow);
      refuseOverOwner(c, authority, existing?.setBy);
      return writeAt(tx, scope, async (write) => {
        await write.delete(permissionOverrides).where(where);
        const [row] = await write
          .insert(permissionOverrides)
          .values({
            userId,
            scope,
            scopeId: authority.scopeId,
            permission,
            effect,
            setBy: c.get('user').id,
          })
          .returning();
        return row;
      });
    });
    return c.json({ success: true, data: saved });
  }
);

overrideRoutes.delete(
  '/',
  zValidator('query', overrideTargetSchema.extend({ permission: z.string().min(1) })),
  authorize(overrideResource),
  async (c) => {
    const { userId, scope, scopeId, permission } = c.req.valid('query');
    await inTransaction(async (tx) => {
      const authority = await authorityAt(c, tx, scope, scopeId);
      refuseUnheld([permission], authority.holds);
      const where = and(
        overrideWhere(scope, userId, authority.scopeId),
        eq(permissionOverrides.permission, permission)
      );
      const existing = await tx.select().from(permissionOverrides).where(where).then(firstRow);
      if (!existing) throw new NotFoundError('Override');
      refuseOverOwner(c, authority, existing.setBy);
      await writeAt(tx, scope, (write) => write.delete(permissionOverrides).where(where));
    });
    return c.json({ success: true, message: 'Override removed' });
  }
);

export async function vehiclePeople(c: Context) {
  const vehicle = { kind: 'vehicle' as const, vehicleId: c.req.param('id') ?? '' };
  const caller = requestResolver(c);
  enforce(caller.can('vehicle.share.read', vehicle), 'Vehicle');
  const detailed = caller.can('vehicle.share.manage', vehicle).allow;
  const people = await appContext().asyncDb.transaction((tx) => peopleOn(tx, vehicle, detailed), {
    behavior: 'deferred',
  });
  return c.json({ success: true, data: people });
}

async function peopleOn(
  db: AsyncHandle,
  vehicle: Resource & { kind: 'vehicle' },
  detailed: boolean
) {
  const { vehicleId } = vehicle;
  const owner = await db
    .select({ id: vehicles.userId })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .then(firstRow);
  const members = await db
    .select({ id: vehicleShares.sharedWithId })
    .from(vehicleShares)
    .where(and(eq(vehicleShares.vehicleId, vehicleId), eq(vehicleShares.status, 'accepted')));
  const memberIds = members.flatMap((row) => (row.id ? [row.id] : []));
  const persons = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [owner?.id ?? '', ...memberIds]));
  const people = [];
  for (const person of persons) {
    const heldRoles = await db
      .select({ id: roles.id, key: roles.key, name: roles.name, builtIn: roles.builtIn })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.userId, person.id), eq(roleAssignments.scopeId, vehicleId)));
    const owned = person.id === owner?.id;
    if (!detailed) {
      people.push({
        displayName: person.displayName,
        owner: owned,
        roles: heldRoles.map(({ name }) => ({ name })),
      });
      continue;
    }
    const resolver = await resolverFor(person.id, [vehicle], db);
    const overrides = await db
      .select({ permission: permissionOverrides.permission, effect: permissionOverrides.effect })
      .from(permissionOverrides)
      .where(overrideWhere('vehicle', person.id, vehicleId));
    people.push({
      userId: person.id,
      displayName: person.displayName,
      owner: owned,
      roles: heldRoles,
      overrides,
      permissions: VEHICLE_PERMISSIONS.flatMap(({ id }) => {
        const decision = resolver.can(id, vehicle);
        return decision.allow
          ? [{ permission: id, via: decision.via, roleIds: decision.roleIds }]
          : [];
      }),
    });
  }
  return people;
}
