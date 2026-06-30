import { and, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewVehicle, Vehicle, VehicleWithFinancing } from '../../db/schema';
import { vehicleFinancing, vehicles } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

export class VehicleRepository extends BaseRepository<Vehicle, NewVehicle> {
  constructor(db: AppDatabase) {
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

  /**
   * Fetch vehicles by an explicit id set (with financing), NOT userId-scoped — used by the
   * shared-fleet widening (vehicle-sharing T5a): the caller has already resolved which vehicleIds the
   * acting user has ACCEPTED-share access to, so this just hydrates those rows. Returns [] for an empty
   * id list (no query). Order is unspecified; the caller sorts/annotates.
   */
  async findByIds(vehicleIds: string[]): Promise<VehicleWithFinancing[]> {
    if (vehicleIds.length === 0) return [];
    const result = await this.db
      .select({ vehicle: vehicles, financing: vehicleFinancing })
      .from(vehicles)
      .leftJoin(vehicleFinancing, eq(vehicles.id, vehicleFinancing.vehicleId))
      .where(inArray(vehicles.id, vehicleIds));
    return result.map((row) => ({
      ...row.vehicle,
      financing: row.financing || undefined,
    })) as VehicleWithFinancing[];
  }

  async findByUserIdAndId(userId: string, vehicleId: string): Promise<Vehicle | null> {
    const result = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.userId, userId), eq(vehicles.id, vehicleId)))
      .limit(1);
    return result[0] || null;
  }

  /**
   * Find a vehicle by license plate WITHIN ONE USER'S fleet. Scoped by userId (the C168/#48/#52
   * tenant-scope-at-the-read class): the plate-uniqueness check that backs vehicle create/update is
   * a per-user constraint, not a global one — two different users may legitimately register the same
   * plate (e.g. a reissued plate across states, or a sold-then-rebought car), and a GLOBAL lookup
   * both wrongly 409'd the second user AND leaked plate existence across tenants (an enumeration
   * oracle via the conflict message). Plates carry no cross-user meaning here, so scope to the owner.
   */
  async findByLicensePlate(licensePlate: string, userId: string): Promise<Vehicle | null> {
    const result = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.userId, userId), eq(vehicles.licensePlate, licensePlate)))
      .limit(1);
    return result[0] || null;
  }

  async findByIdWithAccess(
    vehicleId: string,
    userId: string
  ): Promise<VehicleWithFinancing | null> {
    try {
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
      throw new DatabaseError('Failed to find vehicle with access', error);
    }
  }
}

// Export singleton instance
export const vehicleRepository = new VehicleRepository(getDb());
