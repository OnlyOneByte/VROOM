/**
 * Insurance Hooks
 *
 * Cross-domain side effects triggered by insurance operations.
 * Called from route handlers, not from the repository.
 */

import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';

interface TermExpenseParams {
  termId: string;
  vehicleIds: string[];
  totalCost: number;
  startDate: Date;
  policyNumber?: string;
  userId: string;
}

/**
 * Auto-create a split expense across covered vehicles when an insurance term
 * has a totalCost. The expense is tagged 'insurance' so the UI can detect it
 * as insurance-managed and prevent manual edits.
 */
export async function createTermExpenses(params: TermExpenseParams): Promise<void> {
  const { termId, vehicleIds, totalCost, startDate, policyNumber, userId } = params;

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
        insuranceTermId: termId,
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
  const { termId, vehicleIds, totalCost, userId } = params;

  try {
    // Delete old auto-created expenses for this term
    const deleted = await expenseRepository.deleteByInsuranceTermId(termId, userId);
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
