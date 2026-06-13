/**
 * Regression test (cycle 11) for the monthly-consumption window.
 *
 * buildMonthlyConsumption sorts months ascending then takes 12. It used slice(0, 12),
 * which keeps the OLDEST 12 months — so once a user has >12 months of fill-ups the chart
 * showed stale history and HID the current period. The fix is slice(-12) (most recent 12).
 * Every sibling monthly builder already uses slice(-N); this pins the convention.
 */

import { describe, expect, test } from 'bun:test';
import { buildMonthlyConsumption, type FuelExpenseRow } from '../analytics-charts';

function fuelExp(over: Partial<FuelExpenseRow>): FuelExpenseRow {
  return {
    vehicleId: 'veh-1',
    date: new Date(2024, 0, 1),
    mileage: null,
    volume: 10,
    fuelType: 'regular',
    missedFillup: false,
    expenseAmount: 40,
    ...over,
  };
}

describe('buildMonthlyConsumption — keeps the most recent 12 months', () => {
  test('with 14 months of data, returns the latest 12 (not the oldest)', () => {
    // One fill-up per month across 14 consecutive months: 2023-01 .. 2024-02.
    const rows: FuelExpenseRow[] = [];
    for (let i = 0; i < 14; i++) {
      const year = 2023 + Math.floor(i / 12);
      const month = i % 12;
      rows.push(fuelExp({ date: new Date(year, month, 10), volume: 10 + i }));
    }

    const out = buildMonthlyConsumption(rows);
    expect(out.length).toBe(12);

    const months = out.map((m) => m.month);
    // Most-recent window: the two OLDEST months are dropped, the latest is kept.
    expect(months).not.toContain('2023-01');
    expect(months).not.toContain('2023-02');
    expect(months[0]).toBe('2023-03');
    expect(months[months.length - 1]).toBe('2024-02');
  });

  test('with ≤12 months, returns them all in ascending order', () => {
    const rows: FuelExpenseRow[] = [
      fuelExp({ date: new Date(2024, 0, 10) }),
      fuelExp({ date: new Date(2024, 1, 10) }),
      fuelExp({ date: new Date(2024, 2, 10) }),
    ];
    const out = buildMonthlyConsumption(rows);
    expect(out.map((m) => m.month)).toEqual(['2024-01', '2024-02', '2024-03']);
  });
});

// C341 (deep-review→guard): the efficiency loop attaches MPG to months the VOLUME loop already
// created — `map.get(key)` then `if (entry)` (analytics-charts.ts:333-334). That guard is load-bearing:
// the volume loop skips a null/invalid date (`if (!d) continue`), but a degenerate efficiency point
// returns date='' → toMonthKey(new Date('')) = 'NaN-NaN', and `if (entry)` is what stops that phantom
// key from becoming an emitted month with efficiency-but-no-volume. (expenses.date is .notNull() so a
// real row can't trigger it, but a refactor swapping `if (entry)` for an upsert/`?? default` would
// silently start emitting phantom months — this pins the invariant so that change turns RED.) Also pins
// that efficiency lands on the LATER fill-up's month (computeEfficiencyPoint uses current.date).
describe('buildMonthlyConsumption — efficiency only augments volume-created months (the if(entry) invariant)', () => {
  test('a 2-fillup pair across months: both months exist (volume), efficiency lands on the LATER one', () => {
    // Jan 1 @ 10000mi, Feb 1 @ 10300mi (300 mi / 10 vol = 30 mpg). Same vehicle, sorted.
    const rows: FuelExpenseRow[] = [
      fuelExp({ date: new Date(2024, 0, 1), mileage: 10000, volume: 10 }),
      fuelExp({ date: new Date(2024, 1, 1), mileage: 10300, volume: 10 }),
    ];
    const out = buildMonthlyConsumption(rows);
    // Exactly the two volume-row months — efficiency never CREATED a third.
    expect(out.map((m) => m.month)).toEqual(['2024-01', '2024-02']);
    const jan = out.find((m) => m.month === '2024-01');
    const feb = out.find((m) => m.month === '2024-02');
    // The pair's efficiency attaches to Feb (the later fill-up); Jan has volume but no completed pair.
    expect(jan?.efficiency).toBe(0);
    expect(feb?.efficiency).toBeCloseTo(30, 5);
    // Both months still report their own volume regardless of efficiency.
    expect(jan?.volume).toBe(10);
    expect(feb?.volume).toBe(10);
  });

  test('the emitted month set equals the DISTINCT volume-row months (efficiency adds none)', () => {
    // Two same-month fill-ups (one completed pair) → ONE month, not two; efficiency on that month.
    const rows: FuelExpenseRow[] = [
      fuelExp({ date: new Date(2024, 4, 2), mileage: 20000, volume: 8 }),
      fuelExp({ date: new Date(2024, 4, 20), mileage: 20240, volume: 8 }), // 240/8 = 30 mpg
    ];
    const out = buildMonthlyConsumption(rows);
    expect(out.map((m) => m.month)).toEqual(['2024-05']);
    expect(out[0]?.volume).toBe(16); // both fill-ups' volume pooled into the one month
    expect(out[0]?.efficiency).toBeCloseTo(30, 5);
  });
});
