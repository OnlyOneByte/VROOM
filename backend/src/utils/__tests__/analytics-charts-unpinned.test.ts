// Tests for analytics-charts builders that lacked direct coverage. Empty and single-element inputs
// must not produce NaN or throw, divide-by-zero guards hold, monthly windows keep the newest
// months, and buildFillupIntervals does not mutate its input.

import { describe, expect, test } from 'bun:test';
import {
  buildFillupCostByVehicle,
  buildFillupIntervals,
  buildMonthlyCostHeatmap,
  computeAverageCosts,
  computeEfficiencyPoint,
  computeFuelConsumptionMetrics,
  computeMileageScore,
  computeMpgAndCostPerMile,
  computePreviousYearComparison,
  computeRegularityScore,
  type FuelExpenseRow,
  type GeneralExpenseRow,
  gasEfficiencyPoint,
  sortByVehicleThenDate,
} from '../analytics-charts';

// Local time, so bucketing by local weekday and month does not depend on the timezone.
function d(year: number, month1to12: number, day: number): Date {
  return new Date(year, month1to12 - 1, day);
}

function fuelRow(over: Partial<FuelExpenseRow> = {}): FuelExpenseRow {
  return {
    date: d(2024, 1, 15),
    mileage: 1000,
    volume: 10,
    fuelType: 'regular',
    missedFillup: false,
    expenseAmount: 40,
    vehicleId: 'v1',
    ...over,
  };
}

function genRow(over: Partial<GeneralExpenseRow> = {}): GeneralExpenseRow {
  return {
    id: 'e1',
    vehicleId: 'v1',
    category: 'fuel',
    description: null,
    expenseAmount: 40,
    date: d(2024, 1, 15),
    mileage: null,
    volume: null,
    missedFillup: false,
    ...over,
  };
}

describe('buildMonthlyCostHeatmap', () => {
  test('empty input returns an empty array', () => {
    expect(buildMonthlyCostHeatmap([])).toEqual([]);
  });

  test('an unknown category falls back to misc (never throws / drops the amount)', () => {
    const [row] = buildMonthlyCostHeatmap([
      genRow({ category: 'not-a-category', expenseAmount: 12 }),
    ]);
    expect(row.misc).toBe(12);
  });

  test('keeps the newest 24 months', () => {
    // 30 distinct months, Jan 2022 .. Jun 2024. The newest 24 run Jul 2022 .. Jun 2024.
    const rows: GeneralExpenseRow[] = [];
    for (let i = 0; i < 30; i++) {
      const year = 2022 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      rows.push(genRow({ date: d(year, month, 5), expenseAmount: 10 }));
    }
    const out = buildMonthlyCostHeatmap(rows);
    expect(out).toHaveLength(24);
    expect(out[0].month).toBe('2022-07');
    expect(out[out.length - 1].month).toBe('2024-06');
  });
});

describe('computeRegularityScore', () => {
  test('empty gives 50 and a single entry gives 75 (neutral defaults, no NaN)', () => {
    expect(computeRegularityScore([])).toBe(50);
    expect(computeRegularityScore([{ date: d(2024, 1, 1) }])).toBe(75);
  });

  test('all gaps within 90 days score 100, and an overdue gap lowers the score', () => {
    const onTime = computeRegularityScore([
      { date: d(2024, 1, 1) },
      { date: d(2024, 2, 1) },
      { date: d(2024, 3, 1) },
    ]);
    expect(onTime).toBe(100);
    const overdue = computeRegularityScore([{ date: d(2024, 1, 1) }, { date: d(2024, 9, 1) }]);
    expect(overdue).toBeLessThan(100);
    expect(Number.isFinite(overdue)).toBe(true);
  });
});

describe('computeMileageScore', () => {
  test('fewer than 2 readings gives 50 (no divide-by-zero)', () => {
    expect(computeMileageScore([])).toBe(50);
    expect(computeMileageScore([{ mileage: 1000 }])).toBe(50);
  });

  test('a healthy 3000–7000 mi interval scores 100; a tiny interval scores 0', () => {
    expect(computeMileageScore([{ mileage: 1000 }, { mileage: 6000 }])).toBe(100);
    expect(computeMileageScore([{ mileage: 1000 }, { mileage: 1100 }])).toBe(0);
  });
});

describe('computePreviousYearComparison', () => {
  test('a zero or negative prior-year total returns null (no divide-by-zero)', () => {
    expect(computePreviousYearComparison(500, 0)).toBeNull();
    expect(computePreviousYearComparison(500, -1)).toBeNull();
  });

  test('computes the year-over-year percentage change', () => {
    expect(computePreviousYearComparison(1500, 1000)).toEqual({
      totalSpent: 1000,
      percentageChange: 50,
    });
  });
});

