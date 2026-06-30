/**
 * Vehicle-sharing access resolver (vehicle-sharing T2; design §2). THE ONE SEAM every shared
 * read/write route routes through — the single widening of cross-userId access in VROOM
 * (NORTH_STAR #2). Keeping it in one place is what makes the IDOR surface auditable: a route either
 * calls the strict `validateVehicleOwnership` (owner-only actions) OR one of these two
 * (shared-readable / shared-writable) — never an ad-hoc ownership check.
 *
 * Access rules (D2/D3, ratified 2026-06-27):
 *   - OWNER: `vehicles.userId === acting` — the load-bearing ownership truth (NOT the denormalized
 *     `vehicle_shares.ownerId`, which exists only for the owner-side list query).
 *   - else an ACCEPTED share to the acting user for THIS vehicle → its level (viewer | editor).
 *   - else null → the caller maps to **404, never 403** (#80 enumeration-oracle: a non-existent
 *     vehicle and a vehicle-you-cannot-see must be indistinguishable — a 403 would confirm existence).
 *
 * A pending / declined / revoked share grants NOTHING (only `accepted` counts). A vehicle that does
 * not exist also resolves to null (both lookups miss) → the same 404. Owner-only actions (delete
 * vehicle, edit financing/purchase price, manage shares) keep the STRICT `validateVehicleOwnership`
 * — `requireVehicleWrite` (which an editor passes) is NOT sufficient for them.
 */

import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
import { getDb } from '../db/connection';
import { vehicleShares, vehicles } from '../db/schema';
import { NotFoundError } from '../errors';

/** The acting user's resolved access to a specific vehicle. `null` is represented by absence (404). */
export type VehicleAccess = { role: 'owner' } | { role: 'viewer' } | { role: 'editor' };

/**
 * Resolve the acting user's access to a vehicle, or null if none (caller → 404). Owner first
 * (vehicles.userId), else the ACCEPTED share's level, else null. Takes an optional db handle so it
 * is unit-testable against a seeded throwaway DB; defaults to the singleton for route use.
 */
export async function resolveVehicleAccess(
  vehicleId: string,
  userId: string,
  db: AppDatabase = getDb()
): Promise<VehicleAccess | null> {
  // Owner is the load-bearing truth — check vehicles.userId, not the denormalized share.ownerId.
  const owned = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
    .limit(1);
  if (owned.length > 0) return { role: 'owner' };

  // Else: an ACCEPTED share to this user for this vehicle. pending/declined/revoked grant nothing.
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

/**
 * Require READ access to a vehicle: owner | viewer | editor. Throws NotFoundError (→ 404, never 403)
 * when the acting user has no access (or the vehicle does not exist — indistinguishable by design).
 */
export async function requireVehicleRead(
  vehicleId: string,
  userId: string,
  db: AppDatabase = getDb()
): Promise<VehicleAccess> {
  const access = await resolveVehicleAccess(vehicleId, userId, db);
  if (!access) throw new NotFoundError('Vehicle');
  return access;
}

/**
 * Require WRITE access to a vehicle: owner | editor only. A VIEWER is denied — and denied with the
 * SAME 404 a non-shared user gets, NOT a 403: surfacing "403 you are only a viewer" would still be a
 * (smaller) capability oracle, and the design fixed one consistent denial code. So write-denied and
 * no-access are indistinguishable (NotFoundError → 404). Owner-only actions must use the STRICT
 * `validateVehicleOwnership` instead — an editor passing THIS gate must not reach them.
 */
export async function requireVehicleWrite(
  vehicleId: string,
  userId: string,
  db: AppDatabase = getDb()
): Promise<VehicleAccess> {
  const access = await resolveVehicleAccess(vehicleId, userId, db);
  if (!access || access.role === 'viewer') throw new NotFoundError('Vehicle');
  return access; // owner | editor
}

/**
 * The vehicle OWNER's userId (vehicles.userId) — the value a shared-created row's `userId` is stamped
 * with under the T5b owner-stamp model (design §2.1). For an OWNER writing their own vehicle this
 * equals the acting user; for an EDITOR it is the other (owner) user, so the row rides the OWNER's
 * backup/TCO + counts once (and `createdBy` records the editor as the actual author). Returns null
 * only if the vehicle does not exist — callers gate on `requireVehicleWrite` FIRST (which 404s an
 * absent/unwritable vehicle), so a successful write path always resolves a real owner id.
 */
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
