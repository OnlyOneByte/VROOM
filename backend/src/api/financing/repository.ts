/**
 * Financing Repository
 *
 * Vehicle financing operations (loan/lease configuration and computed balance).
 * Payment tracking is handled through the expenses table with source_type = 'financing'.
 * Balance is computed on read: originalAmount - SUM(financing payment expenses).
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewVehicleFinancing, VehicleFinancing } from '../../db/schema';
import { expenses, vehicleFinancing } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

/**
 * A computed balance at or below this (in the user's currency) counts as paid off — the small
 * epsilon absorbs float drift so a fully-paid loan reads as eligible, not "$0.003 remaining".
 * One source of truth for the payoff rule: the threshold was hand-inlined as `<= 0.01` at three
 * enrichment sites (vehicles list + single GET, financing GET) — C182 collapsed them onto this.
 */
export const PAYOFF_BALANCE_THRESHOLD = 0.01;

/** Whether a computed financing balance is small enough to count as paid off (see threshold above). */
export function isEligibleForPayoff(computedBalance: number): boolean {
  return computedBalance <= PAYOFF_BALANCE_THRESHOLD;
}

/**
 * Enrich a financing record with the two derived API fields — `computedBalance` (passed in, since the
 * caller decides whether to use the per-record computeBalance or the batch computeBalances) and
 * `eligibleForPayoff`. The `{ ...financing, computedBalance, eligibleForPayoff: isEligibleForPayoff(...) }`
 * shape was hand-rolled at 3 sites (vehicles list + single GET, financing GET — the same trio C182
 * collapsed the threshold across); one source of truth so the derived-field set can't drift between
 * them. Generic over the financing shape so it serves both the full VehicleFinancing and the
 * vehicle-joined financing object. Pure — no DB.
 */
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

  /**
   * Compute the current balance for a financing record:
   *   originalAmount - COALESCE(SUM(expenses.expenseAmount), 0)
   * WHERE source_type = 'financing' AND source_id = financingId, clamped to min 0.
   *
   * Returns 0 if the financing record does not exist.
   *
   * Delegates to the batch `computeBalances` so the originalAmount lookup + the
   * financing-payment SUM (the money query) live in ONE place — a divergent copy of
   * that WHERE/COALESCE block would silently miscount a balance (and TCO downstream).
   * The per-record-vs-batch equivalence is independently pinned by
   * financing-balance.property.test.ts. Both paths run two queries, so no extra cost.
   */
  async computeBalance(financingId: string): Promise<number> {
    const balances = await this.computeBalances([financingId]);
    // computeBalances omits ids with no matching record → mirror the prior `return 0`.
    return balances.get(financingId) ?? 0;
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

// Export singleton instance
export const financingRepository = new FinancingRepository(getDb());
