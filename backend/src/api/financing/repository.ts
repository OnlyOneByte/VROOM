import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewVehicleFinancing, VehicleFinancing } from '../../db/schema';
import { expenses, vehicleFinancing } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

/** Balance in integer cents at or below which a financing counts as paid off. */
export const PAYOFF_BALANCE_THRESHOLD = 100;

export function isEligibleForPayoff(computedBalance: number): boolean {
  return computedBalance <= PAYOFF_BALANCE_THRESHOLD;
}

/** Adds computedBalance and eligibleForPayoff to a financing row. Pure; the caller supplies the balance. */
export function withComputedBalance<T>(
  financing: T,
  computedBalance: number
): T & { computedBalance: number; eligibleForPayoff: boolean } {
  return { ...financing, computedBalance, eligibleForPayoff: isEligibleForPayoff(computedBalance) };
}

export class FinancingRepository extends BaseRepository<VehicleFinancing, NewVehicleFinancing> {
  constructor(db: AppDatabase) {
    super(db, vehicleFinancing);
  }

  async findByVehicleId(vehicleId: string): Promise<VehicleFinancing | null> {
    const result = await this.db
      .select()
      .from(vehicleFinancing)
      .where(eq(vehicleFinancing.vehicleId, vehicleId))
      .limit(1);
    return result[0] || null;
  }

  /**
   * Balance (cents) for one financing record, clamped to 0; 0 if the record does not exist.
   * Delegates to computeBalances so the balance SQL lives in one place.
   */
  async computeBalance(financingId: string): Promise<number> {
    const balances = await this.computeBalances([financingId]);
    return balances.get(financingId) ?? 0;
  }

  /**
   * Balances (cents) keyed by financing id, computed in two queries. Ids with no record are
   * omitted, so a miss means "no balance".
   */
  async computeBalances(financingIds: string[]): Promise<Map<string, number>> {
    const balances = new Map<string, number>();
    if (financingIds.length === 0) {
      return balances;
    }
    try {
      const records = await this.db
        .select({
          id: vehicleFinancing.id,
          originalAmount: vehicleFinancing.originalAmount,
        })
        .from(vehicleFinancing)
        .where(inArray(vehicleFinancing.id, financingIds));

      const paymentRows = await this.db
        .select({
          sourceId: expenses.sourceId,
          totalPayments: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)`,
        })
        .from(expenses)
        .where(and(eq(expenses.sourceType, 'financing'), inArray(expenses.sourceId, financingIds)))
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
      logger.error('Error batch-computing financing balances', {
        count: financingIds.length,
        error,
      });
      throw new DatabaseError('Failed to compute financing balances', error);
    }
  }
}

export const financingRepository = new FinancingRepository(getDb());
