/**
 * Insurance Hooks
 *
 * Cross-domain side effects triggered by insurance operations.
 * Called from route handlers, not from the repository.
 */

import { monthKeysInRange } from '../../utils/analytics-charts';
import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';
import type { TermCoverageRow } from './repository';

/**
 * Derive the vehicleIds covered by a single term from a policy's junction coverage rows.
 * One source of truth for the `termVehicleCoverage.filter(termId).map(vehicleId)` derivation that
 * the three term-expense sites (create-policy loop, addTerm, updateTerm in routes.ts) repeated
 * byte-identically (C273 dedup). Pure — no DB.
 */
export function vehicleIdsForTerm(
  termVehicleCoverage: readonly TermCoverageRow[],
  termId: string
): string[] {
  return termVehicleCoverage.filter((tc) => tc.termId === termId).map((tc) => tc.vehicleId);
}

interface TermExpenseParams {
  termId: string;
  vehicleIds: string[];
  totalCost: number;
  startDate: Date;
  /** #69: a monthly-premium term (no totalCost) — materialize monthlyCost × term-months into TCO. */
  monthlyCost?: number | null;
  endDate?: Date | null;
  policyNumber?: string;
  userId: string;
}

/**
 * The cost a term materializes into TCO (#69): the explicit `totalCost` when present, else a
 * monthly-only term's `monthlyCost × the number of calendar months it spans` (the same month-count
 * `effectiveMonthlyPremium` uses to amortize a totalCost-only term, so the two cost shapes are
 * symmetric). Returns 0 when neither is set or the span is empty. Pre-#69, a monthly-only term created
 * NO expense row → it showed in analytics (effectiveMonthlyPremium honours monthlyCost) but was ABSENT
 * from TCO's insuranceCost bucket — the inconsistency #69 closes. No double-count: analytics reads
 * term.monthlyCost directly, never the materialized expense rows TCO sums.
 */
export function effectiveTermCost(params: {
  totalCost: number;
  monthlyCost?: number | null;
  startDate: Date;
  endDate?: Date | null;
}): number {
  if (params.totalCost > 0) return params.totalCost;
  if (params.monthlyCost != null && params.monthlyCost > 0) {
    const months = monthKeysInRange(params.startDate, params.endDate ?? null).length;
    return params.monthlyCost * months;
  }
  return 0;
}

/**
 * Auto-create a split expense across covered vehicles when an insurance term has a cost — either an
 * explicit totalCost or a monthly premium materialized over the term (#69). The expense is tagged
 * 'insurance' so the UI can detect it as insurance-managed and prevent manual edits.
 */
export async function createTermExpenses(params: TermExpenseParams): Promise<void> {
  const { termId, vehicleIds, startDate, policyNumber, userId } = params;
  const totalCost = effectiveTermCost(params);

  if (totalCost <= 0 || vehicleIds.length === 0) return;

  try {
    const description = policyNumber ? `Insurance premium — ${policyNumber}` : 'Insurance premium';

    await expenseRepository.createSplitExpense(
      {
        splitConfig: { method: 'even', vehicleIds },
        category: 'financial',
        tags: ['insurance'],
        date: startDate,
        description,
        totalAmount: totalCost,
        sourceType: 'insurance_term',
        sourceId: termId,
      },
      userId
    );

    logger.info('Auto-created insurance expenses for term', {
      termId,
      vehicleCount: vehicleIds.length,
      totalCost,
    });
  } catch (error) {
    // Log but don't fail the term creation — the term is already persisted
    logger.error('Failed to auto-create insurance expenses', {
      termId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Update auto-created expenses when a term is modified.
 * Deletes old expenses linked to the term and re-creates if totalCost > 0.
 */
export async function updateTermExpenses(params: TermExpenseParams): Promise<void> {
  const { termId, vehicleIds, userId } = params;
  // #69: gate on the EFFECTIVE cost (totalCost OR monthlyCost × months), matching createTermExpenses.
  const totalCost = effectiveTermCost(params);

  try {
    // Delete old auto-created expenses for this term
    const deleted = await expenseRepository.deleteBySource('insurance_term', termId, userId);
    if (deleted > 0) {
      logger.info('Deleted old insurance expenses for term update', { termId, deleted });
    }

    // Re-create if there's a cost and vehicles
    if (totalCost > 0 && vehicleIds.length > 0) {
      await createTermExpenses(params);
    }
  } catch (error) {
    logger.error('Failed to update insurance expenses for term', {
      termId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
