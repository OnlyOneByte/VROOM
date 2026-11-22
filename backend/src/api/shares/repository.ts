// vehicle_shares.ownerId is a denormalized copy for listing only; never use it as the access gate.

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewVehicleShare, VehicleShare } from '../../db/schema';
import { users, vehicleShares, vehicles } from '../../db/schema';
import { BaseRepository } from '../../utils/repository';

interface AcceptedShareAccess {
  shareId: string;
  vehicleId: string;
  level: string;
  ownerId: string;
  ownerName: string;
}

export interface GrantedShare extends VehicleShare {
  sharedWithEmail: string | null;
  sharedWithName: string | null;
}

export interface ReceivedShare extends VehicleShare {
  vehicleName: string;
  sharedBy: string;
}

// Must match the partial unique index vehicle_shares_active_idx in db/schema.ts; changing either requires a migration.
export const ACTIVE_SHARE_STATUSES = ['pending', 'accepted'] as const;

type ActiveShareStatus = (typeof ACTIVE_SHARE_STATUSES)[number];

export function isActiveShareStatus(status: string): status is ActiveShareStatus {
  return ACTIVE_SHARE_STATUSES.includes(status as ActiveShareStatus);
}

// Only a share the invitee accepted identifies them to the owner; every other status stays anonymous.
export function toOwnerView(
  share: VehicleShare,
  invitee: { sharedWithEmail: string | null; sharedWithName: string | null } = {
    sharedWithEmail: null,
    sharedWithName: null,
  }
): GrantedShare {
  const identified = share.status === 'accepted';
  return {
    ...share,
    sharedWithId: identified ? share.sharedWithId : null,
    sharedWithEmail: identified ? invitee.sharedWithEmail : share.invitedEmail,
    sharedWithName: identified ? invitee.sharedWithName : null,
  };
}

export async function findInviteeId(
  db: Pick<AppDatabase, 'select'>,
  email: string
): Promise<string | null> {
  const [match] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return match?.id ?? null;
}

export function attachPendingInvites(
  tx: Pick<AppDatabase, 'update'>,
  userId: string,
  email: string
): void {
  tx.update(vehicleShares)
    .set({ sharedWithId: userId })
    .where(
      and(
        isNull(vehicleShares.sharedWithId),
        eq(vehicleShares.status, 'pending'),
        eq(vehicleShares.invitedEmail, email),
        sql`${vehicleShares.vehicleId} not in (select v.id from vehicles v where v.user_id = ${userId})`,
        sql`${vehicleShares.vehicleId} not in (select s.vehicle_id from vehicle_shares s where s.shared_with_id = ${userId} and s.status in (${sql.join(
          ACTIVE_SHARE_STATUSES.map((status) => sql`${status}`),
          sql`, `
        )}))`
      )
    )
    .run();
}

class VehicleShareRepository extends BaseRepository<VehicleShare, NewVehicleShare> {
  constructor(db: AppDatabase = getDb()) {
    super(db, vehicleShares);
  }

  async findActiveInvite(
    vehicleId: string,
    email: string,
    inviteeId: string | null
  ): Promise<VehicleShare | null> {
    const sameInvitee = sql`lower(${vehicleShares.invitedEmail}) = ${email}`;
    const [row] = await this.db
      .select()
      .from(vehicleShares)
      .where(
        and(
          eq(vehicleShares.vehicleId, vehicleId),
          inArray(vehicleShares.status, [...ACTIVE_SHARE_STATUSES]),
          inviteeId ? or(eq(vehicleShares.sharedWithId, inviteeId), sameInvitee) : sameInvitee
        )
      )
      .limit(1);
    return row ?? null;
  }

  async findByOwner(ownerId: string): Promise<GrantedShare[]> {
    const rows = await this.db
      .select({
        share: vehicleShares,
        sharedWithEmail: users.email,
        sharedWithName: users.displayName,
      })
      .from(vehicleShares)
      .leftJoin(users, eq(users.id, vehicleShares.sharedWithId))
      .where(eq(vehicleShares.ownerId, ownerId))
      .orderBy(vehicleShares.createdAt);
    return rows.map((r) => toOwnerView(r.share, r));
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
