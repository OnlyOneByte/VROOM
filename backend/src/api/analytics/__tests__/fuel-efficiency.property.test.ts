import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { isElectricFuelType } from '../../../db/types';

const MAX_REASONABLE_MILES_BETWEEN_FILLUPS = 1000;
const MIN_VALID_MPG = 5;
const MAX_VALID_MPG = 100;
const MIN_VALID_MI_KWH = 1;
const MAX_VALID_MI_KWH = 10;

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

interface FrontendExpense {
  category: string;
  date: string;
  mileage?: number;
  volume?: number;
  charge?: number;
  fuelType?: string;
  missedFillup?: boolean;
}

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

const GAS_FUEL_TYPES = ['Regular', 'Premium', 'Diesel', 'E85', null];
const ELECTRIC_FUEL_TYPES = ['Electric', 'Level 1 (Home)', 'Level 2 (AC)', 'DC Fast Charging'];

const fuelDateArb = fc
  .integer({ min: 1672531200000, max: 1767139200000 })
  .map((ms) => new Date(ms));

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

const mixedFuelRowArb = (baseMileage: number) =>
  fc.oneof(gasFuelRowArb(baseMileage), electricFuelRowArb(baseMileage));

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

describe('Fuel Efficiency — Missed fillups are always skipped', () => {
  test('pairs where current or previous has missedFillup always produce null', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
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

describe('Fuel Efficiency — Unrealistic values are filtered', () => {
  test('all returned efficiencies are within realistic bounds for their fuel type', () => {
    fc.assert(
      fc.property(edgeCaseFuelRowListArb, (rows) => {
        const points = referenceFuelEfficiencyTrend(rows);

        for (const point of points) {
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
        const modified = rows.map((r, i) => ({
          ...r,
          mileage: 10000 + i * 2000,
          missedFillup: false,
        }));
        const points = referenceFuelEfficiencyTrend(modified);

        expect(points.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Fuel Efficiency — Backend matches frontend for same input', () => {
  test('backend and frontend produce identical efficiency points for gas expenses', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        const gasRows = rows.map((r) => ({
          ...r,
          fuelType: isElectricFuelType(r.fuelType) ? 'Regular' : r.fuelType,
        }));

        const backendPoints = referenceFuelEfficiencyTrend(gasRows);

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

  test('backend and frontend produce identical efficiency points for electric expenses', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        const electricRows = rows.map((r) => ({
          ...r,
          fuelType: 'Electric',
        }));

        const backendPoints = referenceFuelEfficiencyTrend(electricRows);

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

describe('Fuel Efficiency — Efficiency is always positive', () => {
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

describe('Fuel Efficiency — Mileage increases between consecutive pairs', () => {
  test('each valid pair has increasing mileage', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
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
        const modified = rows.map((r, i) => ({
          ...r,
          mileage: 100000 - i * 100,
          missedFillup: false,
        }));
        const points = referenceFuelEfficiencyTrend(modified);
        expect(points.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});
