/**
 * buildAmortizationSchedule (bug #10, cycle 38).
 *
 * The old buildLoanBreakdown read each loan's balance into a Map then NEVER decremented it across
 * the 12-month loop — so every month reported identical interest/principal (interest never declined,
 * principal never rose), and a loan that pays off mid-window was over-projected. These tests pin the
 * corrected amortization: balance walks down by principal each month, interest declines, principal
 * rises, and a paid-off loan stops contributing (clamped at 0, no negative interest / phantom
 * principal).
 */

import { describe, expect, test } from 'bun:test';
import { buildAmortizationSchedule } from '../analytics-charts';

const KEYS = (n: number) =>
  Array.from({ length: n }, (_, i) => `2024-${String(i + 1).padStart(2, '0')}`);

describe('buildAmortizationSchedule', () => {
  test('interest DECLINES and principal RISES month over month (the bug #10 fix)', () => {
    // $20,000 @ 6% APR, $400/mo. Month 1 interest = 20000 * 0.005 = 100; principal = 300.
    const sched = buildAmortizationSchedule(
      [{ balance: 20000, apr: 6, paymentAmount: 400 }],
      KEYS(3)
    );
    expect(sched).toHaveLength(3);

    // Month 1 baseline.
    expect(sched[0].interest).toBeCloseTo(100, 6);
    expect(sched[0].principal).toBeCloseTo(300, 6);

    // The defining assertion: each subsequent month's interest is strictly LESS and principal
    // strictly MORE than the prior month (the old code made these all equal).
    expect(sched[1].interest).toBeLessThan(sched[0].interest);
    expect(sched[1].principal).toBeGreaterThan(sched[0].principal);
    expect(sched[2].interest).toBeLessThan(sched[1].interest);
    expect(sched[2].principal).toBeGreaterThan(sched[1].principal);

    // Each month's interest + principal still equals the fixed payment (until payoff).
    for (const row of sched) {
      expect(row.interest + row.principal).toBeCloseTo(400, 6);
    }
  });

  test('a loan that pays off mid-window stops contributing (clamped, no negative/phantom)', () => {
    // Small balance relative to payment → pays off within a couple months.
    const sched = buildAmortizationSchedule(
      [{ balance: 500, apr: 12, paymentAmount: 400 }],
      KEYS(4)
    );
    // Month 1: interest = 500 * 0.01 = 5; principal = min(395, 500) = 395 → balance 105.
    expect(sched[0].interest).toBeCloseTo(5, 6);
    expect(sched[0].principal).toBeCloseTo(395, 6);
    // Month 2: interest = 105 * 0.01 = 1.05; principal = min(398.95, 105) = 105 → balance 0.
    expect(sched[1].principal).toBeCloseTo(105, 6);
    // Months 3-4: balance is 0 → no contribution at all (not a phantom full payment).
    expect(sched[2].interest).toBe(0);
    expect(sched[2].principal).toBe(0);
    expect(sched[3].interest).toBe(0);
    expect(sched[3].principal).toBe(0);
  });

  test('sums interest + principal across multiple loans per month', () => {
    const sched = buildAmortizationSchedule(
      [
        { balance: 20000, apr: 6, paymentAmount: 400 },
        { balance: 10000, apr: 12, paymentAmount: 300 },
      ],
      KEYS(1)
    );
    // Loan A: interest 100, principal 300. Loan B: interest 100, principal 200.
    expect(sched[0].interest).toBeCloseTo(200, 6);
    expect(sched[0].principal).toBeCloseTo(500, 6);
  });

  test('does not mutate the caller’s loan inputs', () => {
    const loans = [{ balance: 20000, apr: 6, paymentAmount: 400 }];
    buildAmortizationSchedule(loans, KEYS(3));
    expect(loans[0].balance, 'caller balance untouched').toBe(20000);
  });

  test('empty loans → a zero row per month (no crash)', () => {
    const sched = buildAmortizationSchedule([], KEYS(2));
    expect(sched).toEqual([
      { month: '2024-01', interest: 0, principal: 0 },
      { month: '2024-02', interest: 0, principal: 0 },
    ]);
  });
});
