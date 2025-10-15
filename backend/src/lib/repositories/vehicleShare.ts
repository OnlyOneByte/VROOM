import { and, eq } from 'drizzle-orm';
import type { NewVehicleShare, VehicleShare } from '../../db/schema';
import { vehicleShares, vehicles } from '../../db/schema';
import { NotFoundError } from '../errors';
import { BaseRepository } from './base';
import type { IVehicleShareRepository } from './interfaces';

export class VehicleShareRepository
  extends BaseRepository<VehicleShare, NewVehicleShare>
  implements IVehicleShareRepository
{
  constructor() {
    super(vehicleShares);
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
    const result = await this.database
      .select()
      .from(vehicleShares)
      .where(
        and(eq(vehicleShares.vehicleId, vehicleId), eq(vehicleShares.sharedWithUserId, userId))
      )
      .get();

    return result || null;
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
    const vehicle = await this.database
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
      .get();

    if (vehicle) {
      return true;
    }

    // Check if vehicle is shared with user and accepted
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

    return !!share;
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
