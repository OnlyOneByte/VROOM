// Property-based tests for calculateVehicleStats. Missed fill-ups are excluded, flagging never adds
// data points, fuel and charge totals partition by fuelType, tracking flags gate the efficiency
// metrics, and distance never goes negative.

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ELECTRIC_FUEL_TYPES, isElectricFuelType } from '../../db/types';
import { calculateVehicleStats, type FuelExpense } from '../vehicle-stats';

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

function referenceMpg(expenses: FuelExpense[]): { mpgValues: number[]; avg: number | null } {
  const mpgValues: number[] = [];
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    if (current.missedFillup || previous.missedFillup) continue;
    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.volume;
      if (mpg >= 5 && mpg <= 100) {
        mpgValues.push(mpg);
      }
    }
  }
  if (mpgValues.length === 0) return { mpgValues, avg: null };
  return { mpgValues, avg: mpgValues.reduce((s, v) => s + v, 0) / mpgValues.length };
}

function countUnfilteredPairs(expenses: FuelExpense[]): number {
  let count = 0;
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.volume;
      if (mpg >= 5 && mpg <= 100) count++;
    }
  }
  return count;
}

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

function verifyMpgValuesMatchReference(expenses: FuelExpense[], mpgValues: number[]): void {
  let validIdx = 0;
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    if (current.missedFillup || previous.missedFillup) continue;
    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.volume;
      if (mpg >= 5 && mpg <= 100) {
        expect(mpgValues[validIdx]).toBeCloseTo(mpg, 5);
        validIdx++;
      }
    }
  }
  expect(validIdx).toBe(mpgValues.length);
}

