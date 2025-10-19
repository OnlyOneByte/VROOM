import { and, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { inject, injectable } from 'inversify';
import type { NewVehicleShare, VehicleShare } from '../../db/schema';
import { vehicleShares, vehicles } from '../../db/schema';
import { TYPES } from '../di/types';
import { NotFoundError } from '../errors';
import { BaseRepository } from './base';
import type { IVehicleShareRepository } from './interfaces';
import { QueryBuilder } from './query-builder.js';

@injectable()
export class VehicleShareRepository
  extends BaseRepository<VehicleShare, NewVehicleShare>
  implements IVehicleShareRepository
{
  private queryBuilder: QueryBuilder<VehicleShare>;

  constructor(@inject(TYPES.Database) db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, vehicleShares);
    this.queryBuilder = new QueryBuilder(this.database);
  }

  async findByVehicleId(vehicleId: string): Promise<VehicleShare[]> {
    return this.database
      .select()
      .from(vehicleShares)
      .where(eq(vehicleShares.vehicleId, vehicleId))
      .all();
  }

  async findByOwnerId(ownerId: string): Promise<VehicleShare[]> {
    return this.database
      .select()
      .from(vehicleShares)
      .where(eq(vehicleShares.ownerId, ownerId))
      .all();
  }

  async findBySharedWithUserId(userId: string): Promise<VehicleShare[]> {
    return this.database
      .select()
      .from(vehicleShares)
      .where(eq(vehicleShares.sharedWithUserId, userId))
      .all();
  }

  async findByVehicleAndUser(vehicleId: string, userId: string): Promise<VehicleShare | null> {
    const whereClause = and(
      eq(vehicleShares.vehicleId, vehicleId),
      eq(vehicleShares.sharedWithUserId, userId)
    );
    if (!whereClause) {
      throw new Error('Invalid where clause');
    }
    return await this.queryBuilder.findOne(vehicleShares, whereClause);
  }

  async findPendingInvitations(userId: string): Promise<VehicleShare[]> {
    return this.database
      .select()
      .from(vehicleShares)
      .where(and(eq(vehicleShares.sharedWithUserId, userId), eq(vehicleShares.status, 'pending')))
      .all();
  }

  async updateStatus(id: string, status: 'accepted' | 'declined'): Promise<VehicleShare> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError('Vehicle share');
    }

    const updated = await this.database
      .update(vehicleShares)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(vehicleShares.id, id))
      .returning()
      .get();

    if (!updated) {
      throw new NotFoundError('Vehicle share');
    }

    return updated;
  }

  async hasAccess(vehicleId: string, userId: string): Promise<boolean> {
    // Check if user owns the vehicle
    const vehicleQueryBuilder = new QueryBuilder(this.database);
    const vehicleWhereClause = and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId));
    if (!vehicleWhereClause) {
      throw new Error('Invalid where clause');
    }
    const vehicle = await vehicleQueryBuilder.findOne(vehicles, vehicleWhereClause);

    if (vehicle) {
      return true;
    }

    // Check if vehicle is shared with user and accepted
    const shareWhereClause = and(
      eq(vehicleShares.vehicleId, vehicleId),
      eq(vehicleShares.sharedWithUserId, userId),
      eq(vehicleShares.status, 'accepted')
    );
    if (!shareWhereClause) {
      throw new Error('Invalid where clause');
    }
    return await this.queryBuilder.exists(vehicleShares, shareWhereClause);
  }

  async getPermission(vehicleId: string, userId: string): Promise<'view' | 'edit' | null> {
    // Check if user owns the vehicle (full edit access)
    const vehicle = await this.database
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
      .get();

    if (vehicle) {
      return 'edit';
    }

    // Check if vehicle is shared with user
    const share = await this.database
      .select()
      .from(vehicleShares)
      .where(
        and(
          eq(vehicleShares.vehicleId, vehicleId),
          eq(vehicleShares.sharedWithUserId, userId),
          eq(vehicleShares.status, 'accepted')
        )
      )
      .get();

    if (share) {
      return share.permission as 'view' | 'edit';
    }

    return null;
  }
}
