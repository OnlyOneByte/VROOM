import { AppError } from '../../errors';
import { monthKeysInRange } from '../../utils/analytics-charts';
import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';
import { deletePhotosForEntities } from '../photos/photo-service';
import type { TermCoverageRow } from './repository';

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
  monthlyCost?: number | null;
  endDate?: Date | null;
  policyNumber?: string;
  userId: string;
}

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
    { ownerId: userId, createdBy: null }
  );

  logger.info('Auto-created insurance expenses for term', {
    termId,
    vehicleCount: vehicleIds.length,
    totalCost,
  });
}

export async function createTermExpenses(params: TermExpenseParams): Promise<void> {
  const totalCost = effectiveTermCost(params);

  if (totalCost <= 0 || params.vehicleIds.length === 0) return;

  try {
    await materializeTermExpenses(params, totalCost);
  } catch (error) {
    logger.error('Failed to auto-create insurance expenses', {
      termId: params.termId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Delete and recreate are not atomic: a failed recreate must throw rather than silently drop the premium.
export async function updateTermExpenses(params: TermExpenseParams): Promise<void> {
  const { termId, vehicleIds, userId } = params;
  const totalCost = effectiveTermCost(params);

  // Photo files must be removed first: deleteBySource drops photo rows with raw SQL and orphans the files.
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