describe('buildFillupIntervals does not mutate its input', () => {
  test('the caller-visible row order is preserved after building intervals', () => {
    // Deliberately out of date order, so an in-place sort would reorder them.
    const rows: FuelExpenseRow[] = [
      fuelRow({ vehicleId: 'v1', date: d(2024, 3, 1) }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1) }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 2, 1) }),
    ];
    const before = rows.map((r) => (r.date as Date).getTime());
    buildFillupIntervals(rows);
    const after = rows.map((r) => (r.date as Date).getTime());
    expect(after).toEqual(before);
  });

  test('buckets consecutive-fillup day gaps (28 days → the 22+ bucket)', () => {
    const out = buildFillupIntervals([
      fuelRow({ date: d(2024, 1, 1) }),
      fuelRow({ date: d(2024, 1, 29) }),
    ]);
    const bucket = out.find((b) => b.intervalLabel === '22+ days');
    expect(bucket?.count).toBe(1);
  });

  // Same-date rows form 0-day pairs, which accumulateIntervalBuckets drops. Without that guard, the
  // null-volume siblings of a split fillup would show up as phantom intervals.
  test('a same-date split fillup creates no phantom 0-day intervals', () => {
    const out = buildFillupIntervals([
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1), volume: 12 }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1), volume: null }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1), volume: null }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 6), volume: 10 }),
    ]);
    const totalCount = out.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(1);
    expect(out.find((b) => b.intervalLabel === '4-7 days')?.count).toBe(1);
    expect(out.find((b) => b.intervalLabel === '1-3 days')).toBeUndefined();
  });
});

// Split siblings have no volume and must not enlarge the per-fillup denominator.
describe('computeAverageCosts.perFillup — split fuel siblings do not inflate the denominator', () => {
  const YEAR_START = d(2024, 1, 1);
  const YEAR_END = d(2025, 1, 1);
  const NOW = d(2024, 6, 1);

  test('a split fillup (N null-volume siblings) counts as the volume-bearing fillups only', () => {
    // Two real fillups ($50, $60) plus a split fillup stored as two null-volume siblings. Only the
    // two real rows count.
    const rows: FuelExpenseRow[] = [
      fuelRow({ expenseAmount: 50, volume: 10 }),
      fuelRow({ expenseAmount: 60, volume: 12 }),
      fuelRow({ expenseAmount: 40, volume: null }),
      fuelRow({ expenseAmount: 40, volume: null }),
    ];
    const { perFillup } = computeAverageCosts(rows, [], YEAR_START, YEAR_END, NOW);
    expect(perFillup).toBeCloseTo(55, 5);
  });

  test('unsplit fillups are unchanged', () => {
    const rows: FuelExpenseRow[] = [
      fuelRow({ expenseAmount: 40, volume: 10 }),
      fuelRow({ expenseAmount: 60, volume: 15 }),
    ];
    const { perFillup } = computeAverageCosts(rows, [], YEAR_START, YEAR_END, NOW);
    expect(perFillup).toBeCloseTo(50, 5);
  });

  test('all-split (no volume-bearing rows) gives a null perFillup, not a divide-by-zero or 0', () => {
    const rows: FuelExpenseRow[] = [
      fuelRow({ expenseAmount: 40, volume: null }),
      fuelRow({ expenseAmount: 40, volume: null }),
    ];
    const { perFillup } = computeAverageCosts(rows, [], YEAR_START, YEAR_END, NOW);
    expect(perFillup).toBeNull();
  });
});

