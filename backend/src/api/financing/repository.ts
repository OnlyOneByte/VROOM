/**
 * Financing Repository
 *
 * Vehicle financing operations (loan/lease configuration and computed balance).
 * Payment tracking is handled through the expenses table with isFinancingPayment flag.
 * Balance is computed on read: originalAmount - SUM(financing payment expenses).
 */

import { asc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewVehicleFinancing, VehicleFinancing } from '../../db/schema';
import { expenses, vehicleFinancing } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

export class FinancingRepository extends BaseRepository<VehicleFinancing, NewVehicleFinancing> {
  constructor(db: AppDatabase) {
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

  /**
   * Compute the current balance for a financing record.
   *
   * Looks up the financing record's originalAmount and vehicleId, then computes:
   *   originalAmount - COALESCE(SUM(expenses.expenseAmount), 0)
   * WHERE is_financing_payment = 1 for that vehicle, clamped to min 0.
   *
   * Returns 0 if the financing record does not exist.
   */
  async computeBalance(financingId: string): Promise<number> {
    try {
      const financing = await this.findById(financingId);
      if (!financing) {
        return 0;
      }

      const [result] = await this.db
        .select({
          totalPayments: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)`,
        })
        .from(expenses)
        .where(
          sql`${expenses.vehicleId} = ${financing.vehicleId} AND ${expenses.isFinancingPayment} = 1`
        );

      const totalPayments = Number(result?.totalPayments) || 0;
      return Math.max(0, financing.originalAmount - totalPayments);
    } catch (error) {
      logger.error('Error computing balance for financing', { financingId, error });
      throw new DatabaseError('Failed to compute financing balance', error);
    }
  }
}

// Export singleton instance
export const financingRepository = new FinancingRepository(getDb());
