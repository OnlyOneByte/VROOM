import { and, eq, type SQL } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
import { getDb } from '../db/connection';
import { vehicleShares, vehicles } from '../db/schema';
import type { DrizzleTransaction } from '../db/types';
import { NotFoundError } from '../errors';

export type VehicleRole = 'owner' | 'editor' | 'viewer';
export type VehicleAccessMode = 'read' | 'write' | 'owner';

export interface VehicleAccess {
  role: VehicleRole;
  ownerId: string;
}

const ROLES_FOR_MODE: Record<VehicleAccessMode, readonly VehicleRole[]> = {
  read: ['owner', 'editor', 'viewer'],
  write: ['owner', 'editor'],
  owner: ['owner'],
};

// Authorize against vehicles.userId; vehicle_shares.ownerId is only a list key.
export async function resolveVehicleAccess(
  vehicleId: string,
  userId: string,
  db: AppDatabase | DrizzleTransaction = getDb()
): Promise<VehicleAccess | null> {
  const rows = await db
    .select({ ownerId: vehicles.userId, level: vehicleShares.level })
    .from(vehicles)
    .leftJoin(
      vehicleShares,
      and(
        eq(vehicleShares.vehicleId, vehicles.id),
        eq(vehicleShares.sharedWithId, userId),
        eq(vehicleShares.status, 'accepted')
      )
    )
    .where(eq(vehicles.id, vehicleId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.ownerId === userId) return { role: 'owner', ownerId: row.ownerId };
  if (row.level === null) return null;
  return { role: row.level === 'editor' ? 'editor' : 'viewer', ownerId: row.ownerId };
}

export async function requireVehicleAccess(
  vehicleId: string,
  userId: string,
  mode: VehicleAccessMode,
  db: AppDatabase | DrizzleTransaction = getDb()
): Promise<VehicleAccess> {
  const access = await resolveVehicleAccess(vehicleId, userId, db);
  if (!access || !ROLES_FOR_MODE[mode].includes(access.role)) {
    // 404, not 403, so a non-member cannot learn that the vehicle exists.
    throw new NotFoundError('Vehicle');
  }
  return access;
}

export function ownedVehiclesScope(userId: string): SQL {
  return eq(vehicles.userId, userId);
}
