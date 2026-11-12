import { describe, expect, test } from 'bun:test';
import { buildAmortizationSchedule } from '../analytics-charts';

const KEYS = (n: number) =>
  Array.from({ length: n }, (_, i) => `2024-${String(i + 1).padStart(2, '0')}`);

describe('buildAmortizationSchedule', () => {
  test('interest declines and principal rises month over month', () => {
    const sched = buildAmortizationSchedule(
      [{ balance: 20000, apr: 6, paymentAmount: 400 }],
      KEYS(3)
    );
    expect(sched).toHaveLength(3);

    expect(sched[0].interest).toBeCloseTo(100, 6);
    expect(sched[0].principal).toBeCloseTo(300, 6);

    expect(sched[1].interest).toBeLessThan(sched[0].interest);
    expect(sched[1].principal).toBeGreaterThan(sched[0].principal);
    expect(sched[2].interest).toBeLessThan(sched[1].interest);
    expect(sched[2].principal).toBeGreaterThan(sched[1].principal);

    for (const row of sched) {
      expect(row.interest + row.principal).toBeCloseTo(400, 6);
    }
  });

  test('a loan that pays off mid-window stops contributing (clamped, no negative/phantom)', () => {
    const sched = buildAmortizationSchedule(
      [{ balance: 500, apr: 12, paymentAmount: 400 }],
      KEYS(4)
    );
    expect(sched[0].interest).toBeCloseTo(5, 6);
    expect(sched[0].principal).toBeCloseTo(395, 6);
    expect(sched[1].principal).toBeCloseTo(105, 6);
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

  test('a payment below the monthly interest → principal 0, balance never moves (negative amortization)', () => {
    const sched = buildAmortizationSchedule(
      [{ balance: 10000, apr: 24, paymentAmount: 150 }],
      KEYS(3)
    );
    for (const row of sched) {
      expect(row.interest).toBeCloseTo(200, 6);
      expect(row.principal).toBe(0);
    }
    expect(sched[0].interest).toBeCloseTo(sched[2].interest, 6);
  });
});
