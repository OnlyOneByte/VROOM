/**
 * Unit tests for the createReminderSchema cross-field REFINEMENTS (C87 deep-review, steered by
 * the C81 coverage baseline — reminders/validation.ts was at 64% func, the gaps being the
 * refinement FAILURE branches: the correctness guards that reject a malformed reminder). The
 * existing update-validation test covers only the isActive toggle; this pins the six refinements
 * (custom-frequency, expense-type, mileage-trigger D4, date-range, split-config sums/match).
 * Pure Zod schemas via safeParse — no DB, no server.
 */

import { describe, expect, test } from 'bun:test';
import { createReminderSchema } from '../validation';

/** A minimal valid NOTIFICATION reminder (no expense/ mileage requirements). */
function validNotification(over: Record<string, unknown> = {}) {
  return {
    name: 'Oil change',
    type: 'notification',
    frequency: 'monthly',
    startDate: '2024-01-01T00:00:00.000Z',
    vehicleIds: ['v1'],
    ...over,
  };
}

const ok = (input: Record<string, unknown>) => createReminderSchema.safeParse(input).success;
function failsWith(input: Record<string, unknown>, message: string): boolean {
  const r = createReminderSchema.safeParse(input);
  return !r.success && r.error.issues.some((i) => i.message === message);
}

describe('refineCustomFrequency', () => {
  test('a custom frequency requires intervalValue + intervalUnit', () => {
    expect(
      ok(validNotification({ frequency: 'custom', intervalValue: 2, intervalUnit: 'week' }))
    ).toBe(true);
    expect(
      failsWith(
        validNotification({ frequency: 'custom' }),
        'intervalValue required for custom frequency'
      )
    ).toBe(true);
    expect(
      failsWith(
        validNotification({ frequency: 'custom', intervalValue: 2 }),
        'intervalUnit required for custom frequency'
      )
    ).toBe(true);
  });

  test('a non-custom frequency does not require the interval fields', () => {
    expect(ok(validNotification({ frequency: 'weekly' }))).toBe(true);
  });
});

describe('refineExpenseType', () => {
  test('an expense reminder requires expenseCategory + expenseAmount', () => {
    expect(
      ok(validNotification({ type: 'expense', expenseCategory: 'maintenance', expenseAmount: 50 }))
    ).toBe(true);
    expect(
      failsWith(
        validNotification({ type: 'expense', expenseAmount: 50 }),
        'expenseCategory required for expense reminders'
      )
    ).toBe(true);
    expect(
      failsWith(
        validNotification({ type: 'expense', expenseCategory: 'maintenance' }),
        'expenseAmount required for automatic expense reminders'
      )
    ).toBe(true);
  });
});

describe('refineMileageTrigger (D4)', () => {
  test("a 'mileage' reminder requires intervalMileage", () => {
    expect(ok(validNotification({ triggerMode: 'mileage', intervalMileage: 5000 }))).toBe(true);
    expect(
      failsWith(
        validNotification({ triggerMode: 'mileage' }),
        'intervalMileage is required (positive) for a mileage reminder'
      )
    ).toBe(true);
  });

  test('a mileage reminder must track EXACTLY one vehicle', () => {
    expect(
      failsWith(
        validNotification({ triggerMode: 'both', intervalMileage: 5000, vehicleIds: ['v1', 'v2'] }),
        'A mileage reminder must be linked to exactly one vehicle'
      )
    ).toBe(true);
  });

  test("a 'time' reminder is unconstrained by the mileage refinement (multi-vehicle ok)", () => {
    expect(ok(validNotification({ triggerMode: 'time', vehicleIds: ['v1', 'v2'] }))).toBe(true);
  });
});

describe('refineDateRange', () => {
  test('endDate must be after startDate', () => {
    expect(ok(validNotification({ endDate: '2024-12-31T00:00:00.000Z' }))).toBe(true);
    expect(
      failsWith(
        validNotification({
          startDate: '2024-06-01T00:00:00.000Z',
          endDate: '2024-05-01T00:00:00.000Z',
        }),
        'endDate must be after startDate'
      )
    ).toBe(true);
  });

  // C375: the refinement uses `endDate <= startDate` (not `<`), so endDate EQUAL to startDate — a
  // zero-duration reminder that would fire its start period then immediately deactivate — is rejected
  // too. Tests above pin strictly-after (ok) + strictly-before (fail) but NOT the equality boundary,
  // which is exactly what the `<=` (vs `<`) is load-bearing for: a regression to `<` would silently
  // ACCEPT a same-instant start==end reminder. Pin the boundary closed.
  test('endDate EQUAL to startDate is rejected (the <= boundary, not just <)', () => {
    expect(
      failsWith(
        validNotification({
          startDate: '2024-06-01T00:00:00.000Z',
          endDate: '2024-06-01T00:00:00.000Z',
        }),
        'endDate must be after startDate'
      )
    ).toBe(true);
  });
});

describe('refineSplitConfig', () => {
  const expenseBase = (over: Record<string, unknown> = {}) =>
    validNotification({
      type: 'expense',
      expenseCategory: 'maintenance',
      expenseAmount: 100,
      ...over,
    });

  test('split vehicle IDs must match the reminder vehicleIds', () => {
    const mismatch = expenseBase({
      vehicleIds: ['v1'],
      expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
    });
    expect(failsWith(mismatch, 'Split config vehicle IDs must match vehicleIds')).toBe(true);
  });

  test('percentage allocations must sum to 100', () => {
    const bad = expenseBase({
      vehicleIds: ['v1', 'v2'],
      expenseSplitConfig: {
        method: 'percentage',
        allocations: [
          { vehicleId: 'v1', percentage: 70 },
          { vehicleId: 'v2', percentage: 20 },
        ],
      },
    });
    expect(failsWith(bad, 'Percentage allocations must sum to 100')).toBe(true);
  });

  test('absolute allocations must sum to expenseAmount', () => {
    const bad = expenseBase({
      expenseAmount: 100,
      vehicleIds: ['v1', 'v2'],
      expenseSplitConfig: {
        method: 'absolute',
        allocations: [
          { vehicleId: 'v1', amount: 70 },
          { vehicleId: 'v2', amount: 20 }, // sums to 90, not 100
        ],
      },
    });
    expect(failsWith(bad, 'Absolute allocations must sum to expenseAmount')).toBe(true);
  });

  test('a matching even split across the same vehicles is accepted', () => {
    const good = expenseBase({
      vehicleIds: ['v1', 'v2'],
      expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
    });
    expect(ok(good)).toBe(true);
  });
});
