/**
 * Odometer Hooks
 *
 * Intercept expense CRUD operations and auto-manage linked odometer entries
 * when the expense has a non-null mileage value.
 */

import type { Expense, NewExpense, OdometerEntry } from '../../db/schema';
import { odometerRepository } from './repository';

/**
 * Hook that runs after an expense is created.
 * If the expense has a non-null mileage, creates a linked odometer entry.
 */
export async function handleOdometerOnExpenseCreate(
  expense: Expense,
  userId: string
): Promise<OdometerEntry | null> {
  if (expense.mileage == null) {
    return null;
  }

  return odometerRepository.upsertFromLinkedEntity({
    vehicleId: expense.vehicleId,
    userId,
    odometer: expense.mileage,
    recordedAt: expense.date,
    linkedEntityType: 'expense',
    linkedEntityId: expense.id,
  });
}

/**
 * Hook that runs before an expense is deleted.
 * If the expense has a non-null mileage, deletes the linked odometer entry.
 */
export async function handleOdometerOnExpenseDelete(expense: Expense): Promise<void> {
  if (expense.mileage != null) {
    await odometerRepository.deleteByLinkedEntity('expense', expense.id);
  }
}

/**
 * Hook that runs on expense update. Handles four mileage transition cases:
 * - null → null: no-op
 * - null → value: create linked entry
 * - value → null: delete linked entry
 * - value → value: update linked entry
 */
export async function handleOdometerOnExpenseUpdate(
  existingExpense: Expense,
  updateData: Partial<NewExpense>,
  userId: string
): Promise<OdometerEntry | null> {
  const oldMileage = existingExpense.mileage;
  const newMileage = 'mileage' in updateData ? updateData.mileage : oldMileage;

  // null → null: no-op
  if (oldMileage == null && newMileage == null) {
    return null;
  }

  // value → null: delete linked entry
  if (newMileage == null) {
    await odometerRepository.deleteByLinkedEntity('expense', existingExpense.id);
    return null;
  }

  // null → value or value → value: upsert linked entry
  return odometerRepository.upsertFromLinkedEntity({
    vehicleId: existingExpense.vehicleId,
    userId,
    odometer: newMileage,
    recordedAt: updateData.date ?? existingExpense.date,
    linkedEntityType: 'expense',
    linkedEntityId: existingExpense.id,
  });
}
