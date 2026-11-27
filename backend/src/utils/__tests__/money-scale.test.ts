import { describe, expect, test } from 'bun:test';
import { ValidationError } from '../../errors';
import { parsedToMinor, reminderFromApi, splitConfigFromApi, toMajor } from '../money';

describe('parsed amounts become the owner currency minor unit', () => {
  test.each([
    [1234, 100, 1234],
    [120_000, 1, 1200],
    [1234, 1000, 12_340],
  ])('%p parsed cents at scale %p store as %p', (cents, scale, minor) => {
    expect(parsedToMinor(cents, scale)).toBe(minor);
    expect(toMajor(scale).major(minor)).toBe(cents / 100);
  });

  test('an amount finer than the currency allows is refused, not rounded', () => {
    expect(() => parsedToMinor(1234, 1)).toThrow(ValidationError);
    expect(() => parsedToMinor(1234, 1)).toThrow('must be whole numbers');
  });

  test('absolute split allocations and the reminder amount convert together', () => {
    const split = {
      method: 'absolute' as const,
      allocations: [
        { vehicleId: 'a', amount: 1500 },
        { vehicleId: 'b', amount: 500 },
      ],
    };
    expect(splitConfigFromApi(split, 1).allocations.map((a) => a.amount)).toEqual([15, 5]);
    expect(reminderFromApi({ expenseAmount: 2000, expenseSplitConfig: split }, 1)).toEqual({
      expenseAmount: 20,
      expenseSplitConfig: {
        ...split,
        allocations: [
          { vehicleId: 'a', amount: 15 },
          { vehicleId: 'b', amount: 5 },
        ],
      },
    });
    const even = { method: 'even' as const, vehicleIds: ['a'] };
    expect(splitConfigFromApi(even, 1)).toBe(even);
  });
});
