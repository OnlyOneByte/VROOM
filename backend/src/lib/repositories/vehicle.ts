import { and, eq, inArray } from 'drizzle-orm';
import type { NewVehicle, Vehicle } from '../../db/schema.js';
import { vehicleShares, vehicles } from '../../db/schema.js';
import { BaseRepository } from './base.js';
import type { IVehicleRepository } from './interfaces.js';

export class VehicleRepository
  extends BaseRepository<Vehicle, NewVehicle>
  implements IVehicleRepository
{
  constructor() {
    super(vehicles);
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
      console.error(`Error finding vehicles for user ${userId}:`, error);
      throw new Error('Failed to find vehicles for user');
    }
  }

  async findByUserIdAndId(userId: string, vehicleId: string): Promise<Vehicle | null> {
    try {
      const result = await this.database
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.userId, userId), eq(vehicles.id, vehicleId)))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      console.error(`Error finding vehicle ${vehicleId} for user ${userId}:`, error);
      throw new Error('Failed to find vehicle for user');
    }
  }

  async findByLicensePlate(licensePlate: string): Promise<Vehicle | null> {
    try {
      const result = await this.database
        .select()
        .from(vehicles)
        .where(eq(vehicles.licensePlate, licensePlate))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      console.error(`Error finding vehicle by license plate ${licensePlate}:`, error);
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
        throw new Error(`Vehicle with id ${id} not found`);
      }

      return result[0];
    } catch (error) {
      console.error(`Error updating mileage for vehicle ${id}:`, error);
      throw new Error('Failed to update vehicle mileage');
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

      return uniqueVehicles;
    } catch (error) {
      console.error(`Error finding accessible vehicles for user ${userId}:`, error);
      throw new Error('Failed to find accessible vehicles');
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
      console.error(`Error finding vehicle ${vehicleId} with access for user ${userId}:`, error);
      throw new Error('Failed to find vehicle with access');
    }
  }
}
