// The single seam for cross-user vehicle access. Shared routes call one of the require* helpers
// below; owner-only actions call validateVehicleOwnership. Denials return 404, never 403, so a
// missing vehicle looks the same as one the caller cannot see.

import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
import { getDb } from '../db/connection';
import { vehicleShares, vehicles } from '../db/schema';
import { NotFoundError } from '../errors';

export type VehicleAccess = { role: 'owner' } | { role: 'viewer' } | { role: 'editor' };

// vehicles.userId is authoritative. The denormalized ownerId on vehicle_shares is only for the
// owner-side list.
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

// A viewer gets the same 404 as a user with no access, so the response does not reveal the share
// level. Owner-only actions must use validateVehicleOwnership, because an editor passes this gate.
export async function requireVehicleWrite(
  vehicleId: string,
  userId: string,
  db: AppDatabase = getDb()
): Promise<VehicleAccess> {
  const access = await resolveVehicleAccess(vehicleId, userId, db);
  if (!access || access.role === 'viewer') throw new NotFoundError('Vehicle');
  return access;
}

// Rows an editor creates on a shared vehicle are stamped with the owner's userId, so they count
// once in the owner's totals and backup.
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
