/**
 * Regression tests (cycle 10) for the missed-fill-up guard in the monthly fuel charts.
 *
 * The canonical efficiency math (computeEfficiencyPoint) skips a consecutive pair when
 * EITHER row is a missed/partial fill-up, or the mileage gap is non-positive / implausibly
 * large (> MAX_REASONABLE_MILES_BETWEEN_FILLUPS). Two MONTH-AGGREGATING builders had drifted
 * from that contract:
 *   - buildFuelEfficiencyAndCost (accumulateFuelRow) — folded a missed-fill-up pair into the
 *     month's miles/gallons, counting one tank's volume against two tanks' miles → inflated MPG.
 *   - buildCostPerDistanceChart (accumulateCostPerMile) — same gap → spiked cost-per-distance.
 * These pin that both now skip missed fill-ups and over-cap gaps. Pure functions, no DB.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildCostPerDistanceChart,
  buildFuelEfficiencyAndCost,
  type FuelExpenseRow,
  type GeneralExpenseRow,
} from '../analytics-charts';

const FUEL = 'fuel';

function general(over: Partial<GeneralExpenseRow> & { id: string }): GeneralExpenseRow {
  return {
    vehicleId: 'veh-1',
    category: FUEL,
    description: null,
    expenseAmount: 40,
    date: new Date(2024, 0, 1),
    mileage: null,
    volume: null,
    missedFillup: false,
    ...over,
  };
}

describe('buildFuelEfficiencyAndCost — missed-fill-up does not inflate monthly MPG', () => {
  test('a missed-fill-up pair is excluded from the month efficiency', () => {
    // Three same-month fill-ups; the middle one is a missed fill-up. A correct MPG uses only
    // the clean 1→3? No: pairs are consecutive. Pair (2 after missed-1) must be skipped, and
    // pair (missed-2) must be skipped, leaving no valid window → efficiency null, not inflated.
    const rows: GeneralExpenseRow[] = [
      general({ id: 'a', mileage: 10000, volume: 10, date: new Date(2024, 5, 1) }),
      general({
        id: 'b',
        mileage: 10300,
        volume: 10,
        missedFillup: true,
        date: new Date(2024, 5, 10),
      }),
      general({ id: 'c', mileage: 10600, volume: 10, date: new Date(2024, 5, 20) }),
    ];
    const out = buildFuelEfficiencyAndCost(rows);
    const june = out.find((m) => m.month === '2024-06');
    expect(june).toBeTruthy();
    // Every consecutive pair touches the missed-fill-up row, so no valid distance window →
    // efficiency is null (no miles/gallons accumulated), NOT an inflated number.
    expect(june?.efficiency).toBeNull();
  });

  test('an implausibly large gap (> cap) is excluded', () => {
    const rows: GeneralExpenseRow[] = [
      general({ id: 'a', mileage: 10000, volume: 10, date: new Date(2024, 6, 1) }),
      // 5000 mi between fill-ups is over MAX_REASONABLE_MILES_BETWEEN_FILLUPS (1000) → bad data.
      general({ id: 'b', mileage: 15000, volume: 10, date: new Date(2024, 6, 15) }),
    ];
    const out = buildFuelEfficiencyAndCost(rows);
    const july = out.find((m) => m.month === '2024-07');
    expect(july?.efficiency).toBeNull();
  });

  test('a clean consecutive pair still produces a sane MPG', () => {
    const rows: GeneralExpenseRow[] = [
      general({ id: 'a', mileage: 10000, volume: 10, date: new Date(2024, 7, 1) }),
      general({ id: 'b', mileage: 10300, volume: 10, date: new Date(2024, 7, 15) }),
    ];
    const out = buildFuelEfficiencyAndCost(rows);
    const aug = out.find((m) => m.month === '2024-08');
    // 300 mi / 10 gal = 30 MPG.
    expect(aug?.efficiency).toBeCloseTo(30, 5);
  });
});

function fuelExp(over: Partial<FuelExpenseRow>): FuelExpenseRow {
  return {
    vehicleId: 'veh-1',
    date: new Date(2024, 0, 1),
    mileage: null,
    volume: null,
    fuelType: 'regular',
    missedFillup: false,
    expenseAmount: 40,
    ...over,
  };
}

describe('buildCostPerDistanceChart — missed-fill-up does not spike cost/distance', () => {
  test('a missed-fill-up pair contributes no miles (excluded from the month)', () => {
    const rows: FuelExpenseRow[] = [
      fuelExp({ mileage: 20000, expenseAmount: 50, date: new Date(2024, 2, 1) }),
      fuelExp({
        mileage: 20400,
        expenseAmount: 50,
        missedFillup: true,
        date: new Date(2024, 2, 15),
      }),
    ];
    // The only pair touches a missed fill-up → no month entry emitted (totalMiles filtered out).
    const out = buildCostPerDistanceChart(rows, new Map([['veh-1', 'My Car']]));
    expect(out.length).toBe(0);
  });

  test('a clean pair yields a finite cost-per-distance', () => {
    const rows: FuelExpenseRow[] = [
      fuelExp({ mileage: 20000, expenseAmount: 50, date: new Date(2024, 3, 1) }),
      fuelExp({ mileage: 20400, expenseAmount: 50, date: new Date(2024, 3, 15) }),
    ];
    const out = buildCostPerDistanceChart(rows, new Map([['veh-1', 'My Car']]));
    expect(out.length).toBe(1);
    expect(Number.isFinite(out[0]?.costPerDistance)).toBe(true);
    expect(out[0]?.costPerDistance).toBeGreaterThan(0);
  });
});
