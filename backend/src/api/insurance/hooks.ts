import { appContext, repos } from '../../app-context';
import { CONFIG } from '../../config';
import { AppError, ConflictError, ValidationError } from '../../errors';
import { termBillingMonths } from '../../utils/calculations';
import { logger } from '../../utils/logger';
import { formatNumberForMessage } from '../../utils/money';
import { deleteStoredPhotoObjects, storedPhotoObjects } from '../photos/photo-service';
import type { MonthlyPricedTerm, TermCoverageRow } from './repository';

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

  const linked = await repos().expenses.findBySource('insurance_term', term.id, term.userId);
  const groupIds = new Set(linked.map((expense) => expense.groupId));
  const first = linked[0];
  if (!first?.groupId || groupIds.size !== 1 || first.splitMethod !== 'even') return false;
  const rowsTotal = linked.reduce((sum, expense) => sum + expense.expenseAmount, 0);
  if (first.groupTotal !== overcounted || rowsTotal !== overcounted) return false;

  const policy = await repos().insurancePolicies.findById(term.policyId);
  const vehicleIds = vehicleIdsForTerm(policy?.termVehicleCoverage ?? [], term.id);
  const linkedVehicleIds = linked.map((expense) => expense.vehicleId).sort();
  if ([...vehicleIds].sort().join(',') !== linkedVehicleIds.join(',')) return false;

  await repos().expenses.updateSplitExpense(
    first.groupId,
    {
      splitConfig: { method: 'even', vehicleIds },
      totalAmount: corrected,
    },
    term.userId
  );
  return true;
}

export async function recalculateOvercountedMonthlyPremiums(): Promise<number> {
  const terms = await repos().insurancePolicies.findMonthlyPricedTerms();
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

const MAX_TERM_PREMIUM = CONFIG.validation.expense.maxAmount;

export function assertTermPremiumWithinCap(
  params: Parameters<typeof effectiveTermCost>[0],
  scale: number
): void {
  if (effectiveTermCost(params) > MAX_TERM_PREMIUM * scale) {
    throw new ValidationError(
      `A term's premium can be at most ${formatNumberForMessage(MAX_TERM_PREMIUM)}. ` +
        'Lower the monthly cost or shorten the term.'
    );
  }
}

function createPremiumExpenses(params: TermExpenseParams, totalCost: number) {
  const { termId, vehicleIds, startDate, policyNumber, userId } = params;
  const description = policyNumber ? `Insurance premium — ${policyNumber}` : 'Insurance premium';
  return repos().expenses.createSplitExpense(
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
}

function atScale<T>(userId: string, scale: number | undefined, write: () => Promise<T>) {
  return scale === undefined
    ? appContext().asyncDb.transaction(write)
    : repos().preferences.writeAtScale(userId, scale, write);
}

async function materializeTermExpenses(
  params: TermExpenseParams,
  totalCost: number,
  scale?: number
): Promise<void> {
  await atScale(params.userId, scale, () => createPremiumExpenses(params, totalCost));
  logger.info('Auto-created insurance expenses for term', {
    termId: params.termId,
    vehicleCount: params.vehicleIds.length,
    totalCost,
  });
}

export async function createTermExpenses(params: TermExpenseParams, scale?: number): Promise<void> {
  const totalCost = effectiveTermCost(params);

  if (totalCost <= 0 || params.vehicleIds.length === 0) return;

  try {
    await materializeTermExpenses(params, totalCost, scale);
  } catch (error) {
    if (error instanceof ConflictError) throw error;
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
  let photoObjects: Awaited<ReturnType<typeof storedPhotoObjects>> = [];
  const removed = await appContext().asyncDb.transaction(async () => {
    const linked = await repos().expenses.findBySource('insurance_term', termId, userId);
    photoObjects = await storedPhotoObjects(
      'expense',
      linked.map((expense) => expense.id)
    );
    return repos().expenses.deleteBySource('insurance_term', termId, userId);
  });
  await deleteStoredPhotoObjects(photoObjects, userId);
  return removed;
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
  const linked = await repos().expenses.findBySource(
    'insurance_term',
    params.termId,
    params.userId
  );
  return expectsExpenses === linked.length > 0;
}

export async function updateTermExpenses(
  params: TermExpenseParams,
  previous?: TermExpenseParams,
  scale?: number
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
  let photoObjects: Awaited<ReturnType<typeof storedPhotoObjects>> = [];

  try {
    const deleted = await atScale(userId, scale, async () => {
      const linked = await repos().expenses.findBySource('insurance_term', termId, userId);
      photoObjects = await storedPhotoObjects(
        'expense',
        linked.map((expense) => expense.id)
      );
      const removed = await repos().expenses.deleteBySource('insurance_term', termId, userId);
      if (totalCost > 0 && vehicleIds.length > 0) await createPremiumExpenses(params, totalCost);
      return removed;
    });
    logger.info('Replaced insurance expenses for term update', { termId, deleted });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    logger.error('Failed to replace insurance expenses for term update', {
      termId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(
      'The insurance term was saved, but its premium expense could not be updated. ' +
        'Re-save the term to retry.',
      500
    );
  }
  await deleteStoredPhotoObjects(photoObjects, userId);
}
