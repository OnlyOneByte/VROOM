import { eq, and } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { vehicleLoans } from '../../db/schema.js';
import type { VehicleLoan, NewVehicleLoan } from '../../db/schema.js';
import type { IVehicleLoanRepository } from './interfaces.js';
import { BaseRepository } from './base.js';

export class VehicleLoanRepository extends BaseRepository<VehicleLoan, NewVehicleLoan> implements IVehicleLoanRepository {
  constructor() {
    super(vehicleLoans);
  }

  async findByVehicleId(vehicleId: string): Promise<VehicleLoan | null> {
    try {
      const result = await db
        .select()
        .from(vehicleLoans)
        .where(eq(vehicleLoans.vehicleId, vehicleId))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      console.error(`Error finding loan for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find loan for vehicle');
    }
  }

  async findActiveLoans(): Promise<VehicleLoan[]> {
    try {
      const result = await db
        .select()
        .from(vehicleLoans)
        .where(eq(vehicleLoans.isActive, true))
        .orderBy(vehicleLoans.startDate);
      return result;
    } catch (error) {
      console.error('Error finding active loans:', error);
      throw new Error('Failed to find active loans');
    }
  }

  async updateBalance(id: string, newBalance: number): Promise<VehicleLoan> {
    try {
      const result = await db
        .update(vehicleLoans)
        .set({ 
          currentBalance: newBalance,
          updatedAt: new Date()
        })
        .where(eq(vehicleLoans.id, id))
        .returning();
      
      if (result.length === 0) {
        throw new Error(`Vehicle loan with id ${id} not found`);
      }
      
      return result[0];
    } catch (error) {
      console.error(`Error updating balance for loan ${id}:`, error);
      throw new Error('Failed to update loan balance');
    }
  }

  async markAsPaidOff(id: string, payoffDate: Date): Promise<VehicleLoan> {
    try {
      const result = await db
        .update(vehicleLoans)
        .set({ 
          isActive: false,
          currentBalance: 0,
          payoffDate: payoffDate,
          updatedAt: new Date()
        })
        .where(eq(vehicleLoans.id, id))
        .returning();
      
      if (result.length === 0) {
        throw new Error(`Vehicle loan with id ${id} not found`);
      }
      
      return result[0];
    } catch (error) {
      console.error(`Error marking loan ${id} as paid off:`, error);
      throw new Error('Failed to mark loan as paid off');
    }
  }
}