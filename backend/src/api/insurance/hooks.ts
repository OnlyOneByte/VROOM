/**
 * Insurance Hooks
 *
 * Cross-domain side effects triggered by insurance operations.
 * Called from route handlers, not from the repository.
 */

import { AppError } from '../../errors';
import { monthKeysInRange } from '../../utils/analytics-charts';
import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';
import { deletePhotosForEntities } from '../photos/photo-service';
import type { TermCoverageRow } from './repository';

/**
 * Derive the vehicleIds covered by a single term from a policy's junction coverage rows.
 * One source of truth for the `termVehicleCoverage.filter(termId).map(vehicleId)` derivation that
 * the three term-expense sites (create-policy loop, addTerm, updateTerm in routes.ts) repeated
 * byte-identically. Pure — no DB.
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
  /** A monthly-premium term (no totalCost) — materialize monthlyCost × term-months into TCO. */
  monthlyCost?: number | null;
  endDate?: Date | null;
  policyNumber?: string;
  userId: string;
}

/**
 * The cost a term materializes into TCO: the explicit `totalCost` when present, else a
 * monthly-only term's `monthlyCost × the number of calendar months it spans` (the same month-count
 * `effectiveMonthlyPremium` uses to amortize a totalCost-only term, so the two cost shapes are
 * symmetric). Returns 0 when neither is set or the span is empty.
 *
 * A monthly-only term used to materialize NO expense row at all, so it showed in analytics
 * (effectiveMonthlyPremium honours monthlyCost) but was ABSENT from TCO's insuranceCost bucket;
 * deriving a cost here closes that inconsistency. No double-count: analytics reads term.monthlyCost
 * directly, never the materialized expense rows TCO sums.
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
 * Write the term's premium as a split expense across its covered vehicles, tagged 'insurance' so
 * the UI can detect it as insurance-managed and prevent manual edits. Throws on failure — each
 * caller decides what a failure means for the operation it is part of.
 */
async function materializeTermExpenses(
  params: TermExpenseParams,
  totalCost: number
): Promise<void> {
  const { termId, vehicleIds, startDate, policyNumber, userId } = params;
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
}

/**
 * Auto-create a split expense across covered vehicles when an insurance term has a cost — either an
 * explicit totalCost or a monthly premium materialized over the term.
 */
export async function createTermExpenses(params: TermExpenseParams): Promise<void> {
  const totalCost = effectiveTermCost(params);

  if (totalCost <= 0 || params.vehicleIds.length === 0) return;

  try {
    await materializeTermExpenses(params, totalCost);
  } catch (error) {
    // The term is already persisted and nothing was deleted to get here, so a failure leaves the
    // ledger merely incomplete — let the term stand rather than failing a successful write.
    logger.error('Failed to auto-create insurance expenses', {
      termId: params.termId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Re-materialize a term's premium expenses after the term is modified: drop the old rows, then
 * write new ones for the term's current cost and coverage.
 *
 * The two steps cannot share a transaction (createSplitExpense opens its own), so the recreate
 * failing is a window where the term's premium has been destroyed and not replaced. Swallowing that
 * would erase the premium from the expense ledger and from TCO behind a 200 "Term updated
 * successfully" — a silent loss with only a log line. It is surfaced instead, naming what did and
 * did not happen, so the user can retry by re-saving the term.
 */
export async function updateTermExpenses(params: TermExpenseParams): Promise<void> {
  const { termId, vehicleIds, userId } = params;
  // Gate on the EFFECTIVE cost (totalCost OR monthlyCost × months), matching createTermExpenses.
  const totalCost = effectiveTermCost(params);

  // deleteBySource drops the linked expenses' photo ROWS with raw SQL, which cascades photo_refs
  // away and leaves the receipt's copy in the user's Drive/Dropbox with nothing pointing at it.
  // Delete through the photo service first so the external file goes too. The repository cannot
  // call the service itself without an import cycle, so every caller compensates here.
  const linked = await expenseRepository.findBySource('insurance_term', termId, userId);
  await deletePhotosForEntities(
    'expense',
    linked.map((expense) => expense.id),
    userId
  );

  const deleted = await expenseRepository.deleteBySource('insurance_term', termId, userId);
  if (deleted > 0) {
    logger.info('Deleted old insurance expenses for term update', { termId, deleted });
  }

  if (totalCost <= 0 || vehicleIds.length === 0) return;

  try {
    await materializeTermExpenses(params, totalCost);
  } catch (error) {
    logger.error('Failed to recreate insurance expenses for term update', {
      termId,
      deleted,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(
      'The insurance term was saved, but its premium expense could not be recreated. ' +
        'Re-save the term to retry.',
      500
    );
  }
}
