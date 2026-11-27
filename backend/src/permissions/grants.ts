import { and, eq, inArray, isNull, notInArray, type SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import { appContext } from '../app-context';
import type { AsyncAppDatabase } from '../db/async-sqlite';
import type { AppDatabase } from '../db/connection';
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
import type { DrizzleTransaction } from '../db/types';
import { ConflictError, ForbiddenError, ScopeNotLoadedError, ValidationError } from '../errors';
import { PERMISSION_REGISTRY } from './registry';
import {
  type Actor,
  type AsyncGrantSource,
  createLoadingResolver,
  createResolver,
  type GrantSource,
  type HeldRole,
  type LoadingResolver,
  type Resolver,
  type Resource,
  type ScopeGrants,
} from './resolve';
import { DEMO_ROLE_KEY, ROLE_REACH, ROLE_TEMPLATES, type RoleScope } from './roles';

type Db = AppDatabase | DrizzleTransaction;

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

export function syncBuiltInRoles(db: AppDatabase): void {
  db.transaction((tx) => {
    tx.update(roles)
      .set({ key: null })
      .where(
        and(
          eq(roles.builtIn, false),
          inArray(
            roles.key,
            ROLE_TEMPLATES.map((template) => template.key)
          )
        )
      )
      .run();
    for (const template of ROLE_TEMPLATES) {
      const id = builtInRoleId(template.key);
      tx.insert(roles)
        .values({
          id,
          scope: template.scope,
          key: template.key,
          name: template.name,
          builtIn: true,
        })
        .onConflictDoUpdate({ target: roles.id, set: { name: template.name, builtIn: true } })
        .run();
      tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id)).run();
      tx.insert(rolePermissions)
        .values(template.permissions.map((permission) => ({ roleId: id, permission })))
        .run();
    }
  });
}

export function assignServerRole(db: Db, userId: string, key: string): void {
  db.insert(roleAssignments)
    .values({ userId, roleId: builtInRoleId(key), scopeId: null })
    .onConflictDoNothing()
    .run();
}

export function shareRoleId(level: string): string {
  return builtInRoleId(level === 'editor' ? 'editor' : 'viewer');
}

export function grantShareRole(
  db: Db,
  share: { vehicleId: string; sharedWithId: string; level: string; grantedBy: string }
): void {
  db.insert(roleAssignments)
    .values({
      userId: share.sharedWithId,
      roleId: shareRoleId(share.level),
      scopeId: share.vehicleId,
      grantedBy: share.grantedBy,
    })
    .onConflictDoNothing()
    .run();
}

export function changeShareRole(
  db: Db,
  share: { vehicleId: string; sharedWithId: string; level: string; grantedBy: string }
): void {
  db.delete(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, share.sharedWithId),
        eq(roleAssignments.scopeId, share.vehicleId),
        inArray(roleAssignments.roleId, [shareRoleId('editor'), shareRoleId('viewer')])
      )
    )
    .run();
  grantShareRole(db, share);
}

export function endVehicleMembership(db: Db, vehicleId: string, userId: string): void {
  db.update(vehicleDrivers)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(vehicleDrivers.vehicleId, vehicleId),
        eq(vehicleDrivers.userId, userId),
        isNull(vehicleDrivers.archivedAt)
      )
    )
    .run();
  db.delete(roleAssignments)
    .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.scopeId, vehicleId)))
    .run();
  db.delete(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.userId, userId),
        eq(permissionOverrides.scope, 'vehicle'),
        eq(permissionOverrides.scopeId, vehicleId)
      )
    )
    .run();
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

function actorQuery(db: AsyncAppDatabase, userId: string) {
  return db
    .select(ACTOR_COLUMNS)
    .from(users)
    .leftJoin(roleAssignments, demoRoleJoin())
    .where(eq(users.id, userId));
}

function heldRoles(tx: Db, where: SQL | undefined): HeldRole[] {
  const rows = tx
    .select({ id: roles.id, key: roles.key, builtIn: roles.builtIn })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(where)
    .all();
  if (rows.length === 0) return [];
  const permissions = tx
    .select()
    .from(rolePermissions)
    .where(
      inArray(
        rolePermissions.roleId,
        rows.map((row) => row.id)
      )
    )
    .all();
  return rows.map((row) => ({
    id: row.id,
    permissions: permissions.filter((p) => p.roleId === row.id).map((p) => p.permission),
    builtInDemo: row.builtIn && row.key === DEMO_ROLE_KEY,
  }));
}

export function isVehicleMember(db: Db, vehicleId: string, userId: string): boolean {
  const share = db
    .select({ id: vehicleShares.id })
    .from(vehicleShares)
    .where(memberWhere(vehicleId, userId))
    .get();
  return share !== undefined;
}

