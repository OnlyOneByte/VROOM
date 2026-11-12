import { describe, expect, test } from 'bun:test';
import { getPeriodStartDate, type StatsPeriod } from '../calculations';

const NOW = new Date('2024-06-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('getPeriodStartDate', () => {
  test("'all' returns null (no lower bound)", () => {
    expect(getPeriodStartDate('all', NOW)).toBeNull();
  });

  test('each bounded period is now − N days', () => {
    const cases: Array<{ period: StatsPeriod; days: number }> = [
      { period: '7d', days: 7 },
      { period: '30d', days: 30 },
      { period: '90d', days: 90 },
      { period: '1y', days: 365 },
    ];
    for (const { period, days } of cases) {
      const start = getPeriodStartDate(period, NOW);
      expect(start, period).not.toBeNull();
      expect((start as Date).getTime()).toBe(NOW.getTime() - days * DAY_MS);
    }
  });

  test('the result is strictly before now for every bounded period', () => {
    for (const period of ['7d', '30d', '90d', '1y'] as const) {
      expect((getPeriodStartDate(period, NOW) as Date).getTime()).toBeLessThan(NOW.getTime());
    }
  });

  test('longer windows reach further back (monotonic)', () => {
    const d7 = (getPeriodStartDate('7d', NOW) as Date).getTime();
    const d30 = (getPeriodStartDate('30d', NOW) as Date).getTime();
    const d90 = (getPeriodStartDate('90d', NOW) as Date).getTime();
    const d365 = (getPeriodStartDate('1y', NOW) as Date).getTime();
    expect(d30).toBeLessThan(d7);
    expect(d90).toBeLessThan(d30);
    expect(d365).toBeLessThan(d90);
  });

  test('uses the current time when now is omitted', () => {
    const start = getPeriodStartDate('30d');
    expect(start).toBeInstanceOf(Date);
    expect(Number.isNaN((start as Date).getTime())).toBe(false);
  });
});
