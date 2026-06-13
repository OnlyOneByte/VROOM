/**
 * Property-Based Tests for vehicle-stats.ts — calculateAverageMpg
 *
 * Property 1: Missed fill-up pairs are excluded from calculations
 * Property 2: Backward compatibility when no expenses are flagged
 * Property 3: Monotonicity — flagging expenses never increases data point count
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ELECTRIC_FUEL_TYPES, isElectricFuelType } from '../../db/types';
import { calculateVehicleStats, type FuelExpense } from '../vehicle-stats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a synthetic FuelExpense for testing. */
function makeFuelExpense(overrides: {
  mileage: number;
  volume: number;
  missedFillup: boolean;
  index: number;
  fuelType?: string;
}): FuelExpense {
  return {
    id: `exp-${overrides.index}`,
    mileage: overrides.mileage,
    volume: overrides.volume,
    fuelType: overrides.fuelType ?? '87 (Regular)',
    date: new Date(2024, 0, 1 + overrides.index),
    expenseAmount: overrides.volume * 3.5,
    missedFillup: overrides.missedFillup,
  };
}

/**
 * Reference implementation of calculateAverageMpg logic.
 * Computes MPG from consecutive pairs, skipping missed fill-ups.
 */
function referenceMpg(expenses: FuelExpense[]): { mpgValues: number[]; avg: number | null } {
  const mpgValues: number[] = [];
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    if (current.missedFillup || previous.missedFillup) continue;
    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.volume;
      if (mpg > 0 && mpg < 150) {
        mpgValues.push(mpg);
      }
    }
  }
  if (mpgValues.length === 0) return { mpgValues, avg: null };
  return { mpgValues, avg: mpgValues.reduce((s, v) => s + v, 0) / mpgValues.length };
}

/**
 * Count valid MPG pairs without any missed fill-up filtering.
 */
function countUnfilteredPairs(expenses: FuelExpense[]): number {
  let count = 0;
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.volume;
      if (mpg > 0 && mpg < 150) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const fuelExpenseListArb = fc.integer({ min: 2, max: 20 }).chain((len) =>
  fc.tuple(
    ...Array.from({ length: len }, (_, i) =>
      fc.record({
        mileage: fc.integer({ min: 10000 + i * 200, max: 10000 + i * 200 + 199 }),
        volume: fc.double({ min: 5, max: 25, noNaN: true }),
        missedFillup: fc.boolean(),
        index: fc.constant(i),
      })
    )
  )
);

const allUnflaggedListArb = fc.integer({ min: 2, max: 20 }).chain((len) =>
  fc.tuple(
    ...Array.from({ length: len }, (_, i) =>
      fc.record({
        mileage: fc.integer({ min: 10000 + i * 200, max: 10000 + i * 200 + 199 }),
        volume: fc.double({ min: 5, max: 25, noNaN: true }),
        missedFillup: fc.constant(false),
        index: fc.constant(i),
      })
    )
  )
);

/**
 * Verify that included MPG values match the reference calculation exactly.
 */
function verifyMpgValuesMatchReference(expenses: FuelExpense[], mpgValues: number[]): void {
  let validIdx = 0;
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    if (current.missedFillup || previous.missedFillup) continue;
    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.volume;
      if (mpg > 0 && mpg < 150) {
        expect(mpgValues[validIdx]).toBeCloseTo(mpg, 5);
        validIdx++;
      }
    }
  }
  expect(validIdx).toBe(mpgValues.length);
}

