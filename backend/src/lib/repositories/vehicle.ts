import { and, eq, inArray } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { inject, injectable } from 'inversify';
import type { NewVehicle, Vehicle } from '../../db/schema.js';
import { vehicleShares, vehicles } from '../../db/schema.js';
import { TYPES } from '../di/types.js';
import { DatabaseError, NotFoundError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { BaseRepository } from './base.js';
import type { IVehicleRepository } from './interfaces.js';
import { QueryBuilder } from './query-builder.js';

@injectable()
export class VehicleRepository
  extends BaseRepository<Vehicle, NewVehicle>
  implements IVehicleRepository
{
  private queryBuilder: QueryBuilder<Vehicle>;

  constructor(@inject(TYPES.Database) db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, vehicles);
    this.queryBuilder = new QueryBuilder(this.database);
  }

  async findByUserId(userId: string): Promise<Vehicle[]> {
    try {
      const result = await this.database
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, userId))
        .orderBy(vehicles.createdAt);
      return result;
    } catch (error) {
      logger.error('Failed to find vehicles by user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError(`Failed to find vehicles for user ${userId}`, error);
    }
  }

  async findByUserIdAndId(userId: string, vehicleId: string): Promise<Vehicle | null> {
    try {
      const whereClause = and(eq(vehicles.userId, userId), eq(vehicles.id, vehicleId));
      if (!whereClause) {
        throw new Error('Invalid where clause');
      }
      return await this.queryBuilder.findOne(vehicles, whereClause);
    } catch (error) {
      logger.error('Error finding vehicle for user', { vehicleId, userId, error });
      throw new Error('Failed to find vehicle for user');
    }
  }

  async findByLicensePlate(licensePlate: string): Promise<Vehicle | null> {
    try {
      return await this.queryBuilder.findOne(vehicles, eq(vehicles.licensePlate, licensePlate));
    } catch (error) {
      logger.error('Error finding vehicle by license plate', { licensePlate, error });
      throw new Error('Failed to find vehicle by license plate');
    }
  }

  async updateMileage(id: string, mileage: number): Promise<Vehicle> {
    try {
      const result = await this.database
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

  async findAccessibleVehicles(userId: string): Promise<Vehicle[]> {
    try {
      // Get vehicles owned by user
      const ownedVehicles = await this.database
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, userId))
        .orderBy(vehicles.createdAt);

      // Get vehicles shared with user (accepted shares only)
      const sharedVehicleIds = await this.database
        .select({ vehicleId: vehicleShares.vehicleId })
        .from(vehicleShares)
        .where(
          and(eq(vehicleShares.sharedWithUserId, userId), eq(vehicleShares.status, 'accepted'))
        );

      if (sharedVehicleIds.length === 0) {
        return ownedVehicles;
      }

      const sharedVehicles = await this.database
        .select()
        .from(vehicles)
        .where(
          inArray(
            vehicles.id,
            sharedVehicleIds.map((s) => s.vehicleId)
          )
        )
        .orderBy(vehicles.createdAt);

      // Combine and deduplicate
      const allVehicles = [...ownedVehicles, ...sharedVehicles];
      const uniqueVehicles = Array.from(new Map(allVehicles.map((v) => [v.id, v])).values());

      logger.debug('Found accessible vehicles', {
        userId,
        ownedCount: ownedVehicles.length,
        sharedCount: sharedVehicles.length,
        totalCount: uniqueVehicles.length,
      });

      return uniqueVehicles;
    } catch (error) {
      logger.error('Failed to find accessible vehicles', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError(`Failed to find accessible vehicles for user ${userId}`, error);
    }
  }

  async findByIdWithAccess(vehicleId: string, userId: string): Promise<Vehicle | null> {
    try {
      // Check if user owns the vehicle
      const ownedVehicle = await this.database
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
        .limit(1);

      if (ownedVehicle.length > 0) {
        return ownedVehicle[0];
      }

      // Check if vehicle is shared with user (accepted shares only)
      const sharedVehicle = await this.database
        .select({
          vehicle: vehicles,
        })
        .from(vehicles)
        .innerJoin(vehicleShares, eq(vehicles.id, vehicleShares.vehicleId))
        .where(
          and(
            eq(vehicles.id, vehicleId),
            eq(vehicleShares.sharedWithUserId, userId),
            eq(vehicleShares.status, 'accepted')
          )
        )
        .limit(1);

      if (sharedVehicle.length > 0) {
        return sharedVehicle[0].vehicle;
      }

      return null;
    } catch (error) {
      logger.error('Error finding vehicle with access for user', { vehicleId, userId, error });
      throw new Error('Failed to find vehicle with access');
    }
  }
}
