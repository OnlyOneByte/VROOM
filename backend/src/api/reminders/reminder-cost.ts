/**
 * Recurring-cost normalization (recurring-expenses T7, R5/D4 — the non-eyes-on backend core).
 *
 * A `type:'expense'` reminder materializes a real expense on its frequency cadence (see
 * trigger-service.ts). To show a "monthly recurring run-rate" we normalize each active expense
 * reminder's `expenseAmount` to a per-month figure using the SAME frequency interpretation the engine
 * uses in `computeNextDueDate` (weekly = every 7 days, monthly = +1 month, yearly = +1 year, custom =
 * intervalValue × intervalUnit). This is a pure derivation over existing rows — NO new table/scheduler
 * (NORTH_STAR #4: extend the engine, don't reinvent it). The dashboard widget (T7 eyes-on) renders the
 * number; this module is the testable core that lands while Playwright is blocked.
 *
 * Basis: occurrences-PER-YEAR ÷ 12, so the four frequencies stay mutually consistent
 * (weekly 52/yr, monthly 12/yr, yearly 1/yr). A year is taken as 365.25 days for day-interval customs.
 */

import type { Reminder } from '../../db/schema';

const DAYS_PER_YEAR = 365.25;
const WEEKS_PER_YEAR = DAYS_PER_YEAR / 7; // ~52.18
const MONTHS_PER_YEAR = 12;

/**
 * How many times this reminder fires per year. Mirrors computeNextDueDate's frequency handling.
 * Returns 0 for a shape that can't fire on a time cadence (so it contributes nothing to a run-rate):
 * a non-positive custom interval, or an unknown frequency string.
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
      if (iv <= 0) return 0; // a 0/negative interval never fires — contribute nothing, don't divide by it
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
          return 0; // unknown unit → not a valid cadence
      }
    }
    default:
      return 0; // unknown frequency → contributes nothing
  }
}

/**
 * The monthly run-rate (currency/month) this reminder contributes. Only active `type:'expense'`
 * reminders with a positive amount count; everything else is 0 (notification reminders carry no cost,
 * inactive ones aren't materializing, a null/zero amount contributes nothing).
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
  /** Count of active expense reminders contributing a positive run-rate. */
  count: number;
  /** Total normalized monthly run-rate across those reminders (currency/month). */
  monthlyTotal: number;
}

/**
 * Aggregate the monthly recurring run-rate across a set of reminders. Pure over whatever rows are
 * passed (the caller scopes to a user); a reminder contributing 0 (notification / inactive / no
 * amount / un-fireable interval) is excluded from both the total and the count.
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
