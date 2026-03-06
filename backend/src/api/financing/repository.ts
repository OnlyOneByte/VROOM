/**
 * Financing Repository
 *
 * Vehicle financing operations (loan/lease configuration and balance tracking).
 * Payment tracking is now handled through the expenses table with isFinancingPayment flag.
 */

import { asc, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import type { NewVehicleFinancing, VehicleFinancing } from '../../db/schema';
import { vehicleFinancing } from '../../db/schema';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

export class FinancingRepository extends BaseRepository<VehicleFinancing, NewVehicleFinancing> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, vehicleFinancing);
  }

  // ============================================================================
  // FINANCING OPERATIONS
  // ============================================================================

  async findByVehicleId(vehicleId: string): Promise<VehicleFinancing | null> {
    const result = await this.db
      .select()
      .from(vehicleFinancing)
      .where(eq(vehicleFinancing.vehicleId, vehicleId))
      .limit(1);
    return result[0] || null;
  }

  async findActiveFinancing(): Promise<VehicleFinancing[]> {
    return await this.db
      .select()
      .from(vehicleFinancing)
      .where(eq(vehicleFinancing.isActive, true))
      .orderBy(asc(vehicleFinancing.startDate));
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

// Export singleton instance
export const financingRepository = new FinancingRepository(getDb());