// sortByVehicleThenDate groups by vehicle and sorts by date. Numeric dates are epoch milliseconds,
// and null sorts as 0.
describe('sortByVehicleThenDate', () => {
  test('groups by vehicleId, then orders within a vehicle by date ascending', () => {
    const rows: FuelExpenseRow[] = [
      fuelRow({ vehicleId: 'v2', date: d(2024, 3, 1) }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 6, 1) }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1) }),
      fuelRow({ vehicleId: 'v2', date: d(2024, 2, 1) }),
    ];
    const sorted = sortByVehicleThenDate(rows);
    expect(sorted.map((r) => r.vehicleId)).toEqual(['v1', 'v1', 'v2', 'v2']);
    expect((sorted[0].date as Date).getTime()).toBeLessThan((sorted[1].date as Date).getTime());
    expect((sorted[2].date as Date).getTime()).toBeLessThan((sorted[3].date as Date).getTime());
  });

  test('does NOT mutate the input array (returns a copy)', () => {
    const rows: FuelExpenseRow[] = [
      fuelRow({ vehicleId: 'v2', date: d(2024, 3, 1) }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1) }),
    ];
    const firstBefore = rows[0];
    const sorted = sortByVehicleThenDate(rows);
    expect(rows[0]).toBe(firstBefore);
    expect(sorted).not.toBe(rows);
  });

  test('handles a numeric (epoch-ms) date the same as a Date, and a null date sorts as 0', () => {
    const ms = d(2024, 5, 1).getTime();
    const rows: FuelExpenseRow[] = [
      fuelRow({ vehicleId: 'v1', date: ms }),
      fuelRow({ vehicleId: 'v1', date: null }),
    ];
    const sorted = sortByVehicleThenDate(rows);
    expect(sorted[0].date).toBeNull();
    expect(sorted[1].date).toBe(ms);
  });
});

// A charge stores kWh in volume, so its mi/kWh must not feed the mi/gal average. costPerMileValues
// stays unfiltered because cost per mile spans all energy.
describe('computeMpgAndCostPerMile — charge rows excluded from MPG, kept in cost-per-mile', () => {
  // Gas pair: 300 mi on 10 gal = 30 MPG. Charge pair on the same vehicle: 60 mi on 15 kWh = 4
  // mi/kWh, inside the electric band.
  const rows: FuelExpenseRow[] = [
    fuelRow({
      vehicleId: 'v1',
      date: d(2024, 1, 1),
      mileage: 10000,
      volume: 10,
      expenseAmount: 40,
      fuelType: 'regular',
    }),
    fuelRow({
      vehicleId: 'v1',
      date: d(2024, 1, 8),
      mileage: 10300,
      volume: 10,
      expenseAmount: 40,
      fuelType: 'regular',
    }),
    fuelRow({
      vehicleId: 'v1',
      date: d(2024, 1, 15),
      mileage: 10360,
      volume: 15,
      expenseAmount: 9,
      fuelType: 'Level 2 (AC)',
    }),
  ];

  test('mpgValues contains ONLY the gas-pair MPG (~30), not the charge-pair mi/kWh (~4)', () => {
    const { mpgValues } = computeMpgAndCostPerMile(rows);
    expect(mpgValues).toHaveLength(1);
    expect(mpgValues[0]).toBeCloseTo(30, 5);
    expect(mpgValues.some((v) => v < 10)).toBe(false);
  });

  test('costPerMileValues still includes the charge interval (cost spans all energy)', () => {
    const { costPerMileValues } = computeMpgAndCostPerMile(rows);
    expect(costPerMileValues).toHaveLength(2);
    expect(costPerMileValues.some((v) => Math.abs(v - 9 / 60) < 1e-9)).toBe(true);
  });

  test('a gas-only vehicle is unaffected (control)', () => {
    const gasOnly: FuelExpenseRow[] = [
      fuelRow({
        vehicleId: 'v2',
        date: d(2024, 2, 1),
        mileage: 20000,
        volume: 10,
        fuelType: 'regular',
      }),
      fuelRow({
        vehicleId: 'v2',
        date: d(2024, 2, 8),
        mileage: 20300,
        volume: 10,
        fuelType: 'regular',
      }),
    ];
    expect(computeMpgAndCostPerMile(gasOnly).mpgValues).toHaveLength(1);
  });
});

// gasEfficiencyPoint is the one gas/charge partition that every gas-MPG builder uses. It returns
// null for an electric row.
describe('gasEfficiencyPoint', () => {
  test('returns a point for a gas pair, null for an electric current row', () => {
    const gas = fuelRow({ mileage: 10300, volume: 10, fuelType: 'regular' });
    const prev = fuelRow({ mileage: 10000, volume: 10, fuelType: 'regular' });
    expect(gasEfficiencyPoint(gas, prev)?.efficiency).toBeCloseTo(30, 5);
    const charge = fuelRow({ mileage: 10360, volume: 15, fuelType: 'Level 2 (AC)' });
    expect(gasEfficiencyPoint(charge, gas)).toBeNull();
  });
});

