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
  fuelAmount: number | null;
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

    if (current.mileage && previous.mileage && current.fuelAmount) {
      const miles = current.mileage - previous.mileage;
      const mpg = calculateMPG(miles, current.fuelAmount);

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

    if (current.mileage && previous.mileage && current.fuelAmount) {
      const miles = current.mileage - previous.mileage;
      const milesPerKwh = calculateMilesPerKwh(miles, current.fuelAmount);

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
