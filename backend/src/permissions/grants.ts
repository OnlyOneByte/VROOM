import { and, eq, inArray, isNotNull, isNull, notInArray, type SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import { appContext } from '../app-context';
import type { AsyncAppDatabase, AsyncHandle, AsyncTransaction } from '../db/async-sqlite';
import { firstRow } from '../db/first-row';
import {
  permissionOverrides,
  roleAssignments,
  rolePermissions,
  roles,
  users,
  vehicleDrivers,
  vehicleShares,
  vehicles,
} from '../db/schema';
import { ConflictError, ForbiddenError, ScopeNotLoadedError, ValidationError } from '../errors';
import { PERMISSION_REGISTRY } from './registry';
import {
  type Actor,
  type AsyncGrantSource,
  createLoadingResolver,
  type HeldRole,
  type LoadingResolver,
  type Resolver,
  type Resource,
  type ScopeGrants,
} from './resolve';
import { DEMO_ROLE_KEY, ROLE_REACH, ROLE_TEMPLATES, type RoleScope } from './roles';

declare module 'hono' {
  interface ContextVariableMap {
    resolver: LoadingResolver;
  }
}

export const ROLE_MANAGE_PERMISSION = 'server.roles.manage';

export function refuseUngrantable(scope: RoleScope, permissions: readonly string[]): void {
  for (const permission of permissions) {
    const descriptor = PERMISSION_REGISTRY.get(permission);
    if (!descriptor) throw new ValidationError(`"${permission}" is not a known permission`);
    if (!descriptor.grantable) {
      throw new ValidationError(
        `"${permission}" belongs to the vehicle owner and can't be granted`
      );
    }
    if (!ROLE_REACH[scope].includes(descriptor.scope)) {
      throw new ValidationError(`A ${scope} role or override can't hold "${permission}"`);
    }
  }
}

export function refuseUnheld(
  permissions: readonly string[],
  holds: (permission: string) => boolean
): void {
  const missing = permissions.filter((permission) => !holds(permission));
  if (missing.length > 0) {
    throw new ForbiddenError(`You can only grant permissions you hold: ${missing.join(', ')}`);
  }
}

export function builtInRoleId(key: string): string {
  return `builtin_${key}`;
}

export async function syncBuiltInRoles(asyncDb: AsyncAppDatabase): Promise<void> {
  await asyncDb.transaction(async (tx) => {
    await tx
      .update(roles)
      .set({ key: null })
      .where(
        and(
          eq(roles.builtIn, false),
          inArray(
            roles.key,
            ROLE_TEMPLATES.map((template) => template.key)
          )
        )
      );
    for (const template of ROLE_TEMPLATES) {
      const id = builtInRoleId(template.key);
      await tx
        .insert(roles)
        .values({
          id,
          scope: template.scope,
          key: template.key,
          name: template.name,
          builtIn: true,
        })
        .onConflictDoUpdate({ target: roles.id, set: { name: template.name, builtIn: true } });
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      await tx
        .insert(rolePermissions)
        .values(template.permissions.map((permission) => ({ roleId: id, permission })));
    }
  });
}

export async function assignServerRole(
  db: AsyncHandle,
  userId: string,
  key: string
): Promise<void> {
  await db
    .insert(roleAssignments)
    .values({ userId, roleId: builtInRoleId(key), scopeId: null })
    .onConflictDoNothing();
}

export function shareRoleId(level: string): string {
  return builtInRoleId(level === 'editor' ? 'editor' : 'viewer');
}

interface ShareGrant {
  vehicleId: string;
  sharedWithId: string;
  level: string;
  grantedBy: string;
}

function shareRoleValues(share: ShareGrant) {
  return {
    userId: share.sharedWithId,
    roleId: shareRoleId(share.level),
    scopeId: share.vehicleId,
    grantedBy: share.grantedBy,
  };
}

function shareRolesWhere(share: ShareGrant): SQL | undefined {
  return and(
    eq(roleAssignments.userId, share.sharedWithId),
    eq(roleAssignments.scopeId, share.vehicleId),
    inArray(roleAssignments.roleId, [shareRoleId('editor'), shareRoleId('viewer')])
  );
}

export async function grantShareRole(db: AsyncHandle, share: ShareGrant): Promise<void> {
  await db.insert(roleAssignments).values(shareRoleValues(share)).onConflictDoNothing();
}

export async function changeShareRole(db: AsyncHandle, share: ShareGrant): Promise<void> {
  await db.delete(roleAssignments).where(shareRolesWhere(share));
  await grantShareRole(db, share);
}

export async function endVehicleMembership(
  db: AsyncHandle,
  vehicleId: string,
  userId: string
): Promise<void> {
  await db
    .update(vehicleDrivers)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(vehicleDrivers.vehicleId, vehicleId),
        eq(vehicleDrivers.userId, userId),
        isNull(vehicleDrivers.archivedAt)
      )
    );
  await db
    .delete(roleAssignments)
    .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.scopeId, vehicleId)));
  await db
    .delete(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.userId, userId),
        eq(permissionOverrides.scope, 'vehicle'),
        eq(permissionOverrides.scopeId, vehicleId)
      )
    );
}