describe('missed fill-up pairs are excluded from calculations', () => {
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

describe('backward compatibility when no expenses are flagged', () => {
  test('unflagged expenses produce same result as unfiltered calculation', () => {
    fc.assert(
      fc.property(allUnflaggedListArb, (inputs) => {
        const expenses = inputs.map((input) => makeFuelExpense(input));
        const { mpgValues } = referenceMpg(expenses);
        const unfilteredCount = countUnfilteredPairs(expenses);

        expect(mpgValues.length).toBe(unfilteredCount);
      }),
      { numRuns: 100 }
    );
  });
});

describe('flagging expenses is monotonically non-increasing on data point count', () => {
  test('flagging any expense never increases the number of MPG data points', () => {
    fc.assert(
      fc.property(allUnflaggedListArb, fc.integer({ min: 0, max: 19 }), (inputs, flagIndex) => {
        const expenses = inputs.map((input) => makeFuelExpense(input));
        const actualFlagIndex = flagIndex % expenses.length;

        const unflaggedResult = referenceMpg(expenses);

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

const NON_ELECTRIC_FUEL_TYPES = [
  '87 (Regular)',
  '89 (Mid-Grade)',
  '91 (Premium)',
  '93 (Super Premium)',
  'Diesel',
  'Ethanol-Free',
  'Other',
] as const;

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

const mixedExpenseListArb = fc
  .integer({ min: 0, max: 20 })
  .chain((len) =>
    len === 0
      ? fc.constant([] as FuelExpense[])
      : fc.tuple(...Array.from({ length: len }, (_, i) => mixedFuelExpenseArb(i)))
  );

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

function toExpenseList(expenses: FuelExpense[] | FuelExpense): FuelExpense[] {
  return Array.isArray(expenses) ? (expenses as FuelExpense[]) : [];
}

// Each total sums volume over the matching fuelType group, and together they cover every volume.
describe('stats totals partition by fuelType', () => {
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

describe('stats tracking flag gating', () => {
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

// A reading below the initial odometer, from a backdated or mistyped entry, must not produce
// negative distance.
describe('totalMileage non-negative clamp', () => {
  test('a reading below initialMileage yields totalMileage 0, not a negative distance', () => {
    const expenses: FuelExpense[] = [
      makeFuelExpense({ mileage: 45000, volume: 10, missedFillup: false, index: 0 }),
    ];
    const stats = calculateVehicleStats(expenses, 50000, true, false);
    expect(stats.totalMileage).toBe(0);
    expect(stats.currentMileage).toBe(45000);
    // costPerMile stays null without positive distance, which avoids a divide by zero.
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

// MPG pairs consecutive fill-ups, so the average must not depend on input order.
describe('averageMpg is order-independent', () => {
  // 10000 → 10300 (300 mi / 10 gal = 30) → 10620 (320 mi / 10 gal = 32). Average is 31 in any
  // order.
  const inOrder: FuelExpense[] = [
    makeFuelExpense({ mileage: 10000, volume: 10, missedFillup: false, index: 0 }),
    makeFuelExpense({ mileage: 10300, volume: 10, missedFillup: false, index: 1 }),
    makeFuelExpense({ mileage: 10620, volume: 10, missedFillup: false, index: 2 }),
  ];

  test('chronological input computes the expected average', () => {
    const stats = calculateVehicleStats(inOrder, 10000, true, false);
    expect(stats.averageMpg).toBeCloseTo(31, 5);
  });

  test('shuffled input yields the same averageMpg', () => {
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

// A plug-in hybrid keeps MPG and mi/kWh isolated. Gas rows feed averageMpg, charge rows feed
// averageMilesPerKwh, and neither may leak into the other.
describe('a mixed fuel and charge vehicle keeps MPG and mi/kWh isolated', () => {
  // Gas: 300 mi on 10 gal = 30 MPG. Electric: 60 mi on 15 kWh = 4 mi/kWh. Rows are interleaved, so
  // only fuelType separates them.
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
    expect(stats.totalFuelConsumed).toBeCloseTo(20, 5);
    expect(stats.totalChargeConsumed).toBeCloseTo(30, 5);
    expect(stats.fuelExpenseCount).toBe(2);
    expect(stats.chargeExpenseCount).toBe(2);
  });

  // costPerMile is total energy cost over total miles and ignores the tracking flags, which gate
  // only the efficiency metrics. Gating charge cost off while keeping charge miles would
  // under-report spend.
  test('costPerMile is total-energy-cost / total-miles, identical across tracking-flag combinations', () => {
    const both = calculateVehicleStats(mixed, 0, true, true);
    const totalMileage = 20060;
    const expected = (both.totalFuelCost + both.totalChargeCost) / totalMileage;
    expect(both.costPerMile).toBeCloseTo(expected, 5);

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

// The MPG band is the inclusive [5,100] shared with analytics charts, so the stats card and the
// Fuel Stats card agree.
describe('averageMpg excludes out-of-band outlier pairs ([5,100] band)', () => {
  const anchor0 = makeFuelExpense({ mileage: 10000, volume: 10, missedFillup: false, index: 0 });
  const anchor1 = makeFuelExpense({ mileage: 10300, volume: 10, missedFillup: false, index: 1 });

  test('an above-band pair (>100 MPG, a mistyped tiny volume) is dropped, averaging only the realistic pair', () => {
    // 350 mi on 2 gal = 175 MPG. A looser cap would average it in and give (30 + 175) / 2.
    const outlier = makeFuelExpense({ mileage: 10650, volume: 2, missedFillup: false, index: 2 });
    const stats = calculateVehicleStats([anchor0, anchor1, outlier], 10000, true, false);
    expect(stats.averageMpg).toBeCloseTo(30, 5);
  });

  test('the band is INCLUSIVE: a pair at EXACTLY 100 MPG (=MAX) is KEPT', () => {
    // 200 mi on 2 gal = 100 MPG. An exclusive upper bound would drop it and give 30.
    const atMax = makeFuelExpense({ mileage: 10500, volume: 2, missedFillup: false, index: 2 });
    const stats = calculateVehicleStats([anchor0, anchor1, atMax], 10000, true, false);
    expect(stats.averageMpg).toBeCloseTo((30 + 100) / 2, 5);
  });

  test('a below-band pair (<5 MPG) is dropped (the MIN_VALID_MPG=5 floor)', () => {
    // 40 mi on 10 gal = 4 MPG. A (0,150) band would keep it and give 17.
    const tooLow = makeFuelExpense({ mileage: 10340, volume: 10, missedFillup: false, index: 2 });
    const stats = calculateVehicleStats([anchor0, anchor1, tooLow], 10000, true, false);
    expect(stats.averageMpg).toBeCloseTo(30, 5);
  });

  test('a non-positive pair (a duplicate/zero-delta odometer reading) is dropped', () => {
    // Same odometer reading twice gives 0 miles. Admitting that pair would give 15.
    const zeroDelta = makeFuelExpense({
      mileage: 10300,
      volume: 10,
      missedFillup: false,
      index: 2,
    });
    const stats = calculateVehicleStats([anchor0, anchor1, zeroDelta], 10000, true, false);
    expect(stats.averageMpg).toBeCloseTo(30, 5);
  });
});
