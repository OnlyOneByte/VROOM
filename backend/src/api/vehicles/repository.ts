import { and, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import type { NewVehicle, Vehicle, VehicleWithFinancing } from '../../db/schema';
import { vehicleFinancing, vehicles } from '../../db/schema';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

export class VehicleRepository extends BaseRepository<Vehicle, NewVehicle> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, vehicles);
  }

  async findByUserId(userId: string): Promise<VehicleWithFinancing[]> {
    try {
      const result = await this.db
        .select({
          vehicle: vehicles,
          financing: vehicleFinancing,
        })
        .from(vehicles)
        .leftJoin(vehicleFinancing, eq(vehicles.id, vehicleFinancing.vehicleId))
        .where(eq(vehicles.userId, userId))
        .orderBy(vehicles.createdAt);

      return result.map((row) => ({
        ...row.vehicle,
        financing: row.financing || undefined,
      })) as VehicleWithFinancing[];
    } catch (error) {
      logger.error('Failed to find vehicles by user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError(`Failed to find vehicles for user ${userId}`, error);
    }
  }

  async findByUserIdAndId(userId: string, vehicleId: string): Promise<Vehicle | null> {
    const result = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.userId, userId), eq(vehicles.id, vehicleId)))
      .limit(1);
    return result[0] || null;
  }

  async findByLicensePlate(licensePlate: string): Promise<Vehicle | null> {
    const result = await this.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.licensePlate, licensePlate))
      .limit(1);
    return result[0] || null;
  }

  async updateMileage(id: string, mileage: number): Promise<Vehicle> {
    try {
      const result = await this.db
        .update(vehicles)
        .set({
          initialMileage: mileage,
          updatedAt: new Date(),
        })
        .where(eq(vehicles.id, id))
        .returning();

      if (result.length === 0) {
        logger.warn('Vehicle not found for mileage update', { id, mileage });
        throw new NotFoundError('Vehicle');
      }

      logger.info('Updated vehicle mileage', { id, mileage });
      return result[0];
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error('Failed to update vehicle mileage', {
        id,
        mileage,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError(`Failed to update mileage for vehicle ${id}`, error);
    }
  }

  async findAccessibleVehicles(userId: string): Promise<VehicleWithFinancing[]> {
    try {
      // Get vehicles owned by user with financing
      const ownedVehiclesResult = await this.db
        .select({
          vehicle: vehicles,
          financing: vehicleFinancing,
        })
        .from(vehicles)
        .leftJoin(vehicleFinancing, eq(vehicles.id, vehicleFinancing.vehicleId))
        .where(eq(vehicles.userId, userId))
        .orderBy(vehicles.createdAt);

      const ownedVehicles = ownedVehiclesResult.map((row) => ({
        ...row.vehicle,
        financing: row.financing || undefined,
      })) as VehicleWithFinancing[];

      logger.debug('Found accessible vehicles', {
        userId,
        ownedCount: ownedVehicles.length,
      });

      return ownedVehicles;
    } catch (error) {
      logger.error('Failed to find accessible vehicles', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError(`Failed to find accessible vehicles for user ${userId}`, error);
    }
  }

  async findByIdWithAccess(
    vehicleId: string,
    userId: string
  ): Promise<VehicleWithFinancing | null> {
    try {
      // Check if user owns the vehicle
      const ownedVehicle = await this.db
        .select({
          vehicle: vehicles,
          financing: vehicleFinancing,
        })
        .from(vehicles)
        .leftJoin(vehicleFinancing, eq(vehicles.id, vehicleFinancing.vehicleId))
        .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
        .limit(1);

      if (ownedVehicle.length > 0) {
        const result = ownedVehicle[0];
        return {
          ...result.vehicle,
          financing: result.financing || undefined,
        } as VehicleWithFinancing;
      }

      return null;
    } catch (error) {
      logger.error('Error finding vehicle with access for user', { vehicleId, userId, error });
      throw new Error('Failed to find vehicle with access');
    }
  }
}

// Export singleton instance
export const vehicleRepository = new VehicleRepository(getDb());
