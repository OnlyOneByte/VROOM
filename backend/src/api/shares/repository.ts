// The vehicle owner is vehicles.userId. vehicle_shares.ownerId is a denormalized copy used only for
// listing; it is never the access gate. Finders key on the acting user's relationship to the row.

import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewVehicleShare, VehicleShare } from '../../db/schema';
import { users, vehicleShares, vehicles } from '../../db/schema';
import { BaseRepository } from '../../utils/repository';

export interface AcceptedShareAccess {
  shareId: string;
  vehicleId: string;
  level: string;
  ownerId: string;
  ownerName: string;
}

/** A received share joined to its vehicle and owner names, so pending invites can be labelled. */
export interface ReceivedShare extends VehicleShare {
  /** Nickname, else "year make model". Mirrors the frontend getVehicleDisplayName. */
  vehicleName: string;
  /** Same value as sharedAccess.sharedBy in the fleet list. */
  sharedBy: string;
}

/**
 * Pending and accepted shares occupy the one-per-(vehicle, invitee) slot. Declined and revoked shares
 * grant nothing and do not block a re-invite.
 *
 * Must match the partial unique index vehicle_shares_active_idx in db/schema.ts, which hard-codes the
 * same list in its WHERE clause. Changing one side requires a migration; a test enforces the pairing.
 */
export const ACTIVE_SHARE_STATUSES = ['pending', 'accepted'] as const;

export type ActiveShareStatus = (typeof ACTIVE_SHARE_STATUSES)[number];

/** Narrows a status string, which the database stores as free text. */
export function isActiveShareStatus(status: string): status is ActiveShareStatus {
  return ACTIVE_SHARE_STATUSES.includes(status as ActiveShareStatus);
}

export class VehicleShareRepository extends BaseRepository<VehicleShare, NewVehicleShare> {
  constructor(db: AppDatabase = getDb()) {
    super(db, vehicleShares);
  }

  /** The active share for a vehicle and invitee, if one exists. */
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
    return rows.find((r) => isActiveShareStatus(r.status)) ?? null;
  }

  async findByOwner(ownerId: string): Promise<VehicleShare[]> {
    return this.db
      .select()
      .from(vehicleShares)
      .where(eq(vehicleShares.ownerId, ownerId))
      .orderBy(vehicleShares.createdAt);
  }

  async findByIdAndOwner(id: string, ownerId: string): Promise<VehicleShare | null> {
    const [row] = await this.db
      .select()
      .from(vehicleShares)
      .where(and(eq(vehicleShares.id, id), eq(vehicleShares.ownerId, ownerId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Pending and accepted shares received by the invitee, oldest first. The joins read the share's own
   * vehicle and owner, so they do not widen access.
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
      .filter((r) => isActiveShareStatus(r.share.status))
      .map((r) => ({
        ...r.share,
        vehicleName: r.nickname ?? `${r.year} ${r.make} ${r.model}`,
        sharedBy: r.ownerName,
      }));
  }

  /** Accepted grants to a user, with the owner's display name. Only these grant fleet visibility. */
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
