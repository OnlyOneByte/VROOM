import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { isElectricFuelType } from '../../../db/types';
import {
  computeEfficiencyPoint,
  type FuelEfficiencyPoint,
  type FuelRow,
} from '../../../utils/analytics-charts';
import {
  MAX_VALID_MI_KWH,
  MAX_VALID_MPG,
  MIN_VALID_MI_KWH,
  MIN_VALID_MPG,
} from '../../../utils/calculations';

interface DatedFuelRow extends FuelRow {
  date: Date;
}

function efficiencyTrend(rows: DatedFuelRow[]): FuelEfficiencyPoint[] {
  const points: FuelEfficiencyPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const point = computeEfficiencyPoint(rows[i] as DatedFuelRow, rows[i - 1] as DatedFuelRow);
    if (point) points.push(point);
  }
  return points;
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
    const arbs: fc.Arbitrary<DatedFuelRow>[] = [];
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

describe('Fuel Efficiency — a missed fill-up voids only the interval ending at it', () => {
  test('a pair whose current entry is a missed fill-up always produces null', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        for (let i = 1; i < rows.length; i++) {
          const current = rows[i] as DatedFuelRow;
          if (current.missedFillup) {
            expect(computeEfficiencyPoint(current, rows[i - 1] as DatedFuelRow)).toBeNull();
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  test('a missed fill-up on the previous entry does not change the next interval', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        for (let i = 1; i < rows.length; i++) {
          const current = rows[i] as DatedFuelRow;
          const previous = rows[i - 1] as DatedFuelRow;
          if (current.missedFillup) continue;
          expect(computeEfficiencyPoint(current, { ...previous, missedFillup: true })).toEqual(
            computeEfficiencyPoint(current, { ...previous, missedFillup: false })
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  test('all-missed-fillup rows produce zero efficiency points', () => {
    fc.assert(
      fc.property(fuelRowListArb, (rows) => {
        const allMissed = rows.map((r) => ({ ...r, missedFillup: true }));
        expect(efficiencyTrend(allMissed).length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Fuel Efficiency — Unrealistic values are filtered', () => {
  test('all returned efficiencies are within realistic bounds for their fuel type', () => {
    fc.assert(
      fc.property(edgeCaseFuelRowListArb, (rows) => {
        const points = efficiencyTrend(rows);

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
        const points = efficiencyTrend(modified);

        expect(points.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Fuel Efficiency — Efficiency is always positive', () => {
  test('every returned efficiency value is strictly positive', () => {
    fc.assert(
      fc.property(edgeCaseFuelRowListArb, (rows) => {
        const points = efficiencyTrend(rows);

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
          const previous = rows[i - 1] as DatedFuelRow;
          const point = computeEfficiencyPoint(rows[i] as DatedFuelRow, previous);
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
        const points = efficiencyTrend(modified);
        expect(points.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});