function syncGrantSource(tx: Db): GrantSource {
  return {
    serverGrants: (userId) => ({
      roles: heldRoles(tx, serverRolesWhere(userId)),
      overrides: tx
        .select(OVERRIDE_COLUMNS)
        .from(permissionOverrides)
        .where(overridesWhere(userId, 'server', null))
        .all(),
    }),
    vehicleFacts: (userId, vehicleId) => {
      const vehicle = tx
        .select({ ownerId: vehicles.userId })
        .from(vehicles)
        .where(eq(vehicles.id, vehicleId))
        .get();
      if (!vehicle) return null;
      const owner = vehicle.ownerId === userId;
      const member = !owner && isVehicleMember(tx, vehicleId, userId);
      const grants: ScopeGrants = member
        ? {
            roles: heldRoles(tx, vehicleRolesWhere(userId, vehicleId)),
            overrides: tx
              .select(OVERRIDE_COLUMNS)
              .from(permissionOverrides)
              .where(overridesWhere(userId, 'vehicle', vehicleId))
              .all(),
          }
        : { roles: [], overrides: [] };
      const demoGarage =
        !owner &&
        !member &&
        tx
          .select({ id: roles.id })
          .from(roleAssignments)
          .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
          .where(builtInDemoWhere(vehicle.ownerId))
          .get() !== undefined;
      return { owner, member, demoGarage, grants };
    },
  };
}

export function syncResolverFor(tx: Db, userId: string): Resolver {
  const row = tx
    .select(ACTOR_COLUMNS)
    .from(users)
    .leftJoin(roleAssignments, demoRoleJoin())
    .where(eq(users.id, userId))
    .get();
  const actor = { userId, disabled: !row || row.disabledAt !== null, demo: Boolean(row?.demoRole) };
  return createResolver(actor, syncGrantSource(tx));
}

async function heldRolesAsync(db: AsyncAppDatabase, where: SQL | undefined): Promise<HeldRole[]> {
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

function asyncGrantSource(db: AsyncAppDatabase): AsyncGrantSource {
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
        .get();
      if (!vehicle) return null;
      const owner = vehicle.ownerId === userId;
      const member =
        !owner &&
        (await db
          .select({ id: vehicleShares.id })
          .from(vehicleShares)
          .where(memberWhere(vehicleId, userId))
          .get()) !== undefined;
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
          .get()) !== undefined;
      return { owner, member, demoGarage, grants };
    },
  };
}

async function actorForAsync(db: AsyncAppDatabase, userId: string): Promise<Actor> {
  const row = await actorQuery(db, userId).get();
  return { userId, disabled: !row || row.disabledAt !== null, demo: Boolean(row?.demoRole) };
}

export async function loadingResolverFor(
  userId: string,
  db: AsyncAppDatabase = appContext().asyncDb
): Promise<LoadingResolver> {
  return createLoadingResolver(await actorForAsync(db, userId), asyncGrantSource(db));
}

export async function resolverFor(
  userId: string,
  resources: readonly Resource[],
  db: AsyncAppDatabase = appContext().asyncDb
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

function roleManagerCount(db: DrizzleTransaction): number {
  const viaRoles = db
    .selectDistinct({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
    .where(
      and(isNull(roleAssignments.scopeId), eq(rolePermissions.permission, ROLE_MANAGE_PERMISSION))
    )
    .all();
  const viaOverrides = db
    .selectDistinct({ userId: permissionOverrides.userId })
    .from(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.scope, 'server'),
        eq(permissionOverrides.permission, ROLE_MANAGE_PERMISSION),
        eq(permissionOverrides.effect, 'allow')
      )
    )
    .all();
  const candidates = new Set([...viaRoles, ...viaOverrides].map((row) => row.userId));
  return [...candidates].filter(
    (userId) => syncResolverFor(db, userId).can(ROLE_MANAGE_PERMISSION, { kind: 'server' }).allow
  ).length;
}

export function keepingARoleManager<T>(db: AppDatabase, change: (tx: DrizzleTransaction) => T): T {
  return db.transaction((tx) => {
    const before = roleManagerCount(tx);
    const result = change(tx);
    if (before > 0 && roleManagerCount(tx) === 0) {
      throw new ConflictError('At least one person must keep the permission to manage roles');
    }
    return result;
  });
}

export function hasPerPersonVehicleGrants(db: Db, ownerId: string): boolean {
  const owned = db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.userId, ownerId));
  const override = db
    .select({ id: permissionOverrides.id })
    .from(permissionOverrides)
    .where(inArray(permissionOverrides.scopeId, owned))
    .get();
  const customRole = db
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        inArray(roleAssignments.scopeId, owned),
        notInArray(roleAssignments.roleId, [shareRoleId('editor'), shareRoleId('viewer')])
      )
    )
    .get();
  return override !== undefined || customRole !== undefined;
}
