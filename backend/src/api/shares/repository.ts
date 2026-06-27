/**
 * Vehicle-shares repository (vehicle-sharing T3/T4). Thin BaseRepository subclass + the scoped finders
 * the share-management routes need. Two ownership truths are deliberately distinct:
 *   - the OWNER of a vehicle is `vehicles.userId` (validated at the route via validateVehicleOwnership),
 *   - `vehicle_shares.ownerId` is a DENORMALIZED copy, written at invite time, used ONLY to make the
 *     owner-side "shares I granted across all my vehicles" list index-friendly. Never the gate.
 *
 * EVERY destructive/mutating finder keys on the acting user's relationship to the row (ownerId for
 * owner-side, sharedWithId for invitee-side) — the #52 id-only-delete lesson: never act on a share by
 * id alone. The route layer additionally re-validates vehicle ownership before an invite insert (C151
 * validate-before-insert: throw BEFORE the row write, never inside an async tx after it).
 */

import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewVehicleShare, VehicleShare } from '../../db/schema';
import { vehicleShares } from '../../db/schema';
import { BaseRepository } from '../../utils/repository';

/** A share is "active" (occupies the partial-unique slot) while pending or accepted. */
export const ACTIVE_SHARE_STATUSES = ['pending', 'accepted'] as const;

export class VehicleShareRepository extends BaseRepository<VehicleShare, NewVehicleShare> {
  constructor(db: AppDatabase = getDb()) {
    super(db, vehicleShares);
  }

  /** The current ACTIVE (pending|accepted) share for a (vehicle, invitee), if any — the dup-invite gate. */
  async findActiveForVehicleAndUser(
    vehicleId: string,
    sharedWithId: string
  ): Promise<VehicleShare | null> {
    const rows = await this.db
      .select()
      .from(vehicleShares)
      .where(
        and(eq(vehicleShares.vehicleId, vehicleId), eq(vehicleShares.sharedWithId, sharedWithId))
      );
    // Only pending/accepted occupy the active slot; declined/revoked are inert (re-invitable).
    return rows.find((r) => r.status === 'pending' || r.status === 'accepted') ?? null;
  }

  /** All shares the owner granted, across ALL their vehicles (owner-side "manage" list). */
  async findByOwner(ownerId: string): Promise<VehicleShare[]> {
    return this.db
      .select()
      .from(vehicleShares)
      .where(eq(vehicleShares.ownerId, ownerId))
      .orderBy(vehicleShares.createdAt);
  }

  /** A single share scoped to its OWNER — the backing read for owner-side level-change / revoke. */
  async findByIdAndOwner(id: string, ownerId: string): Promise<VehicleShare | null> {
    const [row] = await this.db
      .select()
      .from(vehicleShares)
      .where(and(eq(vehicleShares.id, id), eq(vehicleShares.ownerId, ownerId)))
      .limit(1);
    return row ?? null;
  }

  /** A single share scoped to its INVITEE — the backing read for accept / decline (T4). */
  async findByIdAndSharedWith(id: string, sharedWithId: string): Promise<VehicleShare | null> {
    const [row] = await this.db
      .select()
      .from(vehicleShares)
      .where(and(eq(vehicleShares.id, id), eq(vehicleShares.sharedWithId, sharedWithId)))
      .limit(1);
    return row ?? null;
  }
}

export const vehicleShareRepository = new VehicleShareRepository(getDb());
