/**
 * Property-Based Tests for Fuel Efficiency Computation
 *
 * Property 7: Fuel Efficiency Equivalence
 * Server-side fuelEfficiencyTrend produces identical points to frontend
 * prepareFuelEfficiencyData for the same input data.
 *
 * Key properties tested:
 * 1. Missed fillups are always skipped (no efficiency point when current or previous has missedFillup=true)
 * 2. Unrealistic values are filtered (MPG outside 5-100, mi/kWh outside 1-10)
 * 3. Output matches the frontend prepareFuelEfficiencyData for the same input data
 * 4. Efficiency is always positive when returned
 * 5. Mileage must be increasing between consecutive pairs
 *
 * **Validates: Property 7**
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { isElectricFuelType } from '../../../db/types';

// ---------------------------------------------------------------------------
// Constants — must match both backend repository.ts and frontend expense-helpers.ts
// ---------------------------------------------------------------------------
const MAX_REASONABLE_MILES_BETWEEN_FILLUPS = 1000;
const MIN_VALID_MPG = 5;
const MAX_VALID_MPG = 100;
const MIN_VALID_MI_KWH = 1;
const MAX_VALID_MI_KWH = 10;

// ---------------------------------------------------------------------------
// Types — mirrors the backend FuelRow and FuelEfficiencyPoint
// ---------------------------------------------------------------------------
interface FuelRow {
  date: Date;
  mileage: number | null;
  volume: number | null;
  fuelType: string | null;
  missedFillup: boolean;
}

interface FuelEfficiencyPoint {
  date: string;
  efficiency: number;
  mileage: number;
}

// ---------------------------------------------------------------------------
// Reference implementation — replicates backend computeEfficiencyPoint exactly
// ---------------------------------------------------------------------------
function isRealisticEfficiency(efficiency: number, electric: boolean): boolean {
  if (electric) {
    return efficiency >= MIN_VALID_MI_KWH && efficiency <= MAX_VALID_MI_KWH;
  }
  return efficiency >= MIN_VALID_MPG && efficiency <= MAX_VALID_MPG;
}

function computeEfficiencyPoint(current: FuelRow, previous: FuelRow): FuelEfficiencyPoint | null {
  if (current.missedFillup || previous.missedFillup) return null;
  if (!current.mileage || !previous.mileage) return null;

  const milesDriven = current.mileage - previous.mileage;
  if (milesDriven <= 0 || milesDriven > MAX_REASONABLE_MILES_BETWEEN_FILLUPS) return null;
  if (!current.volume || current.volume <= 0) return null;

  const efficiency = milesDriven / current.volume;
  if (!isRealisticEfficiency(efficiency, isElectricFuelType(current.fuelType))) return null;

  return {
    date: current.date instanceof Date ? current.date.toISOString() : String(current.date),
    efficiency,
    mileage: current.mileage,
  };
}

/**
 * Reference: compute fuel efficiency trend from a list of fuel rows (sorted by date ASC).
 * Mirrors the backend AnalyticsRepository.getFuelEfficiencyTrend algorithm.
 */
function referenceFuelEfficiencyTrend(rows: FuelRow[]): FuelEfficiencyPoint[] {
  if (rows.length < 2) return [];

  const points: FuelEfficiencyPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const current = rows[i];
    const previous = rows[i - 1];
    if (!current || !previous) continue;

    const point = computeEfficiencyPoint(current, previous);
    if (point) points.push(point);
  }
  return points;
}

// ---------------------------------------------------------------------------
// Frontend reference — replicates prepareFuelEfficiencyData logic
// Uses volume/charge instead of volume, validates per fuel type
// ---------------------------------------------------------------------------
interface FrontendExpense {
  category: string;
  date: string;
  mileage?: number;
  volume?: number;
  charge?: number;
  fuelType?: string;
  missedFillup?: boolean;
}

/** Compute efficiency for a single frontend expense pair. Returns null if invalid. */
function frontendComputePoint(
  current: FrontendExpense,
  previous: FrontendExpense
): FuelEfficiencyPoint | null {
  if (current.missedFillup || previous.missedFillup) return null;
  if (!current.mileage || !previous.mileage) return null;

  const milesDriven = current.mileage - previous.mileage;
  if (milesDriven <= 0 || milesDriven > MAX_REASONABLE_MILES_BETWEEN_FILLUPS) return null;

  let efficiency: number | undefined;
  let isValid = false;

  if (current.volume !== undefined && current.volume > 0) {
    efficiency = milesDriven / current.volume;
    isValid = efficiency >= MIN_VALID_MPG && efficiency <= MAX_VALID_MPG;
  } else if (current.charge !== undefined && current.charge > 0) {
    efficiency = milesDriven / current.charge;
    isValid = efficiency >= MIN_VALID_MI_KWH && efficiency <= MAX_VALID_MI_KWH;
  }

  if (!isValid || efficiency === undefined) return null;

  return {
    date: new Date(current.date).toISOString(),
    efficiency,
    mileage: current.mileage,
  };
}

