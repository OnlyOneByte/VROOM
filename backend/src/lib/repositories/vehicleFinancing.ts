import { asc, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { NewVehicleFinancing, VehicleFinancing } from '../../db/schema.js';
import { vehicleFinancing } from '../../db/schema.js';
import { logger } from '../utils/logger';
import { BaseRepository } from './base.js';

export class VehicleFinancingRepository extends BaseRepository<
  VehicleFinancing,
  NewVehicleFinancing
> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, vehicleFinancing);
  }

  async findByVehicleId(vehicleId: string): Promise<VehicleFinancing | null> {
    try {
      return await this.queryBuilder.findOne(
        vehicleFinancing,
        eq(vehicleFinancing.vehicleId, vehicleId)
      );
    } catch (error) {
      logger.error('Error finding financing for vehicle', { vehicleId, error });
      throw new Error('Failed to find financing for vehicle');
    }
  }

  async findActiveFinancing(): Promise<VehicleFinancing[]> {
    try {
      return await this.queryBuilder.findMany(
        vehicleFinancing,
        eq(vehicleFinancing.isActive, true),
        asc(vehicleFinancing.startDate)
      );
    } catch (error) {
      logger.error('Error finding active financing', { error });
      throw new Error('Failed to find active financing');
    }
  }

  async updateBalance(id: string, newBalance: number): Promise<VehicleFinancing> {
    try {
      const result = await this.db
        .update(vehicleFinancing)
        .set({
          currentBalance: newBalance,
          updatedAt: new Date(),
        })
        .where(eq(vehicleFinancing.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Vehicle financing with id ${id} not found`);
      }

      return result[0];
    } catch (error) {
      logger.error('Error updating balance for financing', { id, error });
      throw new Error('Failed to update financing balance');
    }
  }

  async markAsCompleted(id: string, endDate: Date): Promise<VehicleFinancing> {
    try {
      const result = await this.db
        .update(vehicleFinancing)
        .set({
          isActive: false,
          currentBalance: 0,
          endDate: endDate,
          updatedAt: new Date(),
        })
        .where(eq(vehicleFinancing.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Vehicle financing with id ${id} not found`);
      }

      return result[0];
    } catch (error) {
      logger.error('Error marking financing as completed', { id, error });
      throw new Error('Failed to mark financing as completed');
    }
  }
}
