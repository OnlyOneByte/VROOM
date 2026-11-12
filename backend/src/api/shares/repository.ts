// vehicle_shares.ownerId is a denormalized copy for listing only; never use it as the access gate.

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

export interface ReceivedShare extends VehicleShare {
  vehicleName: string;
  sharedBy: string;
}

// Must match the partial unique index vehicle_shares_active_idx in db/schema.ts; changing either requires a migration.
export const ACTIVE_SHARE_STATUSES = ['pending', 'accepted'] as const;

export type ActiveShareStatus = (typeof ACTIVE_SHARE_STATUSES)[number];

export function isActiveShareStatus(status: string): status is ActiveShareStatus {
  return ACTIVE_SHARE_STATUSES.includes(status as ActiveShareStatus);
}

export class VehicleShareRepository extends BaseRepository<VehicleShare, NewVehicleShare> {
  constructor(db: AppDatabase = getDb()) {
    super(db, vehicleShares);
  }

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
