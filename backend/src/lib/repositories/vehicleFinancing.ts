import { eq } from 'drizzle-orm';
import type { NewVehicleFinancing, VehicleFinancing } from '../../db/schema.js';
import { vehicleFinancing } from '../../db/schema.js';
import { BaseRepository } from './base.js';
import type { IVehicleFinancingRepository } from './interfaces.js';

export class VehicleFinancingRepository
  extends BaseRepository<VehicleFinancing, NewVehicleFinancing>
  implements IVehicleFinancingRepository
{
  constructor() {
    super(vehicleFinancing);
  }

  async findByVehicleId(vehicleId: string): Promise<VehicleFinancing | null> {
    try {
      const result = await this.database
        .select()
        .from(vehicleFinancing)
        .where(eq(vehicleFinancing.vehicleId, vehicleId))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      console.error(`Error finding financing for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find financing for vehicle');
    }
  }

  async findActiveFinancing(): Promise<VehicleFinancing[]> {
    try {
      const result = await this.database
        .select()
        .from(vehicleFinancing)
        .where(eq(vehicleFinancing.isActive, true))
        .orderBy(vehicleFinancing.startDate);
      return result;
    } catch (error) {
      console.error('Error finding active financing:', error);
      throw new Error('Failed to find active financing');
    }
  }

  async updateBalance(id: string, newBalance: number): Promise<VehicleFinancing> {
    try {
      const result = await this.database
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
      console.error(`Error updating balance for financing ${id}:`, error);
      throw new Error('Failed to update financing balance');
    }
  }

  async markAsCompleted(id: string, endDate: Date): Promise<VehicleFinancing> {
    try {
      const result = await this.database
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
      console.error(`Error marking financing ${id} as completed:`, error);
      throw new Error('Failed to mark financing as completed');
    }
  }
}
