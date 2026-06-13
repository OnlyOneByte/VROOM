/**
 * Characterization tests for previously-UNPINNED pure builders in analytics-charts.ts
 * (C67 deep-review). These six date/bucketing-heavy functions had ZERO test references —
 * exactly the class the analytics defect vein has historically lived in (C7 pooled-distance,
 * C11 oldest-slice, C14 month-skip, C23 lump-sum premium). The C67 audit read each against
 * source and found them CORRECT; this locks that conclusion so a future edit can't silently
 * regress it (NORTH_STAR #5). Each test asserts an invariant the audit verified:
 *   - empty / single-element inputs don't NaN/Infinity/throw,
 *   - divide-by-zero guards hold,
 *   - localeCompare-then-slice keeps the NEWEST window (the C11/C13 direction class),
 *   - buildFillupIntervals does NOT mutate its input (the C67 hygiene fix).
 * Pure module → no DB, no server.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildDayOfWeekPatterns,
  buildFillupIntervals,
  buildMonthlyCostHeatmap,
  buildSeasonalEfficiency,
  computeAverageCosts,
  computeMileageScore,
  computePreviousYearComparison,
  computeRegularityScore,
  type FuelExpenseRow,
  type GeneralExpenseRow,
  sortByVehicleThenDate,
} from '../analytics-charts';

// Local-time date for a given Y/M/D so the bucketing assertions are timezone-independent
// (the functions bucket on local getMonth/getDay, matching the cycle-6/11 discipline).
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

describe('buildDayOfWeekPatterns', () => {
  test('empty input returns all 7 days at zero (no NaN from divide-by-zero)', () => {
    const out = buildDayOfWeekPatterns([]);
    expect(out).toHaveLength(7);
    expect(out.every((r) => r.fillupCount === 0 && r.avgCost === 0 && r.avgVolume === 0)).toBe(
      true
    );
    expect(out.every((r) => Number.isFinite(r.avgCost) && Number.isFinite(r.avgVolume))).toBe(true);
  });

  test('buckets a fill-up onto its LOCAL day-of-week and averages cost/volume', () => {
    // 2024-01-15 is a Monday in local time.
    const out = buildDayOfWeekPatterns([
      fuelRow({ date: d(2024, 1, 15), expenseAmount: 50, volume: 10 }),
      fuelRow({ date: d(2024, 1, 22), expenseAmount: 30, volume: 6 }), // also a Monday
    ]);
    const monday = out.find((r) => r.day === 'Monday');
    expect(monday?.fillupCount).toBe(2);
    expect(monday?.avgCost).toBe(40); // (50+30)/2
    expect(monday?.avgVolume).toBe(8); // (10+6)/2
  });
});

describe('buildSeasonalEfficiency', () => {
  test('empty input returns the 4 seasons at zero (no divide-by-zero)', () => {
    const out = buildSeasonalEfficiency([]);
    expect(out.map((s) => s.season)).toEqual(['Winter', 'Spring', 'Summer', 'Fall']);
    expect(out.every((s) => s.fillupCount === 0 && s.avgEfficiency === 0)).toBe(true);
  });

  test('counts a fill-up into its Northern-hemisphere season (Jan → Winter)', () => {
    const out = buildSeasonalEfficiency([fuelRow({ date: d(2024, 1, 10) })]);
    const winter = out.find((s) => s.season === 'Winter');
    expect(winter?.fillupCount).toBe(1);
    // A lone fill-up yields no consecutive pair → avgEfficiency stays 0 (not NaN).
    expect(winter?.avgEfficiency).toBe(0);
  });

  // #108 (C367, the #56/#18/C97 class): a split fuel expense creates one sibling PER VEHICLE —
  // each with its cost share but volume=null (createSiblings never sets volume). The query feeding
  // this (queryFuelExpenses) selects ALL category='fuel' rows with NO volume filter, so the
  // null-volume siblings arrive here. Pre-fix, the unconditional row count inflated the season's
  // fillupCount by N for a single split fillup; the fix counts only volume-bearing rows (a real
  // fillup has a volume), matching computeAverageCosts (#56) + the fuel-stats COUNT (C97).
  test('a split fuel fillup (1 volume-bearing row + null-volume siblings) counts as ONE fillup, not N (#108)', () => {
    const out = buildSeasonalEfficiency([
      // One split fillup in January: the volume-bearing leg + two null-volume per-vehicle siblings.
      fuelRow({ date: d(2024, 1, 10), volume: 12 }),
      fuelRow({ date: d(2024, 1, 10), volume: null }),
      fuelRow({ date: d(2024, 1, 10), volume: null }),
    ]);
    const winter = out.find((s) => s.season === 'Winter');
    // Pre-fix this was 3 (one per row). A split fillup is ONE fillup.
    expect(winter?.fillupCount).toBe(1);
  });

  test('a zero-volume fuel row is not counted as a fillup (#108 — boundary)', () => {
    const out = buildSeasonalEfficiency([fuelRow({ date: d(2024, 1, 10), volume: 0 })]);
    const winter = out.find((s) => s.season === 'Winter');
    expect(winter?.fillupCount).toBe(0);
  });
});

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

  test('keeps the NEWEST 24 months when more exist (localeCompare + slice(-24) direction)', () => {
    // 30 distinct months, Jan 2022 .. Jun 2024. Newest 24 = Jul 2022 .. Jun 2024.
    const rows: GeneralExpenseRow[] = [];
    for (let i = 0; i < 30; i++) {
      const year = 2022 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      rows.push(genRow({ date: d(year, month, 5), expenseAmount: 10 }));
    }
    const out = buildMonthlyCostHeatmap(rows);
    expect(out).toHaveLength(24);
    expect(out[0].month).toBe('2022-07'); // oldest of the kept window, not 2022-01
    expect(out[out.length - 1].month).toBe('2024-06'); // newest present
  });
});

describe('computeRegularityScore', () => {
  test('empty → 50, single → 75 (neutral defaults, no NaN)', () => {
    expect(computeRegularityScore([])).toBe(50);
    expect(computeRegularityScore([{ date: d(2024, 1, 1) }])).toBe(75);
  });

  test('all gaps within 90 days → 100; an overdue gap drops it', () => {
    const onTime = computeRegularityScore([
      { date: d(2024, 1, 1) },
      { date: d(2024, 2, 1) },
      { date: d(2024, 3, 1) },
    ]);
    expect(onTime).toBe(100);
    const overdue = computeRegularityScore([
      { date: d(2024, 1, 1) },
      { date: d(2024, 9, 1) }, // > 90 days
    ]);
    expect(overdue).toBeLessThan(100);
    expect(Number.isFinite(overdue)).toBe(true);
  });
});

describe('computeMileageScore', () => {
  test('fewer than 2 readings → 50 (no divide-by-zero)', () => {
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

describe('buildFillupIntervals — input is not mutated (C67 hygiene fix)', () => {
  test('the caller-visible row order is preserved after building intervals', () => {
    // Two vehicles, deliberately NOT date-sorted, so an in-place sort would reorder them.
    const rows: FuelExpenseRow[] = [
      fuelRow({ vehicleId: 'v1', date: d(2024, 3, 1) }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1) }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 2, 1) }),
    ];
    const before = rows.map((r) => (r.date as Date).getTime());
    buildFillupIntervals(rows);
    const after = rows.map((r) => (r.date as Date).getTime());
    expect(after).toEqual(before); // unchanged — buildFillupIntervals must be pure
  });

  test('buckets consecutive-fillup day gaps (28 days → the 22+ bucket)', () => {
    const out = buildFillupIntervals([
      fuelRow({ date: d(2024, 1, 1) }),
      fuelRow({ date: d(2024, 1, 29) }), // 28 days later
    ]);
    const bucket = out.find((b) => b.intervalLabel === '22+ days');
    expect(bucket?.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeAverageCosts.perFillup — #56 (C162): avg cost/fillup must divide by the FILLUP COUNT, not the
// row count. A split fuel expense creates one sibling per vehicle (cost share + volume=null), so a
// row-based denominator overcounts a split fillup as N → understated avg cost/fillup. Restrict numerator
// + denominator to volume-bearing rows (matching the C97 #18 count fix). Pure function, no DB.
// ---------------------------------------------------------------------------
describe('computeAverageCosts.perFillup — split fuel siblings do not inflate the denominator (#56)', () => {
  const YEAR_START = d(2024, 1, 1);
  const YEAR_END = d(2025, 1, 1);
  const NOW = d(2024, 6, 1);

  test('a split fillup (N null-volume siblings) counts as the volume-bearing fillups only', () => {
    // Two REAL fillups ($50 vol 10, $60 vol 12) + a split fillup materialized as 2 siblings ($40 each,
    // volume=null). Pre-fix: perFillup = (50+60+40+40)/4 = 47.5 (4 rows). Post-fix: only the 2
    // volume-bearing rows count → (50+60)/2 = 55.
    const rows: FuelExpenseRow[] = [
      fuelRow({ expenseAmount: 50, volume: 10 }),
      fuelRow({ expenseAmount: 60, volume: 12 }),
      fuelRow({ expenseAmount: 40, volume: null }), // split sibling
      fuelRow({ expenseAmount: 40, volume: null }), // split sibling
    ];
    const { perFillup } = computeAverageCosts(rows, [], YEAR_START, YEAR_END, NOW);
    expect(perFillup).toBeCloseTo(55, 5);
  });

  test('unsplit fillups are unchanged (volume>0 && cost>0 both hold → old behavior on the common path)', () => {
    const rows: FuelExpenseRow[] = [
      fuelRow({ expenseAmount: 40, volume: 10 }),
      fuelRow({ expenseAmount: 60, volume: 15 }),
    ];
    const { perFillup } = computeAverageCosts(rows, [], YEAR_START, YEAR_END, NOW);
    expect(perFillup).toBeCloseTo(50, 5);
  });

  test('all-split (no volume-bearing rows) → perFillup is null, not a divide-by-zero or 0', () => {
    const rows: FuelExpenseRow[] = [
      fuelRow({ expenseAmount: 40, volume: null }),
      fuelRow({ expenseAmount: 40, volume: null }),
    ];
    const { perFillup } = computeAverageCosts(rows, [], YEAR_START, YEAR_END, NOW);
    expect(perFillup).toBeNull();
  });
});

// sortByVehicleThenDate (C200 dedup): the canonical (vehicleId, then date asc) pre-sort the per-vehicle
// pairing builders need, hand-duplicated byte-for-byte at 3 analytics/repository.ts sites. Pins the
// comparator: groups by vehicle, orders within a vehicle by date, doesn't mutate the input, and the date
// key handles the `Date | number | null` shape (number = epoch-ms, null → 0) exactly as the inline form did.
describe('sortByVehicleThenDate', () => {
  test('groups by vehicleId, then orders within a vehicle by date ascending', () => {
    const rows: FuelExpenseRow[] = [
      fuelRow({ vehicleId: 'v2', date: d(2024, 3, 1) }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 6, 1) }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1) }),
      fuelRow({ vehicleId: 'v2', date: d(2024, 2, 1) }),
    ];
    const sorted = sortByVehicleThenDate(rows);
    // v1 rows first (localeCompare), date-ascending within each vehicle group.
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
    expect(rows[0]).toBe(firstBefore); // original order untouched
    expect(sorted).not.toBe(rows); // a new array
  });

  test('handles a numeric (epoch-ms) date the same as a Date, and a null date sorts as 0', () => {
    const ms = d(2024, 5, 1).getTime();
    const rows: FuelExpenseRow[] = [
      fuelRow({ vehicleId: 'v1', date: ms }), // number form
      fuelRow({ vehicleId: 'v1', date: null }), // null → 0 (earliest)
    ];
    const sorted = sortByVehicleThenDate(rows);
    expect(sorted[0].date).toBeNull(); // 0 sorts before the 2024 epoch-ms
    expect(sorted[1].date).toBe(ms);
  });
});
