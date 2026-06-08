/**
 * Financing Repository
 *
 * Vehicle financing operations (loan/lease configuration and computed balance).
 * Payment tracking is handled through the expenses table with source_type = 'financing'.
 * Balance is computed on read: originalAmount - SUM(financing payment expenses).
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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
   * Looks up the financing record's originalAmount, then computes:
   *   originalAmount - COALESCE(SUM(expenses.expenseAmount), 0)
   * WHERE source_type = 'financing' AND source_id = financingId, clamped to min 0.
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
        .where(sql`${expenses.sourceType} = 'financing' AND ${expenses.sourceId} = ${financingId}`);

      const totalPayments = Number(result?.totalPayments) || 0;
      return Math.max(0, financing.originalAmount - totalPayments);
    } catch (error) {
      logger.error('Error computing balance for financing', { financingId, error });
      throw new DatabaseError('Failed to compute financing balance', error);
    }
  }

  /**
   * Batch-compute balances for many financing records in two queries total
   * (vs. computeBalance()'s 2 queries per record). Used by list endpoints to
   * avoid an N+1 over a user's vehicles.
   *
   * Returns a Map keyed by financingId. financingIds with no matching record
   * are omitted from the map (callers should treat a miss as "no balance").
   */
  async computeBalances(financingIds: string[]): Promise<Map<string, number>> {
    const balances = new Map<string, number>();
    if (financingIds.length === 0) {
      return balances;
    }
    try {
      // 1) Fetch the originalAmount for every requested financing record.
      const records = await this.db
        .select({
          id: vehicleFinancing.id,
          originalAmount: vehicleFinancing.originalAmount,
        })
        .from(vehicleFinancing)
        .where(inArray(vehicleFinancing.id, financingIds));

      // 2) Sum financing-payment expenses grouped by source_id, in one pass.
      const paymentRows = await this.db
        .select({
          sourceId: expenses.sourceId,
          totalPayments: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)`,
        })
        .from(expenses)
        .where(
          and(eq(expenses.sourceType, 'financing'), inArray(expenses.sourceId, financingIds))
        )
        .groupBy(expenses.sourceId);

      const paymentsByFinancing = new Map<string, number>();
      for (const row of paymentRows) {
        if (row.sourceId) {
          paymentsByFinancing.set(row.sourceId, Number(row.totalPayments) || 0);
        }
      }

      for (const record of records) {
        const totalPayments = paymentsByFinancing.get(record.id) ?? 0;
        balances.set(record.id, Math.max(0, record.originalAmount - totalPayments));
      }

      return balances;
    } catch (error) {
      logger.error('Error batch-computing financing balances', { count: financingIds.length, error });
      throw new DatabaseError('Failed to compute financing balances', error);
    }
  }
}

// Export singleton instance
export const financingRepository = new FinancingRepository(getDb());
