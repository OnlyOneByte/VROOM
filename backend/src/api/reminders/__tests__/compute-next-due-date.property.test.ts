/**
 * Property-Based Tests for computeNextDueDate
 *
 * Property 1: Date advancement is strictly monotonic
 * Property 2: Monthly advancement clamps to last day of target month
 * Property 3: Weekly advancement adds exactly 7 days
 * Property 20: Anchor day prevents month-end drift
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { computeNextDueDate } from '../trigger-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the last day of a given month (1-indexed month in a given year). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Constrain dates to a reasonable range to avoid JS Date edge cases at extremes
const reasonableDate = fc.date({
  min: new Date('2000-01-01'),
  max: new Date('2099-12-31'),
  noInvalidDate: true,
});

// ---------------------------------------------------------------------------
// Property 1: Date advancement is strictly monotonic
// ---------------------------------------------------------------------------
describe('Property 1: Date advancement is strictly monotonic', () => {
  test('weekly advancement returns a date strictly after the input', () => {
    fc.assert(
      fc.property(reasonableDate, (date) => {
        const result = computeNextDueDate(date, 'weekly');
        expect(result.getTime()).toBeGreaterThan(date.getTime());
      }),
      { numRuns: 200 }
    );
  });

  test('monthly advancement returns a date strictly after the input', () => {
    fc.assert(
      fc.property(reasonableDate, fc.integer({ min: 1, max: 31 }), (date, anchorDay) => {
        const result = computeNextDueDate(date, 'monthly', null, null, anchorDay);
        expect(result.getTime()).toBeGreaterThan(date.getTime());
      }),
      { numRuns: 200 }
    );
  });

  test('yearly advancement returns a date strictly after the input', () => {
    fc.assert(
      fc.property(reasonableDate, fc.integer({ min: 1, max: 31 }), (date, anchorDay) => {
        const result = computeNextDueDate(date, 'yearly', null, null, anchorDay);
        expect(result.getTime()).toBeGreaterThan(date.getTime());
      }),
      { numRuns: 200 }
    );
  });

  test('custom day advancement returns a date strictly after the input', () => {
    fc.assert(
      fc.property(reasonableDate, fc.integer({ min: 1, max: 12 }), (date, intervalValue) => {
        const result = computeNextDueDate(date, 'custom', intervalValue, 'day');
        expect(result.getTime()).toBeGreaterThan(date.getTime());
      }),
      { numRuns: 200 }
    );
  });

  test('custom week advancement returns a date strictly after the input', () => {
    fc.assert(
      fc.property(reasonableDate, fc.integer({ min: 1, max: 12 }), (date, intervalValue) => {
        const result = computeNextDueDate(date, 'custom', intervalValue, 'week');
        expect(result.getTime()).toBeGreaterThan(date.getTime());
      }),
      { numRuns: 200 }
    );
  });

  test('custom month advancement returns a date strictly after the input', () => {
    fc.assert(
      fc.property(
        reasonableDate,
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (date, intervalValue, anchorDay) => {
          const result = computeNextDueDate(date, 'custom', intervalValue, 'month', anchorDay);
          expect(result.getTime()).toBeGreaterThan(date.getTime());
        }
      ),
      { numRuns: 200 }
    );
  });

  test('custom year advancement returns a date strictly after the input', () => {
    fc.assert(
      fc.property(
        reasonableDate,
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (date, intervalValue, anchorDay) => {
          const result = computeNextDueDate(date, 'custom', intervalValue, 'year', anchorDay);
          expect(result.getTime()).toBeGreaterThan(date.getTime());
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Monthly advancement clamps to last day of target month
// ---------------------------------------------------------------------------
describe('Property 2: Monthly advancement clamps to last day of target month', () => {
  test('advancing by one month produces a date in the next calendar month with clamped day', () => {
    fc.assert(
      fc.property(reasonableDate, fc.constantFrom(28, 29, 30, 31), (date, anchorDay) => {
        const result = computeNextDueDate(date, 'monthly', null, null, anchorDay);

        // Result should be in the next calendar month
        const expectedMonth = (date.getMonth() + 1) % 12;
        const expectedYear = date.getMonth() === 11 ? date.getFullYear() + 1 : date.getFullYear();
        expect(result.getMonth()).toBe(expectedMonth);
        expect(result.getFullYear()).toBe(expectedYear);

        // Day should be min(anchorDay, lastDayOfTargetMonth)
        const lastDay = lastDayOfMonth(result.getFullYear(), result.getMonth());
        expect(result.getDate()).toBe(Math.min(anchorDay, lastDay));
      }),
      { numRuns: 200 }
    );
  });

  test('Jan 31 → Feb 28 in non-leap year', () => {
    // 2025 is not a leap year
    const jan31 = new Date(2025, 0, 31);
    const result = computeNextDueDate(jan31, 'monthly', null, null, 31);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28);
  });

  test('Jan 31 → Feb 29 in leap year', () => {
    // 2024 is a leap year
    const jan31 = new Date(2024, 0, 31);
    const result = computeNextDueDate(jan31, 'monthly', null, null, 31);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(29);
  });

  test('Mar 31 → Apr 30', () => {
    const mar31 = new Date(2025, 2, 31);
    const result = computeNextDueDate(mar31, 'monthly', null, null, 31);
    expect(result.getMonth()).toBe(3); // April
    expect(result.getDate()).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Property 3: Weekly advancement adds exactly 7 days
// ---------------------------------------------------------------------------
describe('Property 3: Weekly advancement adds exactly 7 days', () => {
  test('the difference in milliseconds equals exactly 7 * 24 * 60 * 60 * 1000', () => {
    fc.assert(
      fc.property(reasonableDate, (date) => {
        const result = computeNextDueDate(date, 'weekly');
        const diffMs = result.getTime() - date.getTime();
        expect(diffMs).toBe(SEVEN_DAYS_MS);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 20: Anchor day prevents month-end drift
// ---------------------------------------------------------------------------
describe('Property 20: Anchor day prevents month-end drift', () => {
  test('starting from Jan 31, advancing monthly 12 times always clamps correctly', () => {
    const start = new Date(2025, 0, 31); // Jan 31, 2025
    let current = start;

    for (let i = 0; i < 12; i++) {
      const next = computeNextDueDate(current, 'monthly', null, null, 31);
      const last = lastDayOfMonth(next.getFullYear(), next.getMonth());
      expect(next.getDate()).toBe(Math.min(31, last));
      // Ensure we always move forward
      expect(next.getTime()).toBeGreaterThan(current.getTime());
      current = next;
    }
  });

  test('advancing monthly N times from various anchor days never drifts permanently', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(28, 29, 30, 31),
        fc.integer({ min: 2, max: 12 }),
        (anchorDay, steps) => {
          // Start from January with the given anchor day
          const startDay = Math.min(anchorDay, 31);
          let current = new Date(2025, 0, startDay);

          for (let i = 0; i < steps; i++) {
            const next = computeNextDueDate(current, 'monthly', null, null, anchorDay);
            const last = lastDayOfMonth(next.getFullYear(), next.getMonth());

            // The day should always be min(anchorDay, lastDayOfTargetMonth)
            expect(next.getDate()).toBe(Math.min(anchorDay, last));
            // Must always advance
            expect(next.getTime()).toBeGreaterThan(current.getTime());
            current = next;
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  test('custom monthly interval also preserves anchor day across advances', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(28, 29, 30, 31),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 2, max: 6 }),
        (anchorDay, intervalValue, steps) => {
          const startDay = Math.min(anchorDay, 31);
          let current = new Date(2025, 0, startDay);

          for (let i = 0; i < steps; i++) {
            const next = computeNextDueDate(current, 'custom', intervalValue, 'month', anchorDay);
            const last = lastDayOfMonth(next.getFullYear(), next.getMonth());

            expect(next.getDate()).toBe(Math.min(anchorDay, last));
            expect(next.getTime()).toBeGreaterThan(current.getTime());
            current = next;
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
