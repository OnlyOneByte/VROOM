import { describe, expect, test } from 'bun:test';
import {
  buildGasPriceHistory,
  buildMaintenanceTimeline,
  buildTotalsByVehicle,
  buildVehicleMaintenanceCosts,
  type FuelExpenseRow,
  type GeneralExpenseRow,
  isChargeSession,
  isFillup,
  zonedCalendar,
} from '../analytics-charts';

const DAY_MS = 24 * 60 * 60 * 1000;

function d(year: number, month1to12: number, day: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day));
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
    category: 'maintenance',
    description: null,
    expenseAmount: 100,
    date: d(2024, 1, 15),
    mileage: null,
    volume: null,
    fuelType: null,
    missedFillup: false,
    ...over,
  };
}

describe('buildGasPriceHistory', () => {
  test('empty input returns []', () => {
    expect(buildGasPriceHistory([])).toEqual([]);
  });

  test('pricePerVolume = expenseAmount / volume; fuelType passes through', () => {
    const out = buildGasPriceHistory([
      fuelRow({ expenseAmount: 45, volume: 10, fuelType: 'premium' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.pricePerVolume).toBeCloseTo(4.5, 10);
    expect(out[0]?.fuelType).toBe('premium');
  });

  test('a null fuelType counts with "87 (Regular)", the form\'s regular grade', () => {
    const out = buildGasPriceHistory([
      fuelRow({ fuelType: null }),
      fuelRow({ fuelType: '87 (Regular)' }),
    ]);
    expect(out.map((r) => r.fuelType)).toEqual(['87 (Regular)', '87 (Regular)']);
  });

  test("each entry carries its volume in the user's unit, for volume-weighted averages", () => {
    const toLitres = (v: number) => v * 3.78541;
    const out = buildGasPriceHistory(
      [fuelRow({ volume: 10, expenseAmount: 40 })],
      isFillup,
      toLitres
    );
    expect(out[0]?.volume).toBeCloseTo(37.8541, 4);
    expect(out[0]?.pricePerVolume).toBeCloseTo(40 / 37.8541, 6);
  });
});

describe('buildTotalsByVehicle', () => {
  const names = new Map([
    ['v1', 'Daily Driver'],
    ['v2', 'Weekend Car'],
  ]);

  test('sums count, volume and cost per car for the rows it includes, busiest car first', () => {
    const out = buildTotalsByVehicle(
      [
        fuelRow({ vehicleId: 'v2', volume: 8, expenseAmount: 30 }),
        fuelRow({ vehicleId: 'v1', volume: 10, expenseAmount: 40 }),
        fuelRow({ vehicleId: 'v1', volume: 12, expenseAmount: 48 }),
        fuelRow({ vehicleId: 'v1', volume: 30, fuelType: 'Level 2 (AC)', expenseAmount: 9 }),
        fuelRow({ vehicleId: 'v2', volume: null }),
      ],
      names,
      isFillup,
      (v) => v * 2
    );
    expect(out).toEqual([
      { vehicleId: 'v1', vehicleName: 'Daily Driver', count: 2, volume: 44, cost: 88 },
      { vehicleId: 'v2', vehicleName: 'Weekend Car', count: 1, volume: 16, cost: 30 },
    ]);
  });

  test('charge sessions total separately, in raw energy', () => {
    const out = buildTotalsByVehicle(
      [
        fuelRow({ vehicleId: 'v1', volume: 30, fuelType: 'Level 2 (AC)', expenseAmount: 9 }),
        fuelRow({ vehicleId: 'v1', volume: 10, expenseAmount: 40 }),
      ],
      names,
      isChargeSession
    );
    expect(out).toEqual([
      { vehicleId: 'v1', vehicleName: 'Daily Driver', count: 1, volume: 30, cost: 9 },
    ]);
  });
});

describe('buildGasPriceHistory filtering', () => {
  test('drops rows with no volume, no amount, zero volume, or no date (no NaN/Infinity price)', () => {
    const out = buildGasPriceHistory([
      fuelRow({ volume: null }),
      fuelRow({ volume: 0 }),
      fuelRow({ expenseAmount: 0 }),
      fuelRow({ date: null }),
      fuelRow({ volume: 10, expenseAmount: 50, date: d(2024, 2, 1) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.pricePerVolume).toBeCloseTo(5, 10);
    expect(out.every((r) => Number.isFinite(r.pricePerVolume))).toBe(true);
  });

  test('keeps every entry in the range, so monthly averages see whole months', () => {
    const rows = Array.from({ length: 130 }, (_, i) =>
      fuelRow({ date: d(2024, 1, 1 + (i % 27)), expenseAmount: 40 + i, volume: 10 })
    );
    expect(buildGasPriceHistory(rows)).toHaveLength(130);
  });

  test("each entry's month follows the user's time zone, like the other monthly charts", () => {
    const lateOnJan31InLosAngeles = new Date(Date.UTC(2024, 1, 1, 6));
    const row = fuelRow({ date: lateOnJan31InLosAngeles });
    expect(buildGasPriceHistory([row])[0]?.month).toBe('2024-02');
    const zoned = buildGasPriceHistory(
      [row],
      undefined,
      undefined,
      zonedCalendar('America/Los_Angeles')
    );
    expect(zoned[0]?.month).toBe('2024-01');
  });
});

describe('buildVehicleMaintenanceCosts', () => {
  test('empty input returns []', () => {
    expect(buildVehicleMaintenanceCosts([])).toEqual([]);
  });

  test('counts ONLY maintenance rows — fuel/financial are excluded', () => {
    const out = buildVehicleMaintenanceCosts([
      genRow({ category: 'maintenance', expenseAmount: 200, date: d(2024, 3, 1) }),
      genRow({ category: 'fuel', expenseAmount: 40, date: d(2024, 3, 2) }),
      genRow({ category: 'financial', expenseAmount: 500, date: d(2024, 3, 3) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ month: '2024-03', cost: 200 });
  });

  test('same-month maintenance co-accumulates; ascending month sort; dateless dropped', () => {
    const out = buildVehicleMaintenanceCosts([
      genRow({ category: 'maintenance', expenseAmount: 100, date: d(2024, 5, 10) }),
      genRow({ category: 'maintenance', expenseAmount: 150, date: d(2024, 5, 20) }),
      genRow({ category: 'maintenance', expenseAmount: 75, date: d(2024, 2, 1) }),
      genRow({ category: 'maintenance', expenseAmount: 999, date: null }),
    ]);
    expect(out.map((e) => e.month)).toEqual(['2024-02', '2024-05']);
    expect(out.find((e) => e.month === '2024-05')?.cost).toBe(250);
  });
});

describe('buildMaintenanceTimeline', () => {
  const now = d(2024, 7, 1);
  const names = new Map([
    ['v1', 'Civic'],
    ['v2', 'Camry'],
  ]);

  test('empty input returns []', () => {
    expect(buildMaintenanceTimeline([], now, names)).toEqual([]);
  });

  test('groups by description (case-insensitive) — "Oil Change" and "oil change" are one service', () => {
    const out = buildMaintenanceTimeline(
      [
        genRow({ description: 'Oil Change', date: d(2024, 1, 1) }),
        genRow({ description: 'oil change', date: d(2024, 4, 1) }),
      ],
      now,
      names
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.service).toBe('oil change');
  });

  test('a null description groups under "general maintenance"', () => {
    const out = buildMaintenanceTimeline(
      [genRow({ description: null, date: d(2024, 3, 1) })],
      now,
      names
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.service).toBe('general maintenance');
  });

  test('status is "warning" when the next service is ~10 days out (single-row interval=180)', () => {
    const lastDate = new Date(now.getTime() - 170 * DAY_MS);
    const out = buildMaintenanceTimeline(
      [genRow({ description: 'tires', date: lastDate })],
      now,
      names
    );
    expect(out[0]?.daysRemaining).toBe(10);
    expect(out[0]?.status).toBe('warning');
  });

  test('status is "overdue" when the next service date is in the past (daysRemaining < 0)', () => {
    const lastDate = new Date(now.getTime() - 185 * DAY_MS);
    const out = buildMaintenanceTimeline(
      [genRow({ description: 'brakes', date: lastDate })],
      now,
      names
    );
    expect(out[0]?.daysRemaining).toBe(-5);
    expect(out[0]?.status).toBe('overdue');
  });

  test('status is "good" when the next service is well in the future (>=30 days)', () => {
    const lastDate = new Date(now.getTime() - 120 * DAY_MS);
    const out = buildMaintenanceTimeline(
      [genRow({ description: 'coolant', date: lastDate })],
      now,
      names
    );
    expect(out[0]?.daysRemaining).toBe(60);
    expect(out[0]?.status).toBe('good');
  });

  test('output is sorted by daysRemaining ascending (most-overdue service first)', () => {
    const overdue = new Date(now.getTime() - 200 * DAY_MS);
    const soon = new Date(now.getTime() - 165 * DAY_MS);
    const out = buildMaintenanceTimeline(
      [
        genRow({ description: 'soon-service', date: soon }),
        genRow({ description: 'overdue-service', date: overdue }),
      ],
      now,
      names
    );
    expect(out.map((e) => e.service)).toEqual(['overdue-service', 'soon-service']);
    expect(out[0]?.daysRemaining).toBeLessThan(out[1]?.daysRemaining ?? 0);
  });

  test('the same service on two vehicles is tracked per vehicle, not merged', () => {
    const out = buildMaintenanceTimeline(
      [
        genRow({ vehicleId: 'v1', description: 'Oil change', date: d(2024, 1, 1) }),
        genRow({ vehicleId: 'v1', description: 'Oil change', date: d(2024, 4, 1) }),
        genRow({ vehicleId: 'v2', description: 'Oil change', date: d(2024, 2, 15) }),
      ],
      now,
      names
    );
    expect(out).toHaveLength(2);
    const civic = out.find((e) => e.vehicleId === 'v1');
    const camry = out.find((e) => e.vehicleId === 'v2');
    expect(civic?.vehicleName).toBe('Civic');
    expect(civic?.lastServiceDate).toBe(d(2024, 4, 1).toISOString());
    expect(camry?.vehicleName).toBe('Camry');
    expect(camry?.lastServiceDate).toBe(d(2024, 2, 15).toISOString());
  });
});
