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
  buildFillupCostByVehicle,
  buildFillupIntervals,
  buildFuelEfficiencyComparison,
  buildMonthlyConsumption,
  buildMonthlyCostHeatmap,
  buildSeasonalEfficiency,
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

  // #113 (C390, the #56/#18/C97/#108 split-sibling class — the sibling of the #108 buildSeasonalEfficiency
  // fix at C367): a split fuel expense creates one sibling PER VEHICLE with volume=null, and
  // queryFuelExpenses has no volume filter, so an unconditional count overcounts a single split fillup as
  // N AND skews avgVolume (totalGallons/N) + avgCost (per-row, not per-fillup). The fix counts only
  // volume-bearing rows. This pins it: a Monday split fillup (1 volume row + 2 null siblings) is ONE
  // fillup with the REAL avg, not three.
  test('a split fuel fillup counts as ONE fillup with the real avg, not N (#113)', () => {
    const out = buildDayOfWeekPatterns([
      // One split fillup on Monday 2024-01-15: the volume-bearing leg + two null-volume per-vehicle siblings.
      fuelRow({ date: d(2024, 1, 15), expenseAmount: 30, volume: 12 }),
      fuelRow({ date: d(2024, 1, 15), expenseAmount: 30, volume: null }),
      fuelRow({ date: d(2024, 1, 15), expenseAmount: 30, volume: null }),
    ]);
    const monday = out.find((r) => r.day === 'Monday');
    // Pre-fix: fillupCount=3, avgVolume=12/3=4, avgCost=90/3=30. A split fillup is ONE fillup.
    expect(monday?.fillupCount).toBe(1);
    expect(monday?.avgVolume).toBe(12); // the real volume, not 12/3
    expect(monday?.avgCost).toBe(30); // the volume-bearing leg's cost, not skewed by the null siblings
  });

  test('a zero-volume fuel row is not counted as a fillup (#113 — boundary)', () => {
    const out = buildDayOfWeekPatterns([fuelRow({ date: d(2024, 1, 15), volume: 0 })]);
    const monday = out.find((r) => r.day === 'Monday');
    expect(monday?.fillupCount).toBe(0);
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

  // C391 (the #108/#113 split-sibling sweep): buildFillupIntervals is the SAFE sibling of the
  // overcounting buildSeasonalEfficiency(#108)/buildDayOfWeekPatterns(#113) — it pairs on DATES via
  // accumulateIntervalBuckets, whose `days <= 0 → continue` guard (analytics-charts.ts:893) drops a
  // SAME-DATE pair. A split fuel expense's null-volume siblings share the volume-bearing leg's date, so
  // they'd form 0-day pairs — which must NOT land in the '1-3 days' bucket as phantom intervals. This
  // pins that safety: a single split fillup (3 same-date rows) + one real later fillup yields exactly
  // ONE interval (the real gap), not 1 + the intra-split 0-day pairs. A regression loosening the
  // `days <= 0` guard (e.g. to `< 0`) would let the split inflate the distribution → RED.
  test('a same-date split fillup does NOT create phantom 0-day intervals (#108/#113 sibling, the days<=0 guard)', () => {
    const out = buildFillupIntervals([
      // One split fillup on Jan 1 (one volume-bearing leg + two null-volume siblings, same date+vehicle).
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1), volume: 12 }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1), volume: null }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1), volume: null }),
      // A real later fillup → the ONLY genuine interval (5 days → the '4-7 days' bucket).
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 6), volume: 10 }),
    ]);
    // Exactly one interval total — the 5-day gap. No 0-day '1-3 days' phantom from the intra-split pairs.
    const totalCount = out.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(1);
    expect(out.find((b) => b.intervalLabel === '4-7 days')?.count).toBe(1);
    expect(out.find((b) => b.intervalLabel === '1-3 days')).toBeUndefined(); // dropped (filtered count=0)
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

