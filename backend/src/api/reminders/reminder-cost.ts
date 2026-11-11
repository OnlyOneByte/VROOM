/**
 * Normalizes expense reminders to a monthly run-rate. Frequencies follow the same rules as
 * computeNextDueDate in trigger-service.ts, so the two must change together. Basis: occurrences per year ÷ 12,
 * with a year taken as 365.25 days.
 */

import type { Reminder } from '../../db/schema';

const DAYS_PER_YEAR = 365.25;
const WEEKS_PER_YEAR = DAYS_PER_YEAR / 7;
const MONTHS_PER_YEAR = 12;

/**
 * Returns 0 for a shape that cannot fire on a time cadence, so it contributes nothing.
 */
export function occurrencesPerYear(
  frequency: string,
  intervalValue?: number | null,
  intervalUnit?: string | null
): number {
  switch (frequency) {
    case 'weekly':
      return WEEKS_PER_YEAR;
    case 'monthly':
      return MONTHS_PER_YEAR;
    case 'yearly':
      return 1;
    case 'custom': {
      const iv = intervalValue ?? 0;
      if (iv <= 0) return 0;
      switch (intervalUnit) {
        case 'day':
          return DAYS_PER_YEAR / iv;
        case 'week':
          return WEEKS_PER_YEAR / iv;
        case 'month':
          return MONTHS_PER_YEAR / iv;
        case 'year':
          return 1 / iv;
        default:
          return 0;
      }
    }
    default:
      return 0;
  }
}

/**
 * Zero unless the reminder is an active expense with a positive amount.
 */
export function monthlyRunRate(reminder: Reminder): number {
  if (reminder.type !== 'expense' || !reminder.isActive) return 0;
  const amount = reminder.expenseAmount ?? 0;
  if (amount <= 0) return 0;
  const perYear = occurrencesPerYear(
    reminder.frequency,
    reminder.intervalValue,
    reminder.intervalUnit
  );
  return (amount * perYear) / MONTHS_PER_YEAR;
}

export interface RecurringCostSummary {
  count: number;
  /** Currency per month. */
  monthlyTotal: number;
}

/**
 * Reminders contributing zero are excluded from both the count and the total.
 */
export function recurringCostSummary(reminders: Reminder[]): RecurringCostSummary {
  let count = 0;
  let monthlyTotal = 0;
  for (const reminder of reminders) {
    const rate = monthlyRunRate(reminder);
    if (rate > 0) {
      count += 1;
      monthlyTotal += rate;
    }
  }
  return { count, monthlyTotal };
}