const OVERRIDE_COLUMNS = {
  permission: permissionOverrides.permission,
  effect: permissionOverrides.effect,
};

function serverRolesWhere(userId: string): SQL | undefined {
  return and(
    eq(roleAssignments.userId, userId),
    isNull(roleAssignments.scopeId),
    eq(roles.scope, 'server')
  );
}

function vehicleRolesWhere(userId: string, vehicleId: string): SQL | undefined {
  return and(
    eq(roleAssignments.userId, userId),
    eq(roleAssignments.scopeId, vehicleId),
    eq(roles.scope, 'vehicle')
  );
}

function overridesWhere(
  userId: string,
  scope: 'server' | 'vehicle',
  scopeId: string | null
): SQL | undefined {
  return and(
    eq(permissionOverrides.userId, userId),
    eq(permissionOverrides.scope, scope),
    scopeId === null
      ? isNull(permissionOverrides.scopeId)
      : eq(permissionOverrides.scopeId, scopeId)
  );
}

function builtInDemoWhere(userId: string): SQL | undefined {
  return and(
    eq(roleAssignments.userId, userId),
    isNull(roleAssignments.scopeId),
    eq(roles.builtIn, true),
    eq(roles.key, DEMO_ROLE_KEY)
  );
}

function memberWhere(vehicleId: string, userId: string): SQL | undefined {
  return and(
    eq(vehicleShares.vehicleId, vehicleId),
    eq(vehicleShares.sharedWithId, userId),
    eq(vehicleShares.status, 'accepted')
  );
}

function demoRoleJoin(): SQL | undefined {
  return and(
    eq(roleAssignments.userId, users.id),
    isNull(roleAssignments.scopeId),
    eq(roleAssignments.roleId, builtInRoleId(DEMO_ROLE_KEY))
  );
}

const ACTOR_COLUMNS = { disabledAt: users.disabledAt, demoRole: roleAssignments.id };

function actorQuery(db: AsyncHandle, userId: string) {
  return db
    .select(ACTOR_COLUMNS)
    .from(users)
    .leftJoin(roleAssignments, demoRoleJoin())
    .where(eq(users.id, userId));
}

export async function isVehicleMember(
  db: AsyncHandle,
  vehicleId: string,
  userId: string
): Promise<boolean> {
  const share = await db
    .select({ id: vehicleShares.id })
    .from(vehicleShares)
    .where(memberWhere(vehicleId, userId))
    .then(firstRow);
  return share !== undefined;
}

async function heldRolesAsync(db: AsyncHandle, where: SQL | undefined): Promise<HeldRole[]> {
  const rows = await db
    .select({ id: roles.id, key: roles.key, builtIn: roles.builtIn })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(where);
  if (rows.length === 0) return [];
  const permissions = await db
    .select()
    .from(rolePermissions)
    .where(
      inArray(
        rolePermissions.roleId,
        rows.map((row) => row.id)
      )
    );
  return rows.map((row) => ({
    id: row.id,
    permissions: permissions.filter((p) => p.roleId === row.id).map((p) => p.permission),
    builtInDemo: row.builtIn && row.key === DEMO_ROLE_KEY,
  }));
}

function asyncGrantSource(db: AsyncHandle): AsyncGrantSource {
  return {
    serverGrants: async (userId) => ({
      roles: await heldRolesAsync(db, serverRolesWhere(userId)),
      overrides: await db
        .select(OVERRIDE_COLUMNS)
        .from(permissionOverrides)
        .where(overridesWhere(userId, 'server', null)),
    }),
    vehicleFacts: async (userId, vehicleId) => {
      const vehicle = await db
        .select({ ownerId: vehicles.userId })
        .from(vehicles)
        .where(eq(vehicles.id, vehicleId))
        .then(firstRow);
      if (!vehicle) return null;
      const owner = vehicle.ownerId === userId;
      const member = !owner && (await isVehicleMember(db, vehicleId, userId));
      const grants: ScopeGrants = member
        ? {
            roles: await heldRolesAsync(db, vehicleRolesWhere(userId, vehicleId)),
            overrides: await db
              .select(OVERRIDE_COLUMNS)
              .from(permissionOverrides)
              .where(overridesWhere(userId, 'vehicle', vehicleId)),
          }
        : { roles: [], overrides: [] };
      const demoGarage =
        !owner &&
        !member &&
        (await db
          .select({ id: roles.id })
          .from(roleAssignments)
          .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
          .where(builtInDemoWhere(vehicle.ownerId))
          .then(firstRow)) !== undefined;
      return { owner, member, demoGarage, grants };
    },
  };
}

