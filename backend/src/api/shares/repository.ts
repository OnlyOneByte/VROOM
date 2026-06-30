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
import { users, vehicleShares, vehicles } from '../../db/schema';
import { BaseRepository } from '../../utils/repository';

/** An ACCEPTED grant TO a user: which vehicle, at what level, owned (and shared) by whom. */
export interface AcceptedShareAccess {
  shareId: string;
  vehicleId: string;
  level: string;
  ownerId: string;
  ownerName: string;
}

/**
 * A share RECEIVED by an invitee, enriched for the "Shared with me" surface (T12). The raw share row
 * carries only foreign-key IDs; a PENDING invitee has no other way to resolve them (the T5a fleet
 * widening is ACCEPTED-only, so a pending invite's vehicle is otherwise invisible). So `/received`
 * joins through to the vehicle's display name + the owner's display name — exactly the columns the
 * invitee needs to render "Honda Civic — shared by Alice" without an N+1 follow-up read.
 */
export interface ReceivedShare extends VehicleShare {
  /** nickname, else "year make model" — mirrors the FE getVehicleDisplayName helper. */
  vehicleName: string;
  /** The owner's display name (users.displayName), matching T5a's sharedAccess.sharedBy. */
  sharedBy: string;
}

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

  /**
   * Shares RECEIVED by an invitee — the invitee-side "shared with me" list (T4/T12). Returns pending +
   * accepted only (declined/revoked are inert history the invitee should not see surfaced), ordered
   * oldest-first to match the owner-side list. Joins the vehicle + owner so a pending invite renders a
   * human label without an N+1; the join columns are the SHARE's own vehicle/owner (still scoped by
   * sharedWithId), so it widens no cross-tenant read — the invitee already knows it was shared with them.
   */
  async findReceivedByUser(sharedWithId: string): Promise<ReceivedShare[]> {
    const rows = await this.db
      .select({
        share: vehicleShares,
        nickname: vehicles.nickname,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
        ownerName: users.displayName,
      })
      .from(vehicleShares)
      .innerJoin(vehicles, eq(vehicles.id, vehicleShares.vehicleId))
      .innerJoin(users, eq(users.id, vehicleShares.ownerId))
      .where(eq(vehicleShares.sharedWithId, sharedWithId))
      .orderBy(vehicleShares.createdAt);
    return rows
      .filter((r) => r.share.status === 'pending' || r.share.status === 'accepted')
      .map((r) => ({
        ...r.share,
        vehicleName: r.nickname ?? `${r.year} ${r.make} ${r.model}`,
        sharedBy: r.ownerName,
      }));
  }

  /**
   * The ACCEPTED grants TO a user — the shared-fleet widening (T5a, GET /vehicles?include=shared).
   * Joins the owner's display name so a shared vehicle card can render "shared by <name>" without an
   * N+1. Accepted-only (pending/declined/revoked grant no fleet visibility).
   */
  async findAcceptedAccessForUser(sharedWithId: string): Promise<AcceptedShareAccess[]> {
    const rows = await this.db
      .select({
        shareId: vehicleShares.id,
        vehicleId: vehicleShares.vehicleId,
        level: vehicleShares.level,
        ownerId: vehicleShares.ownerId,
        ownerName: users.displayName,
      })
      .from(vehicleShares)
      .innerJoin(users, eq(users.id, vehicleShares.ownerId))
      .where(
        and(eq(vehicleShares.sharedWithId, sharedWithId), eq(vehicleShares.status, 'accepted'))
      );
    return rows;
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
