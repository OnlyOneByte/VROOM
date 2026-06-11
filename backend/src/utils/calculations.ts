/**
 * Shared Calculation Utilities
 *
 * Pure functions for common calculations used across the application.
 * These functions are extracted from analytics services to avoid duplication.
 */

import type { Expense } from '../db/schema';

/**
 * Minimal shape required by efficiency calculations.
 * Both Expense (full DB row) and FuelExpense (lightweight stats type) satisfy this.
 */
interface EfficiencyExpense {
  mileage: number | null;
  volume: number | null;
  missedFillup: boolean;
  date: Date | string;
}

// ============================================================================
// FUEL EFFICIENCY CALCULATIONS
// ============================================================================

/**
 * Calculate MPG (Miles Per Gallon) from miles driven and fuel consumed
 */
export function calculateMPG(miles: number, fuel: number): number {
  return fuel > 0 ? miles / fuel : 0;
}

/**
 * Calculate average MPG from a series of fuel expenses
 * Uses consecutive mileage readings to determine miles driven between fill-ups
 */
export function calculateAverageMPG(fuelExpenses: Expense[]): number | null {
  if (fuelExpenses.length < 2) {
    return null;
  }

  // Sort by date to ensure chronological order
  const sortedExpenses = [...fuelExpenses].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const mpgValues: number[] = [];

  for (let i = 1; i < sortedExpenses.length; i++) {
    const current = sortedExpenses[i];
    const previous = sortedExpenses[i - 1];

    // Skip pairs affected by missed fill-ups
    if (current.missedFillup || previous.missedFillup) {
      continue;
    }

    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = calculateMPG(miles, current.volume);

      // Filter out unrealistic values (negative miles or extremely high/low MPG)
      if (mpg > 0 && mpg < 150) {
        mpgValues.push(mpg);
      }
    }
  }

  if (mpgValues.length === 0) {
    return null;
  }

  const sum = mpgValues.reduce((acc, mpg) => acc + mpg, 0);
  return sum / mpgValues.length;
}

/**
 * Calculate mi/kWh (Miles Per Kilowatt-Hour) from miles driven and energy consumed
 */
export function calculateMilesPerKwh(miles: number, kwh: number): number {
  return kwh > 0 ? miles / kwh : 0;
}

/**
 * Calculate average mi/kWh from a series of charge expenses
 * Uses consecutive mileage readings to determine miles driven between charges
 */
export function calculateAverageMilesPerKwh(chargeExpenses: EfficiencyExpense[]): number | null {
  if (chargeExpenses.length < 2) {
    return null;
  }

  // Sort by date to ensure chronological order
  const sortedExpenses = [...chargeExpenses].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Need at least 2 expenses with mileage data
  const withMileage = sortedExpenses.filter((e) => e.mileage != null);
  if (withMileage.length < 2) {
    return null;
  }

  const milesPerKwhValues: number[] = [];

  for (let i = 1; i < sortedExpenses.length; i++) {
    const current = sortedExpenses[i];
    const previous = sortedExpenses[i - 1];

    // Skip pairs affected by missed fill-ups
    if (current.missedFillup || previous.missedFillup) {
      continue;
    }

    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const milesPerKwh = calculateMilesPerKwh(miles, current.volume);

      // Filter out unrealistic values (negative miles or > 10 mi/kWh)
      if (milesPerKwh > 0 && milesPerKwh < 10) {
        milesPerKwhValues.push(milesPerKwh);
      }
    }
  }

  if (milesPerKwhValues.length === 0) {
    return null;
  }

  const sum = milesPerKwhValues.reduce((acc, val) => acc + val, 0);
  return sum / milesPerKwhValues.length;
}

// ============================================================================
// STATS PERIOD
// ============================================================================

/** The fixed stats-period selector shared by GET /vehicles/:id/stats and the expenses repository. */
export type StatsPeriod = '7d' | '30d' | '90d' | '1y' | 'all';

const PERIOD_DAYS: Record<Exclude<StatsPeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

/**
 * Start-of-window Date for a stats period, or null for 'all' (no lower bound). This was the
 * identical day-offset switch duplicated in vehicles/routes.ts and expenses/repository.ts;
 * extracted here so the window is one source of truth. 'all' → null (the caller applies no
 * date filter); each bounded period → now − N days. A caller that needs an epoch sentinel
 * instead of null for an out-of-range value can `?? new Date(0)` at the call site.
 */
export function getPeriodStartDate(period: StatsPeriod, now: Date = new Date()): Date | null {
  if (period === 'all') return null;
  return new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
}

// ============================================================================
// QUERY-PARAM PARSING
// ============================================================================

/**
 * Parse a raw query-string value to a bounded integer, falling back when it isn't finite.
 *
 * The `Number.parseInt(raw ?? String(fallback), 10)` + `Number.isFinite(x) ? clamp : fallback`
 * idiom was hand-rolled twice in the SAME handler (insurance /expiring-soon `days` and `limit`) —
 * and that copy-paste is exactly how #70 happened: `limit` carried the finite-guard, `days` was
 * written without it, so a non-numeric `?days=` became NaN → an Invalid Date → a silently-empty
 * result. One source of truth so the guard can't be present on one param and forgotten on its
 * sibling. NaN/missing/non-numeric → `fallback`; otherwise clamped to `[min, max]`.
 */
export function parseClampedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}