// ---------------------------------------------------------------------------
// Property 1: Missed fill-up pairs are excluded
// ---------------------------------------------------------------------------
describe('Property 1: Missed fill-up pairs are excluded from calculations', () => {
  test('pairs where current.missedFillup === true are never included', () => {
    fc.assert(
      fc.property(fuelExpenseListArb, (inputs) => {
        const expenses = inputs.map((input) => makeFuelExpense(input));
        const { mpgValues } = referenceMpg(expenses);
        verifyMpgValuesMatchReference(expenses, mpgValues);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Backward compatibility when no expenses are flagged
// ---------------------------------------------------------------------------
describe('Property 2: Backward compatibility when no expenses are flagged', () => {
  test('unflagged expenses produce same result as unfiltered calculation', () => {
    fc.assert(
      fc.property(allUnflaggedListArb, (inputs) => {
        const expenses = inputs.map((input) => makeFuelExpense(input));
        const { mpgValues } = referenceMpg(expenses);
        const unfilteredCount = countUnfilteredPairs(expenses);

        // When no expenses are flagged, all valid pairs should be included
        expect(mpgValues.length).toBe(unfilteredCount);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Monotonicity — flagging never increases data point count
// ---------------------------------------------------------------------------
describe('Property 3: Flagging expenses is monotonically non-increasing on data point count', () => {
  test('flagging any expense never increases the number of MPG data points', () => {
    fc.assert(
      fc.property(allUnflaggedListArb, fc.integer({ min: 0, max: 19 }), (inputs, flagIndex) => {
        const expenses = inputs.map((input) => makeFuelExpense(input));
        const actualFlagIndex = flagIndex % expenses.length;

        const unflaggedResult = referenceMpg(expenses);

        // Flag one expense
        const flaggedExpenses = expenses.map((e, i) =>
          i === actualFlagIndex ? { ...e, missedFillup: true } : e
        );
        const flaggedResult = referenceMpg(flaggedExpenses);

        expect(flaggedResult.mpgValues.length).toBeLessThanOrEqual(
          unflaggedResult.mpgValues.length
        );
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Generators for Property 4
// ---------------------------------------------------------------------------

/** All non-electric fuel type strings used in the app */
const NON_ELECTRIC_FUEL_TYPES = [
  '87 (Regular)',
  '89 (Mid-Grade)',
  '91 (Premium)',
  '93 (Super Premium)',
  'Diesel',
  'Ethanol-Free',
  'Other',
] as const;

/** Arbitrary for a single FuelExpense with a random fuelType (electric or non-electric) */
const mixedFuelExpenseArb = (index: number) =>
  fc
    .record({
      volume: fc.double({ min: 0.1, max: 500, noNaN: true }),
      fuelType: fc.oneof(
        fc.constantFrom(...ELECTRIC_FUEL_TYPES),
        fc.constantFrom(...NON_ELECTRIC_FUEL_TYPES)
      ),
      mileage: fc.integer({ min: 10000 + index * 200, max: 10000 + index * 200 + 199 }),
      expenseAmount: fc.double({ min: 0.01, max: 1000, noNaN: true }),
      missedFillup: fc.boolean(),
    })
    .map(
      (r): FuelExpense => ({
        id: `exp-${index}`,
        mileage: r.mileage,
        volume: r.volume,
        fuelType: r.fuelType,
        date: new Date(2024, 0, 1 + index),
        expenseAmount: r.expenseAmount,
        missedFillup: r.missedFillup,
      })
    );

/** Generate a list of 0–20 mixed fuel/charge expenses */
const mixedExpenseListArb = fc
  .integer({ min: 0, max: 20 })
  .chain((len) =>
    len === 0
      ? fc.constant([] as FuelExpense[])
      : fc.tuple(...Array.from({ length: len }, (_, i) => mixedFuelExpenseArb(i)))
  );

// ---------------------------------------------------------------------------
// Helpers for Property 4
// ---------------------------------------------------------------------------

/** Compute reference fuel/charge sums by partitioning on isElectricFuelType */
function referenceTotals(expenses: FuelExpense[]): { fuel: number; charge: number } {
  let fuel = 0;
  let charge = 0;
  for (const e of expenses) {
    if (e.volume) {
      if (isElectricFuelType(e.fuelType)) {
        charge += e.volume;
      } else {
        fuel += e.volume;
      }
    }
  }
  return { fuel, charge };
}

/** Normalize the mixedExpenseListArb output to a flat array */
function toExpenseList(expenses: FuelExpense[] | FuelExpense): FuelExpense[] {
  return Array.isArray(expenses) ? (expenses as FuelExpense[]) : [];
}

// ---------------------------------------------------------------------------
// Property 4: Stats totals partition by fuelType
// ---------------------------------------------------------------------------
/**
 * **Validates: Requirements 4.1, 4.6, 4.7**
 *
 * For any list of fuel-category expenses:
 * - totalFuelConsumed equals the sum of volume for non-electric fuelType expenses
 * - totalChargeConsumed equals the sum of volume for electric fuelType expenses
 * - totalFuelConsumed + totalChargeConsumed equals the sum of ALL volume values
 */
describe('Property 4: Stats totals partition by fuelType', () => {
  test('totalFuelConsumed + totalChargeConsumed equals sum of all volume values', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, true, true);
        const expected = referenceTotals(expenseList);

        expect(stats.totalFuelConsumed).toBeCloseTo(expected.fuel, 5);
        expect(stats.totalChargeConsumed).toBeCloseTo(expected.charge, 5);
        expect(stats.totalFuelConsumed + stats.totalChargeConsumed).toBeCloseTo(
          expected.fuel + expected.charge,
          5
        );
      }),
      { numRuns: 100 }
    );
  });

  test('totalFuelConsumed only includes non-electric fuelType expenses', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, true, true);
        const expected = referenceTotals(expenseList);

        expect(stats.totalFuelConsumed).toBeCloseTo(expected.fuel, 5);
      }),
      { numRuns: 100 }
    );
  });

  test('totalChargeConsumed only includes electric fuelType expenses', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, true, true);
        const expected = referenceTotals(expenseList);

        expect(stats.totalChargeConsumed).toBeCloseTo(expected.charge, 5);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Stats tracking flag gating
// ---------------------------------------------------------------------------
/**
 * **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
 *
 * - When trackFuel=false, averageMpg is always null regardless of expense data
 * - When trackCharging=false, averageMilesPerKwh is always null regardless of expense data
 * - When trackFuel=true and sufficient fuel data exists, averageMpg may be non-null
 * - When trackCharging=true and sufficient charge data exists, averageMilesPerKwh may be non-null
 */
describe('Property 5: Stats tracking flag gating', () => {
  test('averageMpg is null when trackFuel=false regardless of expense data', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, false, true);
        expect(stats.averageMpg).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('averageMilesPerKwh is null when trackCharging=false regardless of expense data', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, true, false);
        expect(stats.averageMilesPerKwh).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('both metrics are null when both flags are false', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, false, false);
        expect(stats.averageMpg).toBeNull();
        expect(stats.averageMilesPerKwh).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('averageMpg can be non-null only when trackFuel=true', () => {
    fc.assert(
      fc.property(
        mixedExpenseListArb,
        fc.boolean(),
        fc.boolean(),
        (expenses, trackFuel, trackCharging) => {
          const expenseList = toExpenseList(expenses);
          const stats = calculateVehicleStats(expenseList, 0, trackFuel, trackCharging);
          if (stats.averageMpg !== null) {
            expect(trackFuel).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('averageMilesPerKwh can be non-null only when trackCharging=true', () => {
    fc.assert(
      fc.property(
        mixedExpenseListArb,
        fc.boolean(),
        fc.boolean(),
        (expenses, trackFuel, trackCharging) => {
          const expenseList = toExpenseList(expenses);
          const stats = calculateVehicleStats(expenseList, 0, trackFuel, trackCharging);
          if (stats.averageMilesPerKwh !== null) {
            expect(trackCharging).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Regression (#46, C148): totalMileage is clamped at 0 — a driven distance can never be negative.
// A backdated/mistyped reading BELOW initialMileage (or the only in-window reading lower than the
// purchase odometer) must NOT surface a negative totalMileage. Correct under any #45 windowing.
// ---------------------------------------------------------------------------

describe('totalMileage non-negative clamp (#46)', () => {
  test('a reading below initialMileage yields totalMileage 0, not a negative distance', () => {
    // Only reading is 45000 but the vehicle was purchased at 50000 (mistyped/backdated row).
    const expenses: FuelExpense[] = [
      makeFuelExpense({ mileage: 45000, volume: 10, missedFillup: false, index: 0 }),
    ];
    const stats = calculateVehicleStats(expenses, 50000, true, false);
    // Pre-fix this was 45000 - 50000 = -5000 returned verbatim.
    expect(stats.totalMileage).toBe(0);
    expect(stats.currentMileage).toBe(45000); // the reading itself is still surfaced
    // costPerMile must stay null when there's no positive distance (no divide-by-≤0).
    expect(stats.costPerMile).toBeNull();
  });

  test('a normal reading above initialMileage still computes the real positive distance', () => {
    const expenses: FuelExpense[] = [
      makeFuelExpense({ mileage: 12000, volume: 10, missedFillup: false, index: 0 }),
    ];
    const stats = calculateVehicleStats(expenses, 10000, true, false);
    expect(stats.totalMileage).toBe(2000);
    expect(stats.currentMileage).toBe(12000);
  });

  test('a reading exactly at initialMileage yields totalMileage 0 (boundary)', () => {
    const expenses: FuelExpense[] = [
      makeFuelExpense({ mileage: 30000, volume: 10, missedFillup: false, index: 0 }),
    ];
    const stats = calculateVehicleStats(expenses, 30000, true, false);
    expect(stats.totalMileage).toBe(0);
    expect(stats.costPerMile).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression (#75, C222): averageMpg must be ORDER-INDEPENDENT. The MPG pairs CONSECUTIVE fillups
// (current − previous), so unordered input mis-pairs segments. calculateAverageMpg now sorts by date
// internally — the production caller already sorts, but this makes the pure helper correct for any
// future consumer. These assert shuffled input yields the SAME averageMpg as the chronological order.
// ---------------------------------------------------------------------------
describe('averageMpg is order-independent (#75)', () => {
  // 3 chronological fillups (index = day): 10000 → 10300 (300mi/10gal=30) → 10620 (320mi/10gal=32).
  // Expected avg MPG = (30 + 32) / 2 = 31, regardless of input order.
  const inOrder: FuelExpense[] = [
    makeFuelExpense({ mileage: 10000, volume: 10, missedFillup: false, index: 0 }),
    makeFuelExpense({ mileage: 10300, volume: 10, missedFillup: false, index: 1 }),
    makeFuelExpense({ mileage: 10620, volume: 10, missedFillup: false, index: 2 }),
  ];

  test('chronological input computes the expected average (baseline)', () => {
    const stats = calculateVehicleStats(inOrder, 10000, true, false);
    expect(stats.averageMpg).toBeCloseTo(31, 5);
  });

  test('SHUFFLED input yields the SAME averageMpg (the regression — was mis-paired pre-fix)', () => {
    // Reverse + interleave so consecutive array slots are NOT chronological.
    const shuffled = [inOrder[2], inOrder[0], inOrder[1]];
    const stats = calculateVehicleStats(shuffled, 10000, true, false);
    expect(stats.averageMpg).toBeCloseTo(31, 5);
  });

  test('a fully-reversed input still matches', () => {
    const reversed = [...inOrder].reverse();
    const stats = calculateVehicleStats(reversed, 10000, true, false);
    expect(stats.averageMpg).toBeCloseTo(31, 5);
  });
});

// ---------------------------------------------------------------------------
// Property 6: a MIXED plug-in-hybrid vehicle keeps MPG and mi/kWh ISOLATED
// (C353 guard, deep-review→guard from the C352 EV fan-out). calculateVehicleStats partitions on
// isElectricFuelType: gas rows feed averageMpg, charge rows feed averageMilesPerKwh. Property 4 pins
// the VOLUME/COST partition; this pins the EFFICIENCY isolation — a gas fill-up must NEVER enter the
// mi/kWh denominator and a charge must NEVER enter the MPG pairing (the #66 cross-contamination class).
// Deterministic round numbers so a leak shifts a metric to a detectably-wrong value.
// ---------------------------------------------------------------------------
describe('Property 6: a mixed fuel+charge vehicle keeps MPG and mi/kWh isolated', () => {
  // Gas: 10000→10300 mi on 10 gal each = 300/10 = 30 MPG. Electric: 20000→20060 mi on 15 kWh = 60/15 =
  // 4 mi/kWh. INTERLEAVED by index (date) so only the fuelType partition — not array order — separates
  // them. Mileage ranges are disjoint (10k vs 20k) so a cross-paired interval would be absurd, not 30/4.
  const mixed: FuelExpense[] = [
    makeFuelExpense({
      index: 0,
      mileage: 10000,
      volume: 10,
      missedFillup: false,
      fuelType: '87 (Regular)',
    }),
    makeFuelExpense({
      index: 1,
      mileage: 20000,
      volume: 15,
      missedFillup: false,
      fuelType: 'Level 2 (AC)',
    }),
    makeFuelExpense({
      index: 2,
      mileage: 10300,
      volume: 10,
      missedFillup: false,
      fuelType: '87 (Regular)',
    }),
    makeFuelExpense({
      index: 3,
      mileage: 20060,
      volume: 15,
      missedFillup: false,
      fuelType: 'Level 2 (AC)',
    }),
  ];

  test('averageMpg reflects ONLY the gas-row interval (30 MPG), uncontaminated by charges', () => {
    const stats = calculateVehicleStats(mixed, 0, true, true);
    expect(stats.averageMpg).toBeCloseTo(30, 5);
  });

  test('averageMilesPerKwh reflects ONLY the charge-row interval (4 mi/kWh), uncontaminated by gas', () => {
    const stats = calculateVehicleStats(mixed, 0, true, true);
    expect(stats.averageMilesPerKwh).toBeCloseTo(4, 5);
  });

  test('the volume + cost totals stay partitioned (gas 20 gal / electric 30 kWh)', () => {
    const stats = calculateVehicleStats(mixed, 0, true, true);
    expect(stats.totalFuelConsumed).toBeCloseTo(20, 5); // 10 + 10 gal
    expect(stats.totalChargeConsumed).toBeCloseTo(30, 5); // 15 + 15 kWh
    expect(stats.fuelExpenseCount).toBe(2);
    expect(stats.chargeExpenseCount).toBe(2);
  });

  // C378: costPerMile is the TOTAL energy spend (fuel + charge) over TOTAL distance driven — a
  // CONSISTENT numerator/denominator (both span every mileage row). The trackFuel/trackCharging flags
  // gate only the EFFICIENCY display (MPG / mi-kWh), NOT cost accounting: a dollar spent on either
  // energy is a real cost per real mile. A tempting "fix" that dropped charge COST when
  // trackCharging=false while keeping the charge MILES in the denominator would UNDER-report real
  // spend (a worse bug). Pin both: costPerMile == (fuelCost+chargeCost)/totalMileage, and it is
  // IDENTICAL across all four flag combinations.
  test('costPerMile is total-energy-cost / total-miles, IDENTICAL across tracking-flag combinations', () => {
    const both = calculateVehicleStats(mixed, 0, true, true);
    const totalMileage = 20060; // max(20060) − initial 0; consistent denominator across flags
    const expected = (both.totalFuelCost + both.totalChargeCost) / totalMileage;
    expect(both.costPerMile).toBeCloseTo(expected, 5);

    // The cost ratio must not move when a tracking flag flips — only MPG/mi-kWh are gated.
    for (const [tf, tc] of [
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      const s = calculateVehicleStats(mixed, 0, tf, tc);
      expect(s.costPerMile).toBeCloseTo(expected, 5);
    }
  });
});
