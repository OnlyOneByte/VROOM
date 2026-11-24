import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
import {
  permissionOverrides,
  roleAssignments,
  rolePermissions,
  roles,
  users,
  vehicleShares,
  vehicles,
} from '../db/schema';
import type { DrizzleTransaction } from '../db/types';
import { ForbiddenError, ValidationError } from '../errors';
import { PERMISSION_REGISTRY } from './registry';
import {
  type Actor,
  createResolver,
  type GrantSource,
  type HeldRole,
  type Resolver,
  type ScopeGrants,
} from './resolve';
import { DEMO_ROLE_KEY, ROLE_REACH, ROLE_TEMPLATES, type RoleScope } from './roles';

type Db = AppDatabase | DrizzleTransaction;

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

function heldRoles(db: Db, where: SQL | undefined): HeldRole[] {
  const rows = db
    .select({ id: roles.id, key: roles.key, builtIn: roles.builtIn })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(where)
    .all();
  if (rows.length === 0) return [];
  const permissions = db
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

function overridesAt(db: Db, userId: string, scope: 'server' | 'vehicle', scopeId: string | null) {
  return db
    .select({ permission: permissionOverrides.permission, effect: permissionOverrides.effect })
    .from(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.userId, userId),
        eq(permissionOverrides.scope, scope),
        scopeId === null
          ? isNull(permissionOverrides.scopeId)
          : eq(permissionOverrides.scopeId, scopeId)
      )
    )
    .all();
}

function holdsBuiltInDemo(db: Db, userId: string): boolean {
  const row = db
    .select({ id: roles.id })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(
      and(
        eq(roleAssignments.userId, userId),
        isNull(roleAssignments.scopeId),
        eq(roles.builtIn, true),
        eq(roles.key, DEMO_ROLE_KEY)
      )
    )
    .get();
  return row !== undefined;
}

export function isVehicleMember(db: Db, vehicleId: string, userId: string): boolean {
  const share = db
    .select({ id: vehicleShares.id })
    .from(vehicleShares)
    .where(
      and(
        eq(vehicleShares.vehicleId, vehicleId),
        eq(vehicleShares.sharedWithId, userId),
        eq(vehicleShares.status, 'accepted')
      )
    )
    .get();
  return share !== undefined;
}

export function dbGrantSource(db: Db): GrantSource {
  const serverGrants = (userId: string): ScopeGrants => ({
    roles: heldRoles(
      db,
      and(
        eq(roleAssignments.userId, userId),
        isNull(roleAssignments.scopeId),
        eq(roles.scope, 'server')
      )
    ),
    overrides: overridesAt(db, userId, 'server', null),
  });
  return {
    serverGrants,
    vehicleFacts: (userId, vehicleId) => {
      const vehicle = db
        .select({ ownerId: vehicles.userId })
        .from(vehicles)
        .where(eq(vehicles.id, vehicleId))
        .get();
      if (!vehicle) return null;
      const owner = vehicle.ownerId === userId;
      const member = !owner && isVehicleMember(db, vehicleId, userId);
      const grants: ScopeGrants = member
        ? {
            roles: heldRoles(
              db,
              and(
                eq(roleAssignments.userId, userId),
                eq(roleAssignments.scopeId, vehicleId),
                eq(roles.scope, 'vehicle')
              )
            ),
            overrides: overridesAt(db, userId, 'vehicle', vehicleId),
          }
        : { roles: [], overrides: [] };
      const demoGarage = !owner && !member && holdsBuiltInDemo(db, vehicle.ownerId);
      return { owner, member, demoGarage, grants };
    },
  };
}

export function actorFor(db: Db, userId: string): Actor {
  const row = db
    .select({ disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return { userId, disabled: !row || row.disabledAt !== null };
}

export function resolverFor(db: Db, userId: string): Resolver {
  return createResolver(actorFor(db, userId), dbGrantSource(db));
}