// #119 (C411): the FuelStats "Fuel Consumption" card (mpgValues → computeFuelConsumptionMetrics, labeled
// mi/gal) must NOT include a plug-in-hybrid's CHARGE sessions — a charge stores kWh in `volume`, so
// computeEfficiencyPoint emits its ~mi/kWh (a different quantity), which dragged the avg down + showed a
// charge's mi/kWh as "mi/gal". The fix excludes electric rows from mpgValues ONLY; costPerMileValues stays
// unfiltered because cost-per-mile is total energy spend over total miles (fuel + charge), a consistent
// $/mi (C378). Pre-fix mpgValues had length 2 (the gas point AND the charge point) — RED.
describe('computeMpgAndCostPerMile — charge rows excluded from MPG, kept in cost-per-mile (#119)', () => {
  // One gas vehicle: 10000 → 10300 mi on 10 gal = 30 MPG. One charge interval on the SAME vehicle right
  // after: 10300 → 10360 on 15 kWh = 4 mi/kWh (within the electric realistic band). Distinct mileages so
  // the cost-per-mile deltas are positive and real.
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
    // Gas pair (10000→10300/10gal) = 30. The charge pair (10300→10360/15kWh) = 4 must NOT appear.
    expect(mpgValues).toHaveLength(1); // was 2 pre-fix (gas + charge both pushed)
    expect(mpgValues[0]).toBeCloseTo(30, 5);
    expect(mpgValues.some((v) => v < 10)).toBe(false); // no mi/kWh-magnitude value leaked in
  });

  test('costPerMileValues still includes the charge interval (cost spans all energy, C378)', () => {
    const { costPerMileValues } = computeMpgAndCostPerMile(rows);
    // Both consecutive intervals contribute a cost/mile: gas 40/300 and charge 9/60 = 0.15.
    expect(costPerMileValues).toHaveLength(2);
    expect(costPerMileValues.some((v) => Math.abs(v - 9 / 60) < 1e-9)).toBe(true); // the charge $/mi survived
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

// #122 (C413): the #119 sweep across the sibling gas-MPG efficiency builders. They all summed
// computeEfficiencyPoint().efficiency into a gas-MPG average (labeled mi/gal) with no gas/charge
// partition, so a PHEV's ~mi/kWh charge point diluted the average. Now routed through gasEfficiencyPoint
// (the ONE source of truth — null for an electric current row). Pre-fix the charge interval contributed
// to effSum/effCount; post-fix only gas pairs do.
describe('gasEfficiencyPoint — gas-MPG partition source of truth (#122)', () => {
  test('returns a point for a gas pair, null for an electric current row', () => {
    const gas = fuelRow({ mileage: 10300, volume: 10, fuelType: 'regular' });
    const prev = fuelRow({ mileage: 10000, volume: 10, fuelType: 'regular' });
    expect(gasEfficiencyPoint(gas, prev)?.efficiency).toBeCloseTo(30, 5);
    const charge = fuelRow({ mileage: 10360, volume: 15, fuelType: 'Level 2 (AC)' });
    expect(gasEfficiencyPoint(charge, gas)).toBeNull(); // electric current → no gas point
  });
});

describe('sibling efficiency builders exclude PHEV charge from the gas-MPG average (#122)', () => {
  // Same vehicle: two gas fillups (10000→10300 on 10 gal = 30 MPG) then a charge session (→10360 on
  // 15 kWh = 4 mi/kWh). The gas-MPG average must be 30, NOT (30+4)/2 = 17.
  const rows: FuelExpenseRow[] = [
    fuelRow({
      vehicleId: 'v1',
      date: d(2024, 1, 1),
      mileage: 10000,
      volume: 10,
      fuelType: 'regular',
    }),
    fuelRow({
      vehicleId: 'v1',
      date: d(2024, 1, 8),
      mileage: 10300,
      volume: 10,
      fuelType: 'regular',
    }),
    fuelRow({
      vehicleId: 'v1',
      date: d(2024, 1, 15),
      mileage: 10360,
      volume: 15,
      fuelType: 'Level 2 (AC)',
    }),
  ];

  test('buildMonthlyConsumption efficiency is the gas MPG (30), not diluted by the charge mi/kWh', () => {
    const out = buildMonthlyConsumption(rows);
    const jan = out.find((m) => m.month === '2024-01');
    expect(jan).toBeDefined();
    // Pre-fix: (30 + 4)/2 = 17. Post-fix: only the gas pair counts → 30.
    expect(jan?.efficiency).toBeCloseTo(30, 5);
  });

  test('buildSeasonalEfficiency avgEfficiency is the gas MPG (30), not diluted', () => {
    const winter = buildSeasonalEfficiency(rows).find((s) => s.season === 'Winter');
    expect(winter?.avgEfficiency).toBeCloseTo(30, 5);
  });
});

// C414 (guard, NORTH_STAR #5): the LOAD-BEARING edge of the #119/#122 gas/charge partition — an EV-ONLY
// vehicle (all charge rows, no gas). The mixed-PHEV tests above pin that charge is excluded from the
// gas-MPG average; this pins the OTHER side that the C411/C413 fix rests on: a pure-EV car must produce a
// CLEAN-EMPTY gas-MPG series (null avg / empty mpgValues — NOT a phantom mi/kWh value mislabeled mi/gal,
// NOT a NaN/divide-by-zero), WHILE cost-per-mile still computes from the charge spend (cost spans all
// energy, C378). Without this, a refactor reverting gasEfficiencyPoint → computeEfficiencyPoint would
// re-mislabel an EV-only car's mi/kWh as mi/gal and only a mixed test (which still has a gas point) might
// stay green — this catches that distinctly. An EV-only car IS a real VROOM vehicle hitting Analytics.
describe('an EV-only vehicle yields an EMPTY gas-MPG series but a real cost-per-mile (#119/#122 load-bearing edge)', () => {
  // Two charge sessions on one all-electric vehicle: 20000 → 20240 mi on 60 kWh = 4 mi/kWh, $9 each.
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

  test('mpgValues is EMPTY (no charge mi/kWh leaks into the gas-MPG array)', () => {
    const { mpgValues, costPerMileValues } = computeMpgAndCostPerMile(evRows);
    expect(mpgValues).toHaveLength(0); // a refactor dropping the gas gate → length 1 here (the ~4 mi/kWh)
    // cost-per-mile STILL computes: 240 mi driven, $9 → 0.0375 $/mi.
    expect(costPerMileValues).toHaveLength(1);
    expect(costPerMileValues[0]).toBeCloseTo(9 / 240, 9);
  });

  test('computeFuelConsumptionMetrics on the empty series is all-null (no NaN, not a phantom value)', () => {
    const { mpgValues } = computeMpgAndCostPerMile(evRows);
    const fc = computeFuelConsumptionMetrics(mpgValues);
    expect(fc.avgEfficiency).toBeNull();
    expect(fc.bestEfficiency).toBeNull();
    expect(fc.worstEfficiency).toBeNull();
  });

  test('buildMonthlyConsumption shows a 0 gas efficiency for the EV-only month (no mi/kWh masquerading as mi/gal)', () => {
    const march = buildMonthlyConsumption(evRows).find((m) => m.month === '2024-03');
    expect(march).toBeDefined();
    // No gas pair → effCount 0 → efficiency 0 (the documented empty-series value), NOT the ~4 mi/kWh.
    expect(march?.efficiency).toBe(0);
    // The volume (kWh) still aggregates — that's a real charge total, not an efficiency.
    expect(march?.volume).toBeCloseTo(120, 5);
  });
});

// C419 (guard): pin computeEfficiencyPoint's realistic-band boundaries against the REAL function. The
// only existing band coverage (fuel-efficiency.property.test.ts) RE-IMPLEMENTS isRealisticEfficiency as a
// local reference and tests THAT — the C229 coverage-theater trap — so a regression changing
// MAX_VALID_MPG (5–100 gas) or MAX_VALID_MI_KWH (1–10 electric) would leave it green while production
// shifted. These drive the exported computeEfficiencyPoint directly so the band can't drift unnoticed.
// (As of C20 the per-vehicle stats path [calculations.ts averageConsecutiveMpg / calculateAverageMilesPerKwh]
// shares this SAME canonical band — the #30/C419 divergence was unified to [5,100]/[1,10], Angelo-APPROVED.)
describe('computeEfficiencyPoint — realistic-band boundaries (gas 5–100, electric 1–10) on the REAL fn', () => {
  // efficiency = (current.mileage − previous.mileage) / current.volume; control volume=1 so efficiency
  // equals the mileage delta. fuelType 'regular' = gas band [5,100]; 'Level 2 (AC)' = electric [1,10].
  const prev = (mileage: number, fuelType = 'regular') => fuelRow({ mileage, volume: 1, fuelType });
  const cur = (mileage: number, fuelType = 'regular') => fuelRow({ mileage, volume: 1, fuelType });

  test('a gas pair at exactly 100 MPG is KEPT (upper boundary inclusive)', () => {
    expect(computeEfficiencyPoint(cur(10100), prev(10000))?.efficiency).toBe(100);
  });
  test('a gas pair at 101 MPG is REJECTED (above the 100 cap → null)', () => {
    expect(computeEfficiencyPoint(cur(10101), prev(10000))).toBeNull();
  });
  test('a gas pair at exactly 5 MPG is KEPT (lower boundary inclusive)', () => {
    expect(computeEfficiencyPoint(cur(10005), prev(10000))?.efficiency).toBe(5);
  });
  test('a gas pair at 4 MPG is REJECTED (below the 5 floor → null)', () => {
    expect(computeEfficiencyPoint(cur(10004), prev(10000))).toBeNull();
  });
  test('an electric pair at exactly 10 mi/kWh is KEPT (upper boundary inclusive)', () => {
    expect(
      computeEfficiencyPoint(cur(10010, 'Level 2 (AC)'), prev(10000, 'Level 2 (AC)'))?.efficiency
    ).toBe(10);
  });
  test('an electric pair at 11 mi/kWh is REJECTED (above the 10 cap → null)', () => {
    expect(
      computeEfficiencyPoint(cur(10011, 'Level 2 (AC)'), prev(10000, 'Level 2 (AC)'))
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildFuelEfficiencyComparison (C456 guard) — the per-vehicle/per-month gas-MPG comparison rendered on
// the cross-vehicle analytics tab (getCrossVehicle's skipConversion branch, the DEFAULT same-units fleet
// case). It was the ONE comparison builder with ZERO test references: the #54 cross-vehicle-pairing pin
// covered the TREND path's forEachVehiclePair, and the #122/C413 gas-gate sweep covered buildMonthly
// Consumption/buildSeasonalEfficiency — but this builder re-rolls BOTH inline (groups byVehicle before
// pairing; gates on gasEfficiencyPoint) and neither pin reaches it. These drive the REAL export.
// ---------------------------------------------------------------------------
describe('buildFuelEfficiencyComparison (cross-vehicle per-month gas-MPG)', () => {
  const names = new Map([
    ['v1', 'Car One'],
    ['v2', 'Car Two'],
  ]);

  test('pairs ONLY within a vehicle — interleaved two-car rows never phantom-pair across vehicles (#54)', () => {
    // INTERLEAVED by date so a naive flat-list pairing would subtract v2's odometer from v1's:
    //   v1: 1000 → 1300 mi on 10 gal = 30 MPG;  v2: 5000 → 5240 mi on 8 gal = 30 MPG.
    // A cross-vehicle pair (e.g. v2@5000 − v1@1000) would be ~thousands of miles / a few gal = absurd.
    const rows: FuelExpenseRow[] = [
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 1), mileage: 1000, volume: 10 }),
      fuelRow({ vehicleId: 'v2', date: d(2024, 1, 10), mileage: 5000, volume: 8 }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 1, 20), mileage: 1300, volume: 10 }), // v1 pair → 30
      fuelRow({ vehicleId: 'v2', date: d(2024, 1, 25), mileage: 5240, volume: 8 }), // v2 pair → 30
    ];
    const out = buildFuelEfficiencyComparison(rows, names);
    // Both pairs land in 2024-01; each vehicle's efficiency is its OWN within-vehicle gas MPG = 30.
    const jan = out.find((m) => m.month === '2024-01');
    expect(jan, 'a 2024-01 bucket exists').toBeTruthy();
    const v1 = jan?.vehicles.find((v) => v.vehicleId === 'v1');
    const v2 = jan?.vehicles.find((v) => v.vehicleId === 'v2');
    expect(v1?.efficiency).toBeCloseTo(30, 5);
    expect(v1?.vehicleName).toBe('Car One');
    expect(v2?.efficiency).toBeCloseTo(30, 5);
    // NON-VACUOUS: a cross-vehicle phantom pair would push an efficiency wildly off 30 (or out of band → dropped).
  });

  test('a PHEV CHARGE row on a vehicle contributes NOTHING to its gas-MPG comparison (#122 gas-gate)', () => {
    // v1: a clean gas pair (30 MPG) PLUS a charge session — gasEfficiencyPoint excludes the electric row,
    // so v1's comparison efficiency stays the gas 30, never diluted by a ~mi/kWh value.
    const rows: FuelExpenseRow[] = [
      fuelRow({ vehicleId: 'v1', date: d(2024, 2, 1), mileage: 2000, volume: 10 }),
      fuelRow({ vehicleId: 'v1', date: d(2024, 2, 15), mileage: 2300, volume: 10 }), // gas pair → 30
      fuelRow({
        vehicleId: 'v1',
        date: d(2024, 2, 20),
        mileage: 2360,
        volume: 15,
        fuelType: 'Level 2 (AC)',
      }), // charge
    ];
    const out = buildFuelEfficiencyComparison(rows, names);
    const feb = out.find((m) => m.month === '2024-02');
    const v1 = feb?.vehicles.find((v) => v.vehicleId === 'v1');
    expect(v1?.efficiency, 'gas MPG only, charge excluded').toBeCloseTo(30, 5);
  });
});

describe('buildFillupCostByVehicle', () => {
  const names = new Map([['v1', 'Camry']]);

  test('averages real fillup cost per vehicle-month (baseline)', () => {
    const out = buildFillupCostByVehicle(
      [
        fuelRow({ date: d(2024, 1, 10), expenseAmount: 40, volume: 10 }),
        fuelRow({ date: d(2024, 1, 20), expenseAmount: 60, volume: 12 }),
      ],
      names
    );
    const jan = out.find((m) => m.month === '2024-01' && m.vehicleId === 'v1');
    expect(jan?.avgCost).toBe(50); // (40+60)/2
  });

  // #146 (C466, the #56/#108/#113 split-sibling overcount class — the member the C391 sweep + the
  // isFillup swept-site docstring missed): a split fuel expense creates one sibling PER VEHICLE with
  // volume=null, and queryFuelExpenses has no volume filter, so an unconditional count/sum treats each
  // partial-cost allocation as a standalone fillup and dilutes the per-vehicle average fillup cost.
  // This pins it: one $40 real fillup + one $30 split-share leg on v1 in a month → avgCost $40 (the
  // real fillup), NOT $35 (=70/2). NON-VACUOUS: pre-fix the null-volume leg was counted → $35.
  test('a split fuel cost-allocation sibling (volume=null) is NOT counted as a fillup (#146)', () => {
    const out = buildFillupCostByVehicle(
      [
        fuelRow({ date: d(2024, 1, 10), expenseAmount: 40, volume: 10 }), // a real fillup
        fuelRow({ date: d(2024, 1, 20), expenseAmount: 30, volume: null }), // a split-share leg on v1
      ],
      names
    );
    const jan = out.find((m) => m.month === '2024-01' && m.vehicleId === 'v1');
    expect(jan?.avgCost).toBe(40); // the real fillup's cost, not (40+30)/2 = 35
  });

  test('a vehicle with ONLY split-share legs (no real fillup) yields no chart row (#146 — boundary)', () => {
    const out = buildFillupCostByVehicle(
      [fuelRow({ date: d(2024, 1, 20), expenseAmount: 30, volume: null })],
      names
    );
    expect(out.find((m) => m.vehicleId === 'v1')).toBeUndefined();
  });
});
