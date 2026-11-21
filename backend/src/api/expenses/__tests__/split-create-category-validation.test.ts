import { describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import { EXPENSE_CATEGORIES } from '../../../db/types';
import { createSplitExpenseSchema } from '../validation';

const base = {
  splitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
  date: '2024-03-15T00:00:00.000Z',
  totalAmount: 100,
};

describe('createSplitExpenseSchema category and description', () => {
  test('accepts every non-fuel expense category', () => {
    for (const category of EXPENSE_CATEGORIES.filter((c) => c !== 'fuel')) {
      expect(createSplitExpenseSchema.safeParse({ ...base, category }).success, category).toBe(
        true
      );
    }
  });

  test('rejects a category outside the known list', () => {
    expect(createSplitExpenseSchema.safeParse({ ...base, category: 'snacks' }).success).toBe(false);
  });

  test('rejects fuel, which needs per-vehicle volume and mileage', () => {
    const result = createSplitExpenseSchema.safeParse({ ...base, category: 'fuel' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['category']);
  });

  test('caps the description at the single-expense limit', () => {
    const max = CONFIG.validation.expense.descriptionMaxLength;
    const ok = { ...base, category: 'maintenance', description: 'a'.repeat(max) };
    const tooLong = { ...ok, description: 'a'.repeat(max + 1) };
    expect(createSplitExpenseSchema.safeParse(ok).success).toBe(true);
    expect(createSplitExpenseSchema.safeParse(tooLong).success).toBe(false);
  });
});
