/**
 * C103 (bug): the expense-form date field rejected TODAY as "in the future" for users at a
 * positive UTC offset. `new Date('YYYY-MM-DD')` parses as UTC midnight, so the old
 * `selectedDate > new Date()` Date-INSTANT comparison landed today's date on tomorrow-morning-local
 * and tripped the future guard (the C6/C61 local-vs-UTC class). Fixed to compare CALENDAR-DAY
 * strings (the date-picker value is already local 'YYYY-MM-DD'; today's local day via the same
 * getFullYear/getMonth/getDate parts idiom this file uses elsewhere).
 *
 * These assertions are HOST-INDEPENDENT (not the vacuous local-vs-UTC value comparison the C77
 * lesson warns about): they derive "today" from local parts exactly as the function does, so they
 * hold whether the CI host is UTC or not. The bug was a TIME-OF-DAY mismatch within the compare,
 * which a pure date-string compare eliminates on every host.
 */

import { describe, expect, test } from 'vitest';
import type { Vehicle } from '$lib/types';
import { validateExpenseField } from '../expense-form-validation';

/** Today as a local 'YYYY-MM-DD' — the same derivation the validator now uses. */
function localToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** Shift a 'YYYY-MM-DD' by N calendar days (local), returning 'YYYY-MM-DD'. */
function shiftDays(ymd: string, days: number): string {
  const parts = ymd.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function ctxWithDate(date: string) {
  return {
    category: 'misc',
    vehicle: null as Vehicle | null,
    volumeUnit: 'liters' as const,
    chargeUnit: 'kwh' as const,
    allVehicleExpenses: [],
    formData: { date } as Record<string, string | string[]>,
  };
}

describe('validateExpenseField — date (C103 timezone-safe future check)', () => {
  test("today's local date is accepted (not rejected as future)", () => {
    // The regression: pre-fix, a positive-UTC-offset user saw this rejected.
    expect(validateExpenseField('date', ctxWithDate(localToday()))).toBeNull();
  });

  test('yesterday (a past date) is accepted', () => {
    expect(validateExpenseField('date', ctxWithDate(shiftDays(localToday(), -1)))).toBeNull();
  });

  test('a clearly past date is accepted', () => {
    expect(validateExpenseField('date', ctxWithDate('2020-01-15'))).toBeNull();
  });

  test('tomorrow (a future date) is rejected', () => {
    expect(validateExpenseField('date', ctxWithDate(shiftDays(localToday(), 1)))).toBe(
      'Date cannot be in the future'
    );
  });

  test('a far-future date is rejected', () => {
    expect(validateExpenseField('date', ctxWithDate('2999-12-31'))).toBe(
      'Date cannot be in the future'
    );
  });

  test('an empty date is required', () => {
    expect(validateExpenseField('date', ctxWithDate(''))).toBe('Date is required');
  });
});
