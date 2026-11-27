import { and, eq } from 'drizzle-orm';
import type { AsyncHandle } from '../../db/async-sqlite';
import { firstRow } from '../../db/first-row';
import { permissionOverrides, roleAssignments, roles, users, vehicles } from '../../db/schema';
import {
  isVehicleMember,
  type perPersonVehicleGrants,
  refuseUngrantable,
} from '../../permissions/grants';
import { DEMO_ROLE_KEY } from '../../permissions/roles';

export type LiveVehicleGrants = Awaited<ReturnType<typeof perPersonVehicleGrants>>;

export type DroppedGrantReason =
  | 'vehicle_not_restored'
  | 'no_accepted_share'
  | 'account_inactive'
  | 'granted_by_non_member'
  | 'role_not_assignable'
  | 'permission_not_grantable';

export interface DroppedGrant {
  kind: 'role' | 'override';
  vehicleId: string;
  userId: string;
  reason: DroppedGrantReason;
}

export interface RegrantReport {
  reapplied: number;
  dropped: DroppedGrant[];
}

async function personCheck(
  tx: AsyncHandle,
  ownerId: string,
  vehicleId: string,
  userId: string,
  grantor: string | null
): Promise<DroppedGrantReason | null> {
  const car = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, ownerId)))
    .then(firstRow);
  if (!car) return 'vehicle_not_restored';
  if (!(await isVehicleMember(tx, vehicleId, userId))) return 'no_accepted_share';
  const person = await tx
    .select({ disabledAt: users.disabledAt, pendingApprovalAt: users.pendingApprovalAt })
    .from(users)
    .where(eq(users.id, userId))
    .then(firstRow);
  if (!person || person.disabledAt || person.pendingApprovalAt) return 'account_inactive';
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

async function reapplyAssignment(
  tx: AsyncHandle,
  ownerId: string,
  row: Assignment & { scopeId: string }
): Promise<DroppedGrantReason | null> {
  const reason = await personCheck(tx, ownerId, row.scopeId, row.userId, row.grantedBy);
  if (reason) return reason;
  if (!(await assignableRole(tx, ownerId, row.roleId))) return 'role_not_assignable';
  await tx
    .insert(roleAssignments)
    .values({
      userId: row.userId,
      roleId: row.roleId,
      scopeId: row.scopeId,
      grantedBy: row.grantedBy,
    })
    .onConflictDoNothing();
  return null;
}

async function reapplyOverride(
  tx: AsyncHandle,
  ownerId: string,
  row: Override & { scopeId: string }
): Promise<DroppedGrantReason | null> {
  const reason = await personCheck(tx, ownerId, row.scopeId, row.userId, row.setBy);
  if (reason) return reason;
  if (!grantablePermission(row.permission)) return 'permission_not_grantable';
  await tx
    .insert(permissionOverrides)
    .values({
      userId: row.userId,
      scope: 'vehicle',
      scopeId: row.scopeId,
      permission: row.permission,
      effect: row.effect === 'deny' ? 'deny' : 'allow',
      setBy: row.setBy,
    })
    .onConflictDoNothing();
  return null;
}

export async function reapplyVehicleGrants(
  tx: AsyncHandle,
  ownerId: string,
  live: LiveVehicleGrants
): Promise<RegrantReport> {
  const report: RegrantReport = { reapplied: 0, dropped: [] };
  const record = (
    kind: DroppedGrant['kind'],
    row: { scopeId: string; userId: string },
    reason: DroppedGrantReason | null
  ) => {
    if (reason) report.dropped.push({ kind, vehicleId: row.scopeId, userId: row.userId, reason });
    else report.reapplied++;
  };
  for (const row of live.assignments) {
    if (!row.scopeId) continue;
    const scoped = { ...row, scopeId: row.scopeId };
    record('role', scoped, await reapplyAssignment(tx, ownerId, scoped));
  }
  for (const row of live.overrides) {
    if (row.scope !== 'vehicle' || !row.scopeId) continue;
    const scoped = { ...row, scopeId: row.scopeId };
    record('override', scoped, await reapplyOverride(tx, ownerId, scoped));
  }
  return report;
}