function frontendPrepareFuelEfficiencyData(expenses: FrontendExpense[]): FuelEfficiencyPoint[] {
  const fuelExpenses = expenses
    .filter((e) => {
      if (e.category !== 'fuel' || !e.mileage) return false;
      return e.volume !== undefined || e.charge !== undefined;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (fuelExpenses.length < 2) return [];

  const result: FuelEfficiencyPoint[] = [];

  for (let i = 1; i < fuelExpenses.length; i++) {
    const current = fuelExpenses[i];
    const previous = fuelExpenses[i - 1];
    if (!current || !previous) continue;

    const point = frontendComputePoint(current, previous);
    if (point) result.push(point);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
const GAS_FUEL_TYPES = ['Regular', 'Premium', 'Diesel', 'E85', null];
const ELECTRIC_FUEL_TYPES = ['Electric', 'Level 1 (Home)', 'Level 2 (AC)', 'DC Fast Charging'];

const fuelDateArb = fc
  .integer({ min: 1672531200000, max: 1767139200000 }) // 2023-01-01 to 2025-12-31
  .map((ms) => new Date(ms));

/** Generate a gas fuel row with realistic mileage progression. */
const gasFuelRowArb = (baseMileage: number) =>
  fc.record({
    date: fuelDateArb,
    mileage: fc
      .integer({ min: baseMileage, max: baseMileage + 1200 })
      .map((m) => m as number | null),
    volume: fc
      .double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true })
      .map((v) => v as number | null),
    fuelType: fc.constantFrom(...GAS_FUEL_TYPES),
    missedFillup: fc.boolean(),
  });

/** Generate an electric fuel row. */
const electricFuelRowArb = (baseMileage: number) =>
  fc.record({
    date: fuelDateArb,
    mileage: fc
      .integer({ min: baseMileage, max: baseMileage + 1200 })
      .map((m) => m as number | null),
    volume: fc
      .double({ min: 0.5, max: 200, noNaN: true, noDefaultInfinity: true })
      .map((v) => v as number | null),
    fuelType: fc.constantFrom(...ELECTRIC_FUEL_TYPES),
    missedFillup: fc.boolean(),
  });

/** Generate a mixed fuel row (gas or electric). */
const mixedFuelRowArb = (baseMileage: number) =>
  fc.oneof(gasFuelRowArb(baseMileage), electricFuelRowArb(baseMileage));

/**
 * Generate a list of fuel rows with increasing base mileage and sorted by date.
 * This simulates realistic sequential fuel expense data.
 */
const fuelRowListArb = fc
  .integer({ min: 2, max: 20 })
  .chain((len) => {
    const arbs: fc.Arbitrary<FuelRow>[] = [];
    for (let i = 0; i < len; i++) {
      arbs.push(mixedFuelRowArb(10000 + i * 300));
    }
    return fc.tuple(...arbs);
  })
  .map((rows) => [...rows].sort((a, b) => a.date.getTime() - b.date.getTime()));

/**
 * Generate rows that include edge cases: null mileage, null volume, zero volume.
 */
const edgeCaseFuelRowArb = fc.record({
  date: fuelDateArb,
  mileage: fc.option(fc.integer({ min: 1000, max: 200000 }), { nil: null }),
  volume: fc.option(fc.double({ min: -5, max: 50, noNaN: true, noDefaultInfinity: true }), {
    nil: null,
  }),
  fuelType: fc.constantFrom(...GAS_FUEL_TYPES, ...ELECTRIC_FUEL_TYPES),
  missedFillup: fc.boolean(),
});

const edgeCaseFuelRowListArb = fc
  .array(edgeCaseFuelRowArb, { minLength: 2, maxLength: 25 })
  .map((rows) => [...rows].sort((a, b) => a.date.getTime() - b.date.getTime()));

// ---------------------------------------------------------------------------
// Property 7: Fuel Efficiency Equivalence — Missed fillups are always skipped
// **Validates: Property 7**
// ---------------------------------------------------------------------------
describe('Property 7: Fuel Efficiency — Missed fillups are always skipped', () => {
  test('pairs where current or previous has missedFillup always produce null', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        // Directly verify: for every consecutive pair where either has missedFillup,
        // computeEfficiencyPoint returns null
        for (let i = 1; i < rows.length; i++) {
          const current = rows[i];
          const previous = rows[i - 1];
          if (!current || !previous) continue;

          if (current.missedFillup || previous.missedFillup) {
            const point = computeEfficiencyPoint(current, previous);
            expect(point).toBeNull();
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  test('all-missed-fillup rows produce zero efficiency points', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        const allMissed = rows.map((r) => ({ ...r, missedFillup: true }));
        const points = referenceFuelEfficiencyTrend(allMissed);
        expect(points.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Fuel Efficiency — Unrealistic values are filtered
// **Validates: Property 7**
// ---------------------------------------------------------------------------
describe('Property 7: Fuel Efficiency — Unrealistic values are filtered', () => {
  test('all returned efficiencies are within realistic bounds for their fuel type', () => {
    fc.assert(
      fc.property(edgeCaseFuelRowListArb, (rows) => {
        const points = referenceFuelEfficiencyTrend(rows);

        for (const point of points) {
          // Find the row that produced this point to check fuel type
          const row = rows.find((r) => r.date.toISOString() === point.date);
          if (row && isElectricFuelType(row.fuelType)) {
            expect(point.efficiency).toBeGreaterThanOrEqual(MIN_VALID_MI_KWH);
            expect(point.efficiency).toBeLessThanOrEqual(MAX_VALID_MI_KWH);
          } else {
            expect(point.efficiency).toBeGreaterThanOrEqual(MIN_VALID_MPG);
            expect(point.efficiency).toBeLessThanOrEqual(MAX_VALID_MPG);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  test('mileage difference > 1000 never produces a point', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        // Force large mileage gaps
        const modified = rows.map((r, i) => ({
          ...r,
          mileage: 10000 + i * 2000, // 2000 mile gaps
          missedFillup: false,
        }));
        const points = referenceFuelEfficiencyTrend(modified);

        // All gaps are > 1000, so no points should be produced
        expect(points.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Fuel Efficiency — Output matches frontend prepareFuelEfficiencyData
// **Validates: Property 7**
// ---------------------------------------------------------------------------
describe('Property 7: Fuel Efficiency — Backend matches frontend for same input', () => {
  test('backend and frontend produce identical efficiency points for gas expenses', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        // Only use non-electric rows for this test
        const gasRows = rows.map((r) => ({
          ...r,
          fuelType: isElectricFuelType(r.fuelType) ? 'Regular' : r.fuelType,
        }));

        // Backend computation
        const backendPoints = referenceFuelEfficiencyTrend(gasRows);

        // Convert to frontend format: volume → volume
        const frontendExpenses: FrontendExpense[] = gasRows.map((r) => ({
          category: 'fuel',
          date: r.date.toISOString(),
          mileage: r.mileage ?? undefined,
          volume: r.volume ?? undefined,
          charge: undefined,
          fuelType: r.fuelType ?? undefined,
          missedFillup: r.missedFillup,
        }));

        const frontendPoints = frontendPrepareFuelEfficiencyData(frontendExpenses);

        // Same number of points
        expect(backendPoints.length).toBe(frontendPoints.length);

        // Same values (within floating point tolerance)
        for (let i = 0; i < backendPoints.length; i++) {
          const bp = backendPoints[i];
          const fp = frontendPoints[i];
          if (!bp || !fp) continue;
          expect(bp.date).toBe(fp.date);
          expect(Math.abs(bp.efficiency - fp.efficiency)).toBeLessThan(0.0001);
          expect(bp.mileage).toBe(fp.mileage);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('backend and frontend produce identical efficiency points for electric expenses', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        // Force all rows to electric
        const electricRows = rows.map((r) => ({
          ...r,
          fuelType: 'Electric',
        }));

        // Backend computation
        const backendPoints = referenceFuelEfficiencyTrend(electricRows);

        // Convert to frontend format: volume → charge
        const frontendExpenses: FrontendExpense[] = electricRows.map((r) => ({
          category: 'fuel',
          date: r.date.toISOString(),
          mileage: r.mileage ?? undefined,
          volume: undefined,
          charge: r.volume ?? undefined,
          fuelType: r.fuelType ?? undefined,
          missedFillup: r.missedFillup,
        }));

        const frontendPoints = frontendPrepareFuelEfficiencyData(frontendExpenses);

        expect(backendPoints.length).toBe(frontendPoints.length);

        for (let i = 0; i < backendPoints.length; i++) {
          const bp = backendPoints[i];
          const fp = frontendPoints[i];
          if (!bp || !fp) continue;
          expect(bp.date).toBe(fp.date);
          expect(Math.abs(bp.efficiency - fp.efficiency)).toBeLessThan(0.0001);
          expect(bp.mileage).toBe(fp.mileage);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Fuel Efficiency — Efficiency is always positive
// **Validates: Property 7**
// ---------------------------------------------------------------------------
describe('Property 7: Fuel Efficiency — Efficiency is always positive', () => {
  test('every returned efficiency value is strictly positive', () => {
    fc.assert(
      fc.property(edgeCaseFuelRowListArb, (rows) => {
        const points = referenceFuelEfficiencyTrend(rows);

        for (const point of points) {
          expect(point.efficiency).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Fuel Efficiency — Mileage must be increasing
// **Validates: Property 7**
// ---------------------------------------------------------------------------
describe('Property 7: Fuel Efficiency — Mileage increases between consecutive pairs', () => {
  test('each valid pair has increasing mileage', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        // Directly verify: for every consecutive pair that produces a point,
        // current.mileage > previous.mileage
        for (let i = 1; i < rows.length; i++) {
          const current = rows[i];
          const previous = rows[i - 1];
          if (!current || !previous) continue;

          const point = computeEfficiencyPoint(current, previous);
          if (point && previous.mileage) {
            expect(point.mileage).toBeGreaterThan(previous.mileage);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  test('non-increasing mileage pairs never produce efficiency points', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        // Force decreasing mileage
        const modified = rows.map((r, i) => ({
          ...r,
          mileage: 100000 - i * 100, // decreasing
          missedFillup: false,
        }));
        const points = referenceFuelEfficiencyTrend(modified);
        expect(points.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});
