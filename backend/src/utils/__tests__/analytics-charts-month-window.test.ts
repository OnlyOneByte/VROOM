// buildMonthlyConsumption keeps the most recent 12 months. slice(0, 12) would keep the oldest and
// hide the current period.

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

// Efficiency only augments months that volume already created. A degenerate efficiency point has
// date '', which would otherwise produce a phantom 'NaN-NaN' month, so the if (entry) guard must
// stay. Efficiency lands on the later fill-up's month.
describe('buildMonthlyConsumption — efficiency only augments volume-created months', () => {
  test('a 2-fillup pair across months: both months exist (volume), efficiency lands on the LATER one', () => {
    // Jan 1 @ 10000mi, Feb 1 @ 10300mi (300 mi / 10 vol = 30 mpg).
    const rows: FuelExpenseRow[] = [
      fuelExp({ date: new Date(2024, 0, 1), mileage: 10000, volume: 10 }),
      fuelExp({ date: new Date(2024, 1, 1), mileage: 10300, volume: 10 }),
    ];
    const out = buildMonthlyConsumption(rows);
    expect(out.map((m) => m.month)).toEqual(['2024-01', '2024-02']);
    const jan = out.find((m) => m.month === '2024-01');
    const feb = out.find((m) => m.month === '2024-02');
    expect(jan?.efficiency).toBe(0);
    expect(feb?.efficiency).toBeCloseTo(30, 5);
    // Both months still report their own volume regardless of efficiency.
    expect(jan?.volume).toBe(10);
    expect(feb?.volume).toBe(10);
  });

  test('emitted months are the distinct volume-row months', () => {
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
