/**
 * Financing Hooks
 *
 * Intercept expense CRUD operations and adjust the vehicle's financing balance
 * when the expense is a financing payment (isFinancingPayment === true).
 */

import type { Expense, NewExpense, VehicleFinancing } from '../../db/schema';
import { financingRepository } from './repository';

/**
 * Detect whether an expense is a financing payment.
 * Returns true if and only if isFinancingPayment === true.
 */
export function isFinancingExpense(expense: { isFinancingPayment?: boolean | null }): boolean {
  return expense.isFinancingPayment === true;
}

/**
 * Hook that runs after a financing expense is created.
 * Subtracts expenseAmount from currentBalance, clamps to 0,
 * and auto-completes financing if balance ≤ 0.01.
 */
export async function handleFinancingOnCreate(expense: Expense): Promise<VehicleFinancing | null> {
  if (!isFinancingExpense(expense)) {
    return null;
  }

  const financing = await financingRepository.findByVehicleId(expense.vehicleId);
  if (!financing || !financing.isActive) {
    return null;
  }

  const newBalance = Math.max(0, financing.currentBalance - expense.expenseAmount);
  let updated = await financingRepository.updateBalance(financing.id, newBalance);

  // Only auto-complete loans when balance is paid off.
  // Leases end at their term date, not when balance reaches zero.
  if (newBalance <= 0.01 && financing.financingType !== 'lease') {
    updated = await financingRepository.markAsCompleted(financing.id, expense.date);
  }

  return updated;
}

/**
 * Hook that runs before a financing expense is deleted.
 * Adds back expenseAmount to currentBalance, clamps to originalAmount,
 * and reactivates financing if it was auto-completed.
 */
export async function handleFinancingOnDelete(expense: Expense): Promise<VehicleFinancing | null> {
  if (!isFinancingExpense(expense)) {
    return null;
  }

  const financing = await financingRepository.findByVehicleId(expense.vehicleId);
  if (!financing) {
    return null;
  }

  const newBalance = Math.min(
    financing.originalAmount,
    financing.currentBalance + expense.expenseAmount
  );
  const updated = await financingRepository.updateBalance(financing.id, newBalance);

  // Reactivate if it was auto-completed and balance is now above threshold
  if (!financing.isActive && newBalance > 0.01) {
    await financingRepository.update(financing.id, {
      isActive: true,
      endDate: null,
    });
  }

  return updated;
}

/**
 * Compute the balance delta for an expense update based on the
 * was-financing / is-financing flag transition.
 */
function computeUpdateBalanceDelta(
  wasFin: boolean,
  isFin: boolean,
  oldAmount: number,
  newAmount: number
): number {
  if (wasFin && isFin) {
    // Case 1: Still a financing expense — adjust by amount delta
    return oldAmount - newAmount;
  }
  if (wasFin) {
    // Case 2: Was financing, no longer — reverse the original deduction
    return oldAmount;
  }
  // Case 3: Became a financing expense — apply the deduction
  return -newAmount;
}

/**
 * Update the financing active status based on the new balance.
 * Auto-completes if balance ≤ 0.01, reactivates if balance > 0.01
 * on a previously auto-completed financing.
 */
async function syncFinancingStatus(
  financing: VehicleFinancing,
  newBalance: number,
  expenseDate: Date
): Promise<void> {
  // Only auto-complete loans when balance is paid off.
  // Leases end at their term date, not when balance reaches zero.
  if (newBalance <= 0.01 && financing.isActive && financing.financingType !== 'lease') {
    await financingRepository.markAsCompleted(financing.id, expenseDate);
  } else if (newBalance > 0.01 && !financing.isActive) {
    await financingRepository.update(financing.id, {
      isActive: true,
      endDate: null,
    });
  }
}

/**
 * Hook that runs on expense update. Handles four cases based on
 * whether the expense was/is a financing payment, and adjusts
 * the balance by the appropriate delta.
 */
export async function handleFinancingOnUpdate(
  existingExpense: Expense,
  updateData: Partial<NewExpense>
): Promise<VehicleFinancing | null> {
  const wasFin = isFinancingExpense(existingExpense);
  const isFin = updateData.isFinancingPayment ?? existingExpense.isFinancingPayment ?? false;

  // Case 4: Was not financing, still not financing — no-op
  if (!wasFin && !isFin) {
    return null;
  }

  const financing = await financingRepository.findByVehicleId(existingExpense.vehicleId);
  if (!financing) {
    return null;
  }

  const oldAmount = existingExpense.expenseAmount;
  const newAmount = updateData.expenseAmount ?? oldAmount;
  const balanceDelta = computeUpdateBalanceDelta(wasFin, isFin, oldAmount, newAmount);

  const newBalance = Math.max(
    0,
    Math.min(financing.originalAmount, financing.currentBalance + balanceDelta)
  );
  const updated = await financingRepository.updateBalance(financing.id, newBalance);

  const expenseDate = updateData.date ?? existingExpense.date;
  await syncFinancingStatus(financing, newBalance, expenseDate);

  return updated;
}
