/**
 * Monthly run-rate normalizer. Pure functions over a Reminder row: the four frequencies share an
 * occurrences-per-year ÷ 12 basis, and only active positive-amount expense reminders contribute.
 */

import { describe, expect, test } from 'bun:test';
import type { Reminder } from '../../../db/schema';
import { monthlyRunRate, occurrencesPerYear, recurringCostSummary } from '../reminder-cost';

/** Minimal valid expense Reminder; override per case. */
function reminder(overrides: Partial<Reminder> = {}): Reminder {
  const base: Reminder = {
    id: 'rem-1',
    userId: 'user-1',
    name: 'Test',
    description: null,
    type: 'expense',
    actionMode: 'automatic',
    frequency: 'monthly',
    intervalValue: null,
    intervalUnit: null,
    triggerMode: 'time',
    intervalMileage: null,
    lastServiceOdometer: null,
    nextDueOdometer: null,
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: null,
    nextDueDate: new Date('2024-02-01T00:00:00Z'),
    expenseCategory: 'misc',
    expenseTags: null,
    expenseAmount: 100,
    expenseDescription: null,
    expenseSplitConfig: null,
    isActive: true,
    lastTriggeredAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };
  return { ...base, ...overrides };
}

describe('occurrencesPerYear — mirrors the engine frequency interpretation', () => {
  test('the named frequencies are mutually consistent', () => {
    expect(occurrencesPerYear('yearly')).toBeCloseTo(1, 6);
    expect(occurrencesPerYear('monthly')).toBeCloseTo(12, 6);
    expect(occurrencesPerYear('weekly')).toBeCloseTo(365.25 / 7, 6);
  });

  test('custom intervals convert per unit (and scale inversely with the interval)', () => {
    expect(occurrencesPerYear('custom', 1, 'month')).toBeCloseTo(12, 6);
    expect(occurrencesPerYear('custom', 3, 'month')).toBeCloseTo(4, 6);
    expect(occurrencesPerYear('custom', 2, 'week')).toBeCloseTo(365.25 / 7 / 2, 6);
    expect(occurrencesPerYear('custom', 1, 'year')).toBeCloseTo(1, 6);
    expect(occurrencesPerYear('custom', 90, 'day')).toBeCloseTo(365.25 / 90, 6);
  });

  test('un-fireable and unknown shapes contribute nothing', () => {
    expect(occurrencesPerYear('custom', 0, 'month')).toBe(0);
    expect(occurrencesPerYear('custom', -3, 'month')).toBe(0);
    expect(occurrencesPerYear('custom', 3, 'fortnight')).toBe(0);
    expect(occurrencesPerYear('whenever')).toBe(0);
  });
});

describe('monthlyRunRate — per-reminder normalized cost', () => {
  test('a $100 monthly expense reminder is $100/mo', () => {
    expect(monthlyRunRate(reminder({ frequency: 'monthly', expenseAmount: 100 }))).toBeCloseTo(
      100,
      6
    );
  });

  test('a $1200 yearly expense reminder is $100/mo', () => {
    expect(monthlyRunRate(reminder({ frequency: 'yearly', expenseAmount: 1200 }))).toBeCloseTo(
      100,
      6
    );
  });

  test('a $50 weekly expense reminder is ~$216.88/mo (52.18×50÷12)', () => {
    expect(monthlyRunRate(reminder({ frequency: 'weekly', expenseAmount: 50 }))).toBeCloseTo(
      (50 * (365.25 / 7)) / 12,
      6
    );
  });

  test('a custom every-3-months $300 expense reminder is $100/mo', () => {
    const r = reminder({
      frequency: 'custom',
      intervalValue: 3,
      intervalUnit: 'month',
      expenseAmount: 300,
    });
    expect(monthlyRunRate(r)).toBeCloseTo(100, 6);
  });

  test('notification, inactive, and zero or null amount reminders contribute nothing', () => {
    expect(monthlyRunRate(reminder({ type: 'notification', expenseAmount: null }))).toBe(0);
    expect(monthlyRunRate(reminder({ isActive: false, expenseAmount: 100 }))).toBe(0);
    expect(monthlyRunRate(reminder({ expenseAmount: null }))).toBe(0);
    expect(monthlyRunRate(reminder({ expenseAmount: 0 }))).toBe(0);
  });
});

describe('recurringCostSummary — aggregate over a user set', () => {
  test('sums only the contributing reminders and counts them', () => {
    const set = [
      reminder({ id: 'a', frequency: 'monthly', expenseAmount: 100 }),
      reminder({ id: 'b', frequency: 'yearly', expenseAmount: 1200 }),
      reminder({ id: 'c', type: 'notification', expenseAmount: null }),
      reminder({ id: 'd', isActive: false, expenseAmount: 999 }),
    ];
    const summary = recurringCostSummary(set);
    expect(summary.count).toBe(2);
    expect(summary.monthlyTotal).toBeCloseTo(200, 6);
  });

  test('an empty set is a clean zero', () => {
    expect(recurringCostSummary([])).toEqual({ count: 0, monthlyTotal: 0 });
  });
});
