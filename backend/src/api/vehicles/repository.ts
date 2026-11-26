import { and, eq, inArray } from 'drizzle-orm';
import type { AsyncAppDatabase } from '../../db/async-sqlite';
import type { NewVehicle, Vehicle, VehicleWithFinancing } from '../../db/schema';
import { vehicleFinancing, vehicles } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';
import { ownedVehiclesScope } from '../../utils/vehicle-access';

export class VehicleRepository extends BaseRepository<Vehicle, NewVehicle> {
  constructor(db: AsyncAppDatabase) {
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
        .where(ownedVehiclesScope(userId))
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

  // No user scope here: callers must have checked access.
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

  // User-scoped: a global lookup would leak plate existence across tenants.
  async findByLicensePlate(licensePlate: string, userId: string): Promise<Vehicle | null> {
    const result = await this.db
      .select()
      .from(vehicles)
      .where(and(ownedVehiclesScope(userId), eq(vehicles.licensePlate, licensePlate)))
      .limit(1);
    return result[0] || null;
  }
}