// An EV-only vehicle must give an empty gas-MPG series, with no mi/kWh value labeled as mi/gal. Its
// cost per mile must still come from the charge spend.
describe('an EV-only vehicle yields an empty gas-MPG series but a real cost-per-mile', () => {
  // Two charge sessions on one all-electric vehicle: 240 mi on 60 kWh each, $9 each.
  const evRows: FuelExpenseRow[] = [
    fuelRow({
      vehicleId: 'ev1',
      date: d(2024, 3, 1),
      mileage: 20000,
      volume: 60,
      expenseAmount: 9,
      fuelType: 'DC Fast Charging',
    }),
    fuelRow({
      vehicleId: 'ev1',
      date: d(2024, 3, 10),
      mileage: 20240,
      volume: 60,
      expenseAmount: 9,
      fuelType: 'DC Fast Charging',
    }),
  ];

  test('mpgValues is empty, so no charge mi/kWh leaks into the gas-MPG array', () => {
    const { mpgValues, costPerMileValues } = computeMpgAndCostPerMile(evRows);
    expect(mpgValues).toHaveLength(0);
    expect(costPerMileValues).toHaveLength(1);
    expect(costPerMileValues[0]).toBeCloseTo(9 / 240, 9);
  });

  test('computeFuelConsumptionMetrics on the empty series is all-null', () => {
    const { mpgValues } = computeMpgAndCostPerMile(evRows);
    const fc = computeFuelConsumptionMetrics(mpgValues);
    expect(fc.avgEfficiency).toBeNull();
    expect(fc.bestEfficiency).toBeNull();
    expect(fc.worstEfficiency).toBeNull();
  });
});

// Pins the realistic-band limits against the real computeEfficiencyPoint: gas 5–100 mi/gal,
// electric 1–10 mi/kWh.
describe('computeEfficiencyPoint realistic-band boundaries (gas 5–100, electric 1–10)', () => {
  // Volume is 1, so efficiency equals the mileage delta. 'regular' uses the gas band and 'Level 2
  // (AC)' uses the electric band.
  const prev = (mileage: number, fuelType = 'regular') => fuelRow({ mileage, volume: 1, fuelType });
  const cur = (mileage: number, fuelType = 'regular') => fuelRow({ mileage, volume: 1, fuelType });

  test('a gas pair at exactly 100 MPG is kept', () => {
    expect(computeEfficiencyPoint(cur(10100), prev(10000))?.efficiency).toBe(100);
  });
  test('a gas pair at 101 MPG is rejected', () => {
    expect(computeEfficiencyPoint(cur(10101), prev(10000))).toBeNull();
  });
  test('a gas pair at exactly 5 MPG is kept', () => {
    expect(computeEfficiencyPoint(cur(10005), prev(10000))?.efficiency).toBe(5);
  });
  test('a gas pair at 4 MPG is rejected', () => {
    expect(computeEfficiencyPoint(cur(10004), prev(10000))).toBeNull();
  });
  test('an electric pair at exactly 10 mi/kWh is kept', () => {
    expect(
      computeEfficiencyPoint(cur(10010, 'Level 2 (AC)'), prev(10000, 'Level 2 (AC)'))?.efficiency
    ).toBe(10);
  });
  test('an electric pair at 11 mi/kWh is rejected', () => {
    expect(
      computeEfficiencyPoint(cur(10011, 'Level 2 (AC)'), prev(10000, 'Level 2 (AC)'))
    ).toBeNull();
  });
});

describe('buildFillupCostByVehicle', () => {
  const names = new Map([['v1', 'Camry']]);

  test('averages real fillup cost per vehicle-month', () => {
    const out = buildFillupCostByVehicle(
      [
        fuelRow({ date: d(2024, 1, 10), expenseAmount: 40, volume: 10 }),
        fuelRow({ date: d(2024, 1, 20), expenseAmount: 60, volume: 12 }),
      ],
      names
    );
    const jan = out.find((m) => m.month === '2024-01' && m.vehicleId === 'v1');
    expect(jan?.avgCost).toBe(50);
  });

  // A split-share leg has volume=null. It must not count as a fillup or dilute the average, so the
  // expected value is the real $40 fillup.
  test('a split fuel cost-allocation sibling (volume=null) is not counted as a fillup', () => {
    const out = buildFillupCostByVehicle(
      [
        fuelRow({ date: d(2024, 1, 10), expenseAmount: 40, volume: 10 }),
        fuelRow({ date: d(2024, 1, 20), expenseAmount: 30, volume: null }),
      ],
      names
    );
    const jan = out.find((m) => m.month === '2024-01' && m.vehicleId === 'v1');
    expect(jan?.avgCost).toBe(40);
  });

  test('a vehicle with only split-share legs has no chart row', () => {
    const out = buildFillupCostByVehicle(
      [fuelRow({ date: d(2024, 1, 20), expenseAmount: 30, volume: null })],
      names
    );
    expect(out.find((m) => m.vehicleId === 'v1')).toBeUndefined();
  });
});
