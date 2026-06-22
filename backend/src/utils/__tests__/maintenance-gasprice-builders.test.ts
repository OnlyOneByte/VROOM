/**
 * Characterization tests for the MAINTENANCE + GAS-PRICE chart builder family in analytics-charts.ts
 * (C120 deep-review/guard). Three more zero-coverage builders the C67 (fuel/date) + C119
 * (expense-summary) audits did not reach — `buildGasPriceHistory`, `buildVehicleMaintenanceCosts`,
 * `buildMaintenanceTimeline` (the last drives the private buildTimelineEntry / estimateServiceInterval
 * / assignTimelineStatus trio). Read each against source firsthand and found CORRECT; this locks the
 * conclusion so a future edit can't silently regress it (NORTH_STAR #5). Each test pins an invariant
 * the audit verified:
 *
 *   - buildGasPriceHistory        — keeps only priced fillups (volume>0 ∧ amount>0 ∧ date present),
 *                                    pricePerVolume = amount/volume, fuelType ?? 'Regular', slice(-100).
 *   - buildVehicleMaintenanceCosts— category==='maintenance' ONLY (fuel/financial excluded), month-bucket
 *                                    sum, ascending month sort, dateless dropped.
 *   - buildMaintenanceTimeline    — groups by description (case-insensitive; null→'general maintenance');
 *                                    assignTimelineStatus thresholds (<0 overdue / <30 warning / else good);
 *                                    a single-occurrence group defaults the interval to 180 days; output
 *                                    sorted by daysRemaining ascending (most-overdue first).
 *
 * Pure module → no DB, no server.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildGasPriceHistory,
  buildMaintenanceTimeline,
  buildVehicleMaintenanceCosts,
  type FuelExpenseRow,
  type GeneralExpenseRow,
} from '../analytics-charts';

const DAY_MS = 24 * 60 * 60 * 1000;

// Local-time date so bucketing assertions are timezone-independent (the C6/C11/C67/C119 discipline).
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
    category: 'maintenance',
    description: null,
    expenseAmount: 100,
    date: d(2024, 1, 15),
    mileage: null,
    volume: null,
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

  test('a null fuelType falls back to "Regular"', () => {
    const out = buildGasPriceHistory([fuelRow({ fuelType: null })]);
    expect(out[0]?.fuelType).toBe('Regular');
  });

  test('drops rows with no volume, no amount, zero volume, or no date (no NaN/Infinity price)', () => {
    const out = buildGasPriceHistory([
      fuelRow({ volume: null }), // split sibling — no volume
      fuelRow({ volume: 0 }), // zero volume → would divide-by-zero
      fuelRow({ expenseAmount: 0 }), // free fill → not a price point
      fuelRow({ date: null }), // dateless
      fuelRow({ volume: 10, expenseAmount: 50, date: d(2024, 2, 1) }), // the only kept row
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.pricePerVolume).toBeCloseTo(5, 10);
    expect(out.every((r) => Number.isFinite(r.pricePerVolume))).toBe(true);
  });

  test('caps the output at the last 100 entries', () => {
    const rows = Array.from({ length: 130 }, (_, i) =>
      fuelRow({ date: d(2024, 1, 1 + (i % 27)), expenseAmount: 40 + i, volume: 10 })
    );
    expect(buildGasPriceHistory(rows)).toHaveLength(100);
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

  test('empty input returns []', () => {
    expect(buildMaintenanceTimeline([], now)).toEqual([]);
  });

  test('groups by description (case-insensitive) — "Oil Change" and "oil change" are one service', () => {
    const out = buildMaintenanceTimeline(
      [
        genRow({ description: 'Oil Change', date: d(2024, 1, 1) }),
        genRow({ description: 'oil change', date: d(2024, 4, 1) }),
      ],
      now
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.service).toBe('oil change');
  });

  test('a null description groups under "general maintenance"', () => {
    const out = buildMaintenanceTimeline([genRow({ description: null, date: d(2024, 3, 1) })], now);
    expect(out).toHaveLength(1);
    expect(out[0]?.service).toBe('general maintenance');
  });

  // A single-occurrence group defaults the interval to 180 days, so daysRemaining ≈
  // (lastDate - now)/day + 180. We anchor lastDate relative to `now` to drive each status.
  test('status is "warning" when the next service is ~10 days out (single-row interval=180)', () => {
    const lastDate = new Date(now.getTime() - 170 * DAY_MS); // nextDue ≈ now + 10d
    const out = buildMaintenanceTimeline([genRow({ description: 'tires', date: lastDate })], now);
    expect(out[0]?.daysRemaining).toBe(10);
    expect(out[0]?.status).toBe('warning');
  });

  test('status is "overdue" when the next service date is in the past (daysRemaining < 0)', () => {
    const lastDate = new Date(now.getTime() - 185 * DAY_MS); // nextDue ≈ now - 5d
    const out = buildMaintenanceTimeline([genRow({ description: 'brakes', date: lastDate })], now);
    expect(out[0]?.daysRemaining).toBe(-5);
    expect(out[0]?.status).toBe('overdue');
  });

  test('status is "good" when the next service is well in the future (>=30 days)', () => {
    const lastDate = new Date(now.getTime() - 120 * DAY_MS); // nextDue ≈ now + 60d
    const out = buildMaintenanceTimeline([genRow({ description: 'coolant', date: lastDate })], now);
    expect(out[0]?.daysRemaining).toBe(60);
    expect(out[0]?.status).toBe('good');
  });

  test('output is sorted by daysRemaining ascending (most-overdue service first)', () => {
    const overdue = new Date(now.getTime() - 200 * DAY_MS); // ≈ -20d
    const soon = new Date(now.getTime() - 165 * DAY_MS); // ≈ +15d
    const out = buildMaintenanceTimeline(
      [
        genRow({ description: 'soon-service', date: soon }),
        genRow({ description: 'overdue-service', date: overdue }),
      ],
      now
    );
    expect(out.map((e) => e.service)).toEqual(['overdue-service', 'soon-service']);
    expect(out[0]?.daysRemaining).toBeLessThan(out[1]?.daysRemaining ?? 0);
  });
});
