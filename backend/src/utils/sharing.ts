import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
import { getDb } from '../db/connection';
import { vehicleShares, vehicles } from '../db/schema';
import { NotFoundError } from '../errors';

export type VehicleAccess = { role: 'owner' } | { role: 'viewer' } | { role: 'editor' };

// Authorize against vehicles.userId; vehicle_shares.ownerId is only a list key.
export async function resolveVehicleAccess(
  vehicleId: string,
  userId: string,
  db: AppDatabase = getDb()
): Promise<VehicleAccess | null> {
  const owned = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
    .limit(1);
  if (owned.length > 0) return { role: 'owner' };

  const shared = await db
    .select({ level: vehicleShares.level })
    .from(vehicleShares)
    .where(
      and(
        eq(vehicleShares.vehicleId, vehicleId),
        eq(vehicleShares.sharedWithId, userId),
        eq(vehicleShares.status, 'accepted')
      )
    )
    .limit(1);
  if (shared.length > 0) {
    return shared[0].level === 'editor' ? { role: 'editor' } : { role: 'viewer' };
  }

  return null;
}

export async function requireVehicleRead(
  vehicleId: string,
  userId: string,
  db: AppDatabase = getDb()
): Promise<VehicleAccess> {
  const access = await resolveVehicleAccess(vehicleId, userId, db);
  if (!access) throw new NotFoundError('Vehicle');
  return access;
}

// Owner-only actions must use validateVehicleOwnership: an editor passes this gate.
export async function requireVehicleWrite(
  vehicleId: string,
  userId: string,
  db: AppDatabase = getDb()
): Promise<VehicleAccess> {
  const access = await resolveVehicleAccess(vehicleId, userId, db);
  if (!access || access.role === 'viewer') throw new NotFoundError('Vehicle');
  return access;
}

export async function resolveVehicleOwnerId(
  vehicleId: string,
  db: AppDatabase = getDb()
): Promise<string | null> {
  const owned = await db
    .select({ userId: vehicles.userId })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);
  return owned[0]?.userId ?? null;
}

export async function requireVehicleOwnerScope(
  vehicleId: string,
  userId: string,
  mode: 'read' | 'write',
  db: AppDatabase = getDb()
): Promise<string> {
  const access =
    mode === 'write'
      ? await requireVehicleWrite(vehicleId, userId, db)
      : await requireVehicleRead(vehicleId, userId, db);
  if (access.role === 'owner') return userId;
  const ownerId = await resolveVehicleOwnerId(vehicleId, db);
  if (!ownerId) throw new NotFoundError('Vehicle');
  return ownerId;
}
