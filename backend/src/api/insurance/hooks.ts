import { AppError } from '../../errors';
import { termBillingMonths } from '../../utils/calculations';
import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';
import { deletePhotosForEntities } from '../photos/photo-service';
import {
  insurancePolicyRepository,
  type MonthlyPricedTerm,
  type TermCoverageRow,
} from './repository';

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

function calendarMonthsTouched(startDate: Date, endDate: Date): number {
  return Math.max(
    0,
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
      (endDate.getMonth() - startDate.getMonth()) +
      1
  );
}

async function recalculateTermPremium(term: MonthlyPricedTerm): Promise<boolean> {
  const monthlyCost = term.monthlyCost ?? 0;
  const overcounted = monthlyCost * calendarMonthsTouched(term.startDate, term.endDate);
  const corrected = monthlyCost * termBillingMonths(term.startDate, term.endDate);
  if (overcounted === corrected) return false;

  const linked = await expenseRepository.findBySource('insurance_term', term.id, term.userId);
  const groupIds = new Set(linked.map((expense) => expense.groupId));
  const first = linked[0];
  if (!first?.groupId || groupIds.size !== 1 || first.splitMethod !== 'even') return false;
  const rowsTotal = linked.reduce((sum, expense) => sum + expense.expenseAmount, 0);
  if (first.groupTotal !== overcounted || rowsTotal !== overcounted) return false;

  await expenseRepository.updateSplitExpense(
    first.groupId,
    {
      splitConfig: { method: 'even', vehicleIds: linked.map((expense) => expense.vehicleId) },
      totalAmount: corrected,
    },
    term.userId
  );
  return true;
}

export async function recalculateOvercountedMonthlyPremiums(): Promise<number> {
  const terms = await insurancePolicyRepository.findMonthlyPricedTerms();
  let recalculated = 0;

  for (const term of terms) {
    try {
      if (await recalculateTermPremium(term)) recalculated++;
    } catch (error) {
      logger.error('Failed to recalculate monthly insurance premium', {
        termId: term.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (recalculated > 0) {
    logger.info('Recalculated over-counted monthly insurance premiums', { recalculated });
  }
  return recalculated;
}

export function effectiveTermCost(params: {
  totalCost: number;
  monthlyCost?: number | null;
  startDate: Date;
  endDate?: Date | null;
}): number {
  if (params.totalCost > 0) return params.totalCost;
  if (params.monthlyCost != null && params.monthlyCost > 0 && params.endDate) {
    return params.monthlyCost * termBillingMonths(params.startDate, params.endDate);
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
    throw new AppError(
      'The premium expense for this insurance term could not be created, so nothing was saved. ' +
        'Try again.',
      500
    );
  }
}

export async function deleteTermExpenses(termId: string, userId: string): Promise<number> {
  // Photo files must be removed first: deleteBySource drops photo rows with raw SQL and orphans the files.
  const linked = await expenseRepository.findBySource('insurance_term', termId, userId);
  await deletePhotosForEntities(
    'expense',
    linked.map((expense) => expense.id),
    userId
  );
  return expenseRepository.deleteBySource('insurance_term', termId, userId);
}

function sameTime(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function termExpenseInputsChanged(previous: TermExpenseParams, next: TermExpenseParams): boolean {
  return (
    previous.totalCost !== next.totalCost ||
    (previous.monthlyCost ?? null) !== (next.monthlyCost ?? null) ||
    !sameTime(previous.startDate, next.startDate) ||
    !sameTime(previous.endDate, next.endDate) ||
    previous.vehicleIds.join(',') !== next.vehicleIds.join(',')
  );
}

async function termExpensesInSync(params: TermExpenseParams): Promise<boolean> {
  const expectsExpenses = effectiveTermCost(params) > 0 && params.vehicleIds.length > 0;
  const linked = await expenseRepository.findBySource(
    'insurance_term',
    params.termId,
    params.userId
  );
  return expectsExpenses === linked.length > 0;
}

// Delete and recreate are not atomic: a failed recreate must throw rather than silently drop the premium.
export async function updateTermExpenses(
  params: TermExpenseParams,
  previous?: TermExpenseParams
): Promise<void> {
  if (
    previous &&
    !termExpenseInputsChanged(previous, params) &&
    (await termExpensesInSync(params))
  ) {
    return;
  }

  const { termId, vehicleIds, userId } = params;
  const totalCost = effectiveTermCost(params);

  const deleted = await deleteTermExpenses(termId, userId);
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