async function actorForAsync(db: AsyncHandle, userId: string): Promise<Actor> {
  const row = await actorQuery(db, userId).then(firstRow);
  return { userId, disabled: !row || row.disabledAt !== null, demo: Boolean(row?.demoRole) };
}

export async function loadingResolverFor(
  userId: string,
  db: AsyncHandle = appContext().asyncDb
): Promise<LoadingResolver> {
  return createLoadingResolver(await actorForAsync(db, userId), asyncGrantSource(db));
}

export async function resolverFor(
  userId: string,
  resources: readonly Resource[],
  db: AsyncHandle = appContext().asyncDb
): Promise<Resolver> {
  const resolver = await loadingResolverFor(userId, db);
  await resolver.load(resources);
  return resolver;
}

export function vehicleResources(vehicleIds: Iterable<string>): Resource[] {
  return [...vehicleIds].map((vehicleId) => ({ kind: 'vehicle', vehicleId }));
}

const creating = new WeakMap<Context, Promise<LoadingResolver>>();

export async function loadResolver(
  c: Context,
  resources: readonly Resource[]
): Promise<LoadingResolver> {
  let resolver = c.get('resolver');
  if (!resolver) {
    let pending = creating.get(c);
    if (!pending) {
      pending = loadingResolverFor(c.get('user').id);
      creating.set(c, pending);
    }
    resolver = await pending;
    c.set('resolver', resolver);
  }
  await resolver.load(resources);
  return resolver;
}

export function requestResolver(c: Context): Resolver {
  const resolver = c.get('resolver');
  if (!resolver) throw new ScopeNotLoadedError('request');
  return resolver;
}

async function roleManagerCount(tx: AsyncHandle): Promise<number> {
  const viaRoles = await tx
    .selectDistinct({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
    .where(
      and(isNull(roleAssignments.scopeId), eq(rolePermissions.permission, ROLE_MANAGE_PERMISSION))
    );
  const viaOverrides = await tx
    .selectDistinct({ userId: permissionOverrides.userId })
    .from(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.scope, 'server'),
        eq(permissionOverrides.permission, ROLE_MANAGE_PERMISSION),
        eq(permissionOverrides.effect, 'allow')
      )
    );
  const candidates = [...new Set([...viaRoles, ...viaOverrides].map((row) => row.userId))];
  if (candidates.length === 0) return 0;
  const waiting = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, candidates), isNotNull(users.pendingApprovalAt)));
  const waitingIds = new Set(waiting.map((row) => row.id));
  const server: Resource = { kind: 'server' };
  let count = 0;
  for (const userId of candidates) {
    if (waitingIds.has(userId)) continue;
    const resolver = await resolverFor(userId, [server], tx);
    if (resolver.can(ROLE_MANAGE_PERMISSION, server).allow) count++;
  }
  return count;
}

export async function keepingARoleManagerIn<T>(
  tx: AsyncHandle,
  change: () => Promise<T>
): Promise<T> {
  const before = await roleManagerCount(tx);
  const result = await change();
  if (before > 0 && (await roleManagerCount(tx)) === 0) {
    throw new ConflictError('At least one person must keep the permission to manage roles');
  }
  return result;
}

export async function keepingARoleManager<T>(
  asyncDb: AsyncAppDatabase,
  change: (tx: AsyncTransaction) => Promise<T>
): Promise<T> {
  return asyncDb.transaction((tx) => keepingARoleManagerIn(tx, () => change(tx)));
}

export async function perPersonVehicleGrants(db: AsyncHandle, ownerId: string) {
  const owned = db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.userId, ownerId));
  const overrides = await db
    .select()
    .from(permissionOverrides)
    .where(inArray(permissionOverrides.scopeId, owned));
  const assignments = await db
    .select()
    .from(roleAssignments)
    .where(
      and(
        inArray(roleAssignments.scopeId, owned),
        notInArray(roleAssignments.roleId, [shareRoleId('editor'), shareRoleId('viewer')])
      )
    );
  return { overrides, assignments };
}
