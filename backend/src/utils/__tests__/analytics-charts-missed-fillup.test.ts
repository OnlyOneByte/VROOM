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
    expect(june?.efficiency).toBeNull();
  });

  test('an implausibly large gap (> cap) is excluded', () => {
    const rows: GeneralExpenseRow[] = [
      general({ id: 'a', mileage: 10000, volume: 10, date: new Date(2024, 6, 1) }),
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
