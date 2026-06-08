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
