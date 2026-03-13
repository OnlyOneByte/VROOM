/**
 * Property-Based Tests for Financing Hooks
 *
 * Property 1: Balance Consistency
 * For any vehicle with active financing and any set of financing expenses,
 * `currentBalance` should equal `originalAmount - sum(expenseAmounts)`,
 * clamped to [0, originalAmount].
 *
 * **Validates: Requirements 3.1, 4.1, 5.1, 5.5, 7.2**
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import fc from 'fast-check';
import type { Expense, VehicleFinancing } from '../../../db/schema';

// ---------------------------------------------------------------------------
// Mutable state that simulates the financing record in the database
// ---------------------------------------------------------------------------
let mockFinancing: VehicleFinancing | null = null;

// Mock the repository module BEFORE importing hooks
mock.module('../repository', () => ({
  financingRepository: {
    findByVehicleId: async (_vehicleId: string) => mockFinancing,
    updateBalance: async (_id: string, newBalance: number) => {
      if (!mockFinancing) throw new Error('No financing record');
      mockFinancing = { ...mockFinancing, currentBalance: newBalance, updatedAt: new Date() };
      return mockFinancing;
    },
    markAsCompleted: async (_id: string, endDate: Date) => {
      if (!mockFinancing) throw new Error('No financing record');
      mockFinancing = {
        ...mockFinancing,
        isActive: false,
        currentBalance: 0,
        endDate,
        updatedAt: new Date(),
      };
      return mockFinancing;
    },
    update: async (_id: string, data: Partial<VehicleFinancing>) => {
      if (!mockFinancing) throw new Error('No financing record');
      mockFinancing = { ...mockFinancing, ...data, updatedAt: new Date() };
      return mockFinancing;
    },
  },
}));

// Import hooks AFTER mocking
const { handleFinancingOnCreate, handleFinancingOnDelete, handleFinancingOnUpdate } = await import(
  '../hooks'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinancing(originalAmount: number): VehicleFinancing {
  return {
    id: 'fin-1',
    vehicleId: 'vehicle-1',
    financingType: 'loan',
    provider: 'Test Bank',
    originalAmount,
    currentBalance: originalAmount,
    apr: 5.0,
    termMonths: 60,
    startDate: new Date('2024-01-01'),
    paymentAmount: 500,
    paymentFrequency: 'monthly',
    paymentDayOfMonth: 15,
    paymentDayOfWeek: null,
    residualValue: null,
    mileageLimit: null,
    excessMileageFee: null,
    isActive: true,
    endDate: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
}

function makeExpense(vehicleId: string, amount: number, index: number): Expense {
  return {
    id: `exp-${index}`,
    vehicleId,
    category: 'financial',
    tags: [],
    date: new Date(`2024-${String(Math.min(index + 1, 12)).padStart(2, '0')}-15`),
    expenseAmount: amount,
    isFinancingPayment: true,
    mileage: null,
    description: `Payment ${index + 1}`,
    receiptUrl: null,
    fuelAmount: null,
    fuelType: null,
    insurancePolicyId: null,
    insuranceTermId: null,
    missedFillup: false,
    userId: 'test-user',
    groupId: null,
    groupTotal: null,
    splitMethod: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Property 1: Balance Consistency
// ---------------------------------------------------------------------------
describe('Property 1: Balance Consistency', () => {
  afterEach(() => {
    mockFinancing = null;
  });

  test('currentBalance equals max(0, originalAmount - sum(expenseAmounts)) after sequential creates', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a positive original amount (reasonable financing range)
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        // Generate 1-20 positive expense amounts
        fc.array(fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 20,
        }),
        async (originalAmount, expenseAmounts) => {
          // Round to 2 decimal places to avoid floating-point noise
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const roundedAmounts = expenseAmounts.map((a) => Math.round(a * 100) / 100);

          // Set up fresh financing state
          mockFinancing = makeFinancing(roundedOriginal);

          // Apply each expense sequentially via the hook
          for (let i = 0; i < roundedAmounts.length; i++) {
            const expense = makeExpense('vehicle-1', roundedAmounts[i], i);
            await handleFinancingOnCreate(expense);
          }

          // Compute expected balance
          const totalPaid = roundedAmounts.reduce((sum, a) => sum + a, 0);
          const expectedBalance = Math.max(0, roundedOriginal - totalPaid);

          // The actual balance from our mock state
          const actualBalance = mockFinancing?.currentBalance ?? 0;

          // Allow small floating-point tolerance
          expect(Math.abs(actualBalance - expectedBalance)).toBeLessThanOrEqual(0.02);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Create-Delete Symmetry
//
// Creating then deleting a financing expense should restore `currentBalance`
// to its pre-creation value (clamped to [0, originalAmount]).
//
// **Validates: Requirements 3.1, 3.2, 4.1, 4.2**
// ---------------------------------------------------------------------------
describe('Property 2: Create-Delete Symmetry', () => {
  afterEach(() => {
    mockFinancing = null;
  });

  test('create then delete restores currentBalance to its pre-creation value', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a positive original amount
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        // Generate a positive expense amount
        fc.double({ min: 0.01, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, expenseAmount) => {
          // Round to 2 decimal places to avoid floating-point noise
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const roundedExpense = Math.round(expenseAmount * 100) / 100;

          // Set up financing with currentBalance = originalAmount (fresh financing)
          mockFinancing = makeFinancing(roundedOriginal);

          // Record balance before creation
          const balanceBefore = mockFinancing.currentBalance;

          // Create the expense
          const expense = makeExpense('vehicle-1', roundedExpense, 0);
          await handleFinancingOnCreate(expense);

          // Delete the same expense
          await handleFinancingOnDelete(expense);

          // Balance should be restored to pre-creation value
          const balanceAfter = mockFinancing?.currentBalance ?? 0;
          expect(Math.abs(balanceAfter - balanceBefore)).toBeLessThanOrEqual(0.02);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('create then delete restores balance when starting from a partial balance', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a positive original amount
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        // Generate a fraction for starting balance (0..1 of originalAmount)
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, balanceFraction) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const startBalance = Math.round(roundedOriginal * balanceFraction * 100) / 100;

          // Set up financing with a partial starting balance
          mockFinancing = makeFinancing(roundedOriginal);
          mockFinancing = { ...mockFinancing, currentBalance: startBalance };

          // Generate expense amount that doesn't exceed starting balance
          // so that create-delete is perfectly symmetric
          const expenseAmount =
            startBalance > 0.01
              ? Math.round(Math.min(startBalance, roundedOriginal) * balanceFraction * 100) / 100
              : 0.01;

          if (expenseAmount < 0.01) return; // skip degenerate case

          const balanceBefore = mockFinancing.currentBalance;

          const expense = makeExpense('vehicle-1', expenseAmount, 0);
          await handleFinancingOnCreate(expense);
          await handleFinancingOnDelete(expense);

          const balanceAfter = mockFinancing?.currentBalance ?? 0;
          expect(Math.abs(balanceAfter - balanceBefore)).toBeLessThanOrEqual(0.02);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('create then delete reactivates auto-completed financing', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate original amount
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;

          // Set up financing at full balance
          mockFinancing = makeFinancing(roundedOriginal);

          // Create an expense that pays off the entire balance
          const expense = makeExpense('vehicle-1', roundedOriginal, 0);
          await handleFinancingOnCreate(expense);

          // Financing should be auto-completed
          expect(mockFinancing?.isActive).toBe(false);
          expect(mockFinancing?.currentBalance).toBeLessThanOrEqual(0.01);

          // Delete the expense — should reactivate
          await handleFinancingOnDelete(expense);

          expect(mockFinancing?.isActive).toBe(true);
          expect(mockFinancing?.endDate).toBeNull();
          expect(
            Math.abs((mockFinancing?.currentBalance ?? 0) - roundedOriginal)
          ).toBeLessThanOrEqual(0.02);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Update Delta Correctness
//
// Updating a financing expense from amount `a1` to `a2` should change balance
// by `a1 - a2`, including flag transitions.
//
// **Validates: Requirements 5.1, 5.2, 5.3, 5.5**
// ---------------------------------------------------------------------------
describe('Property 3: Update Delta Correctness', () => {
  afterEach(() => {
    mockFinancing = null;
  });

  test('amount change while still financing adjusts balance by oldAmount - newAmount', async () => {
    await fc.assert(
      fc.asyncProperty(
        // originalAmount for the financing record
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        // starting balance as a fraction of originalAmount
        fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
        // old expense amount
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        // new expense amount
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, balanceFrac, oldAmount, newAmount) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const startBalance = Math.round(roundedOriginal * balanceFrac * 100) / 100;
          const roundedOld = Math.round(oldAmount * 100) / 100;
          const roundedNew = Math.round(newAmount * 100) / 100;

          mockFinancing = makeFinancing(roundedOriginal);
          mockFinancing = { ...mockFinancing, currentBalance: startBalance };

          const existingExpense = makeExpense('vehicle-1', roundedOld, 0);

          await handleFinancingOnUpdate(existingExpense, {
            expenseAmount: roundedNew,
          });

          // Expected: clamp(startBalance + (oldAmount - newAmount), 0, originalAmount)
          const delta = roundedOld - roundedNew;
          const expectedBalance = Math.max(0, Math.min(roundedOriginal, startBalance + delta));

          const actualBalance = mockFinancing?.currentBalance ?? 0;
          expect(Math.abs(actualBalance - expectedBalance)).toBeLessThanOrEqual(0.02);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('flag true→false reverses the original deduction (adds back oldAmount)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, balanceFrac, oldAmount) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const startBalance = Math.round(roundedOriginal * balanceFrac * 100) / 100;
          const roundedOld = Math.round(oldAmount * 100) / 100;

          mockFinancing = makeFinancing(roundedOriginal);
          mockFinancing = { ...mockFinancing, currentBalance: startBalance };

          // Existing expense IS a financing payment
          const existingExpense = makeExpense('vehicle-1', roundedOld, 0);

          // Update: flag changes to false
          await handleFinancingOnUpdate(existingExpense, {
            isFinancingPayment: false,
          });

          // Expected: clamp(startBalance + oldAmount, 0, originalAmount)
          const expectedBalance = Math.max(0, Math.min(roundedOriginal, startBalance + roundedOld));

          const actualBalance = mockFinancing?.currentBalance ?? 0;
          expect(Math.abs(actualBalance - expectedBalance)).toBeLessThanOrEqual(0.02);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('flag false→true applies a new deduction (subtracts newAmount)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, balanceFrac, newAmount) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const startBalance = Math.round(roundedOriginal * balanceFrac * 100) / 100;
          const roundedNew = Math.round(newAmount * 100) / 100;

          mockFinancing = makeFinancing(roundedOriginal);
          mockFinancing = { ...mockFinancing, currentBalance: startBalance };

          // Existing expense is NOT a financing payment
          const existingExpense: Expense = {
            ...makeExpense('vehicle-1', roundedNew, 0),
            isFinancingPayment: false,
          };

          // Update: flag changes to true
          await handleFinancingOnUpdate(existingExpense, {
            isFinancingPayment: true,
            expenseAmount: roundedNew,
          });

          // Expected: clamp(startBalance - newAmount, 0, originalAmount)
          const expectedBalance = Math.max(0, Math.min(roundedOriginal, startBalance - roundedNew));

          const actualBalance = mockFinancing?.currentBalance ?? 0;
          expect(Math.abs(actualBalance - expectedBalance)).toBeLessThanOrEqual(0.02);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Non-Financing Expense Isolation
//
// Expenses with `isFinancingPayment` false/undefined/null should never change
// any `currentBalance`.
//
// **Validates: Requirements 3.5, 4.4, 5.4**
// ---------------------------------------------------------------------------
describe('Property 5: Non-Financing Expense Isolation', () => {
  afterEach(() => {
    mockFinancing = null;
  });

  test('handleFinancingOnCreate with isFinancingPayment: false does not change balance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, balanceFrac, expenseAmount) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const startBalance = Math.round(roundedOriginal * balanceFrac * 100) / 100;
          const roundedExpense = Math.round(expenseAmount * 100) / 100;

          mockFinancing = makeFinancing(roundedOriginal);
          mockFinancing = { ...mockFinancing, currentBalance: startBalance };

          const balanceBefore = mockFinancing.currentBalance;

          const expense: Expense = {
            ...makeExpense('vehicle-1', roundedExpense, 0),
            isFinancingPayment: false,
          };

          const result = await handleFinancingOnCreate(expense);

          expect(result).toBeNull();
          expect(mockFinancing.currentBalance).toBe(balanceBefore);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('handleFinancingOnDelete with isFinancingPayment: false does not change balance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, balanceFrac, expenseAmount) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const startBalance = Math.round(roundedOriginal * balanceFrac * 100) / 100;
          const roundedExpense = Math.round(expenseAmount * 100) / 100;

          mockFinancing = makeFinancing(roundedOriginal);
          mockFinancing = { ...mockFinancing, currentBalance: startBalance };

          const balanceBefore = mockFinancing.currentBalance;

          const expense: Expense = {
            ...makeExpense('vehicle-1', roundedExpense, 0),
            isFinancingPayment: false,
          };

          const result = await handleFinancingOnDelete(expense);

          expect(result).toBeNull();
          expect(mockFinancing.currentBalance).toBe(balanceBefore);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('handleFinancingOnUpdate with both existing and update having isFinancingPayment: false does not change balance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, balanceFrac, oldAmount, newAmount) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const startBalance = Math.round(roundedOriginal * balanceFrac * 100) / 100;
          const roundedOld = Math.round(oldAmount * 100) / 100;
          const roundedNew = Math.round(newAmount * 100) / 100;

          mockFinancing = makeFinancing(roundedOriginal);
          mockFinancing = { ...mockFinancing, currentBalance: startBalance };

          const balanceBefore = mockFinancing.currentBalance;

          const existingExpense: Expense = {
            ...makeExpense('vehicle-1', roundedOld, 0),
            isFinancingPayment: false,
          };

          const result = await handleFinancingOnUpdate(existingExpense, {
            isFinancingPayment: false,
            expenseAmount: roundedNew,
          });

          expect(result).toBeNull();
          expect(mockFinancing.currentBalance).toBe(balanceBefore);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Financing Active Status Consistency
//
// Balance ≤ 0.01 after payment → `isActive = false`; deletion restoring
// balance > 0.01 on auto-completed financing → `isActive = true`,
// `endDate = null`.
//
// **Validates: Requirements 3.3, 4.3**
// ---------------------------------------------------------------------------
describe('Property 6: Financing Active Status Consistency', () => {
  afterEach(() => {
    mockFinancing = null;
  });

  test('payment bringing balance ≤ 0.01 marks financing as inactive with endDate set', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate original amount
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        // Generate current balance as a fraction of original (at least 0.02 so a payment can reach ≤ 0.01)
        fc.double({ min: 0.02, max: 1, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, balanceFrac) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const startBalance = Math.round(roundedOriginal * balanceFrac * 100) / 100;

          if (startBalance < 0.02) return; // need enough balance to pay off

          // Pay the entire current balance so the result is 0 (≤ 0.01)
          const expenseAmount = startBalance;

          mockFinancing = makeFinancing(roundedOriginal);
          mockFinancing = { ...mockFinancing, currentBalance: startBalance };

          expect(mockFinancing.isActive).toBe(true);

          const expense = makeExpense('vehicle-1', expenseAmount, 0);
          await handleFinancingOnCreate(expense);

          // Balance should be ≤ 0.01, so financing should be inactive
          expect(mockFinancing?.currentBalance).toBeLessThanOrEqual(0.01);
          expect(mockFinancing?.isActive).toBe(false);
          expect(mockFinancing?.endDate).not.toBeNull();
        }
      ),
      { numRuns: 200 }
    );
  });

  test('deleting payment from auto-completed financing restores isActive and clears endDate', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate original amount
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;

          // Set up financing at full balance
          mockFinancing = makeFinancing(roundedOriginal);

          // Create a payment that pays off the entire balance (auto-completes)
          const expense = makeExpense('vehicle-1', roundedOriginal, 0);
          await handleFinancingOnCreate(expense);

          // Verify auto-completed
          expect(mockFinancing?.isActive).toBe(false);
          expect(mockFinancing?.endDate).not.toBeNull();

          // Delete the payment — balance restored above 0.01
          await handleFinancingOnDelete(expense);

          // Should be reactivated
          expect(mockFinancing?.isActive).toBe(true);
          expect(mockFinancing?.endDate).toBeNull();
          expect(mockFinancing?.currentBalance ?? 0).toBeGreaterThan(0.01);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('payment that keeps balance above 0.01 does not change isActive', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate original amount
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        // Generate expense as a small fraction of original so balance stays well above 0.01
        fc.double({ min: 0.01, max: 0.3, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, expenseFraction) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          // Expense is a fraction of original, ensuring balance stays above 0.01
          const expenseAmount = Math.round(roundedOriginal * expenseFraction * 100) / 100;
          const expectedBalance = Math.max(0, roundedOriginal - expenseAmount);

          // Skip if the payment would bring balance to ≤ 0.01
          if (expectedBalance <= 0.01) return;
          if (expenseAmount < 0.01) return;

          mockFinancing = makeFinancing(roundedOriginal);

          expect(mockFinancing.isActive).toBe(true);

          const expense = makeExpense('vehicle-1', expenseAmount, 0);
          await handleFinancingOnCreate(expense);

          // Balance is still above 0.01, so financing should remain active
          expect(mockFinancing?.isActive).toBe(true);
          expect(mockFinancing?.endDate).toBeNull();
          expect(mockFinancing?.currentBalance ?? 0).toBeGreaterThan(0.01);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Financing Payment Validation
//
// Creating an expense with `isFinancingPayment: true` when vehicle has no
// active financing should be rejected. At the hook level, this means
// `handleFinancingOnCreate()` returns `null` and produces no side effects.
//
// **Validates: Requirement 3.4**
// ---------------------------------------------------------------------------
describe('Property 8: Financing Payment Validation', () => {
  afterEach(() => {
    mockFinancing = null;
  });

  test('handleFinancingOnCreate returns null and has no side effects when no financing record exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        async (expenseAmount) => {
          const roundedExpense = Math.round(expenseAmount * 100) / 100;

          // No financing record at all
          mockFinancing = null;

          const expense = makeExpense('vehicle-1', roundedExpense, 0);
          const result = await handleFinancingOnCreate(expense);

          // Hook should return null — no financing to adjust
          expect(result).toBeNull();
          // mockFinancing should still be null (no side effects)
          expect(mockFinancing).toBeNull();
        }
      ),
      { numRuns: 200 }
    );
  });

  test('handleFinancingOnCreate returns null and does not change balance when financing is inactive', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        async (originalAmount, balanceFrac, expenseAmount) => {
          const roundedOriginal = Math.round(originalAmount * 100) / 100;
          const startBalance = Math.round(roundedOriginal * balanceFrac * 100) / 100;
          const roundedExpense = Math.round(expenseAmount * 100) / 100;

          // Financing exists but is inactive (e.g., already completed)
          mockFinancing = {
            ...makeFinancing(roundedOriginal),
            currentBalance: startBalance,
            isActive: false,
            endDate: new Date('2024-06-01'),
          };

          const balanceBefore = mockFinancing.currentBalance;
          const isActiveBefore = mockFinancing.isActive;

          const expense = makeExpense('vehicle-1', roundedExpense, 0);
          const result = await handleFinancingOnCreate(expense);

          // Hook should return null — financing is not active
          expect(result).toBeNull();
          // Balance and active status should be unchanged
          expect(mockFinancing.currentBalance).toBe(balanceBefore);
          expect(mockFinancing.isActive).toBe(isActiveBefore);
        }
      ),
      { numRuns: 200 }
    );
  });
});
