import { and, eq } from 'drizzle-orm';
import type { AsyncHandle } from '../../db/async-sqlite';
import { firstRow } from '../../db/first-row';
import {
  permissionOverrides,
  roleAssignments,
  roles,
  users,
  vehicleShares,
  vehicles,
} from '../../db/schema';
import {
  isVehicleMember,
  type perPersonVehicleGrants,
  refuseUngrantable,
} from '../../permissions/grants';
import { DEMO_ROLE_KEY } from '../../permissions/roles';

export type LiveVehicleGrants = Awaited<ReturnType<typeof perPersonVehicleGrants>>;

export type DroppedGrantReason =
  | 'vehicle_not_restored'
  | 'person_not_active'
  | 'granted_by_non_member'
  | 'role_not_assignable'
  | 'permission_not_grantable';

export interface DroppedGrant {
  kind: 'role' | 'override';
  vehicleId: string;
  reason: DroppedGrantReason;
}

export interface RegrantReport {
  reapplied: number;
  dropped: DroppedGrant[];
}

async function carCheck(
  tx: AsyncHandle,
  ownerId: string,
  vehicleId: string
): Promise<DroppedGrantReason | null> {
  const car = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, ownerId)))
    .then(firstRow);
  return car ? null : 'vehicle_not_restored';
}

async function denyCheck(
  tx: AsyncHandle,
  ownerId: string,
  vehicleId: string,
  userId: string
): Promise<DroppedGrantReason | null> {
  const noCar = await carCheck(tx, ownerId, vehicleId);
  if (noCar) return noCar;
  const share = await tx
    .select({ id: vehicleShares.id })
    .from(vehicleShares)
    .where(and(eq(vehicleShares.vehicleId, vehicleId), eq(vehicleShares.sharedWithId, userId)))
    .then(firstRow);
  return share ? null : 'person_not_active';
}

async function personCheck(
  tx: AsyncHandle,
  ownerId: string,
  vehicleId: string,
  userId: string,
  grantor: string | null
): Promise<DroppedGrantReason | null> {
  const noCar = await carCheck(tx, ownerId, vehicleId);
  if (noCar) return noCar;
  if (!(await isVehicleMember(tx, vehicleId, userId))) return 'person_not_active';
  const person = await tx
    .select({ disabledAt: users.disabledAt, pendingApprovalAt: users.pendingApprovalAt })
    .from(users)
    .where(eq(users.id, userId))
    .then(firstRow);
  if (!person || person.disabledAt || person.pendingApprovalAt) return 'person_not_active';
  if (grantor !== ownerId && !(grantor && (await isVehicleMember(tx, vehicleId, grantor)))) {
    return 'granted_by_non_member';
  }
  return null;
}

async function assignableRole(tx: AsyncHandle, ownerId: string, roleId: string): Promise<boolean> {
  const role = await tx.select().from(roles).where(eq(roles.id, roleId)).then(firstRow);
  if (role?.scope !== 'vehicle') return false;
  if (role.builtIn) return role.key !== DEMO_ROLE_KEY;
  return role.ownerUserId === ownerId;
}

function grantablePermission(permission: string): boolean {
  try {
    refuseUngrantable('vehicle', [permission]);
    return true;
  } catch {
    return false;
  }
}

type Assignment = LiveVehicleGrants['assignments'][number];
type Override = LiveVehicleGrants['overrides'][number];

type Outcome = DroppedGrantReason | 'reapplied' | 'unchanged';

async function reapplyAssignment(
  tx: AsyncHandle,
  ownerId: string,
  row: Assignment & { scopeId: string }
): Promise<Outcome> {
  const reason = await personCheck(tx, ownerId, row.scopeId, row.userId, row.grantedBy);
  if (reason) return reason;
  if (!(await assignableRole(tx, ownerId, row.roleId))) return 'role_not_assignable';
  const inserted = await tx
    .insert(roleAssignments)
    .values({
      userId: row.userId,
      roleId: row.roleId,
      scopeId: row.scopeId,
      grantedBy: row.grantedBy,
    })
    .onConflictDoNothing()
    .returning({ id: roleAssignments.id });
  return inserted.length > 0 ? 'reapplied' : 'unchanged';
}

async function reapplyOverride(
  tx: AsyncHandle,
  ownerId: string,
  row: Override & { scopeId: string }
): Promise<Outcome> {
  const allow = row.effect === 'allow';
  const reason = allow
    ? await personCheck(tx, ownerId, row.scopeId, row.userId, row.setBy)
    : await denyCheck(tx, ownerId, row.scopeId, row.userId);
  if (reason) return reason;
  if (allow && (row.scope !== 'vehicle' || !grantablePermission(row.permission))) {
    return 'permission_not_grantable';
  }
  const inserted = await tx
    .insert(permissionOverrides)
    .values({
      userId: row.userId,
      scope: row.scope,
      scopeId: row.scopeId,
      permission: row.permission,
      effect: allow ? 'allow' : 'deny',
      setBy: row.setBy,
    })
    .onConflictDoNothing()
    .returning({ id: permissionOverrides.id });
  return inserted.length > 0 ? 'reapplied' : 'unchanged';
}

export async function reapplyVehicleGrants(
  tx: AsyncHandle,
  ownerId: string,
  live: LiveVehicleGrants
): Promise<RegrantReport> {
  const report: RegrantReport = { reapplied: 0, dropped: [] };
  const record = (kind: DroppedGrant['kind'], row: { scopeId: string }, outcome: Outcome) => {
    if (outcome === 'reapplied') report.reapplied++;
    else if (outcome !== 'unchanged') {
      report.dropped.push({ kind, vehicleId: row.scopeId, reason: outcome });
    }
  };
  for (const row of live.assignments) {
    if (!row.scopeId) continue;
    const scoped = { ...row, scopeId: row.scopeId };
    record('role', scoped, await reapplyAssignment(tx, ownerId, scoped));
  }
  for (const row of live.overrides) {
    if (!row.scopeId) continue;
    const scoped = { ...row, scopeId: row.scopeId };
    record('override', scoped, await reapplyOverride(tx, ownerId, scoped));
  }
  return report;
}
