/**
 * Vehicle Statistics Calculations
 *
 * Extracted from vehicles/routes.ts to make these calculations reusable
 * across different endpoints and reduce route handler complexity.
 */

import { isElectricFuelType } from '../db/types';
import { calculateAverageMilesPerKwh } from './calculations';

// Helper types for vehicle stats calculations
export interface FuelExpense {
  id: string;
  mileage: number | null;
  fuelAmount: number | null;
  fuelType: string | null;
  date: Date;
  expenseAmount: number;
  missedFillup: boolean;
}

export interface VehicleStats {
  totalMileage: number;
  currentMileage: number | null;
  totalFuelConsumed: number;
  totalChargeConsumed: number;
  averageMpg: number | null;
  averageMilesPerKwh: number | null;
  totalFuelCost: number;
  totalChargeCost: number;
  costPerMile: number | null;
  fuelExpenseCount: number;
  chargeExpenseCount: number;
}

/**
 * Calculate comprehensive vehicle statistics from fuel expenses.
 *
 * Splits expenses into fuel-group and charge-group using isElectricFuelType,
 * then computes efficiency metrics gated by the tracking flags.
 */
export function calculateVehicleStats(
  fuelExpenses: FuelExpense[],
  initialMileage: number,
  trackFuel = true,
  trackCharging = false
): VehicleStats {
  const stats: VehicleStats = {
    totalMileage: 0,
    currentMileage: null,
    totalFuelConsumed: 0,
    totalChargeConsumed: 0,
    averageMpg: null,
    averageMilesPerKwh: null,
    totalFuelCost: 0,
    totalChargeCost: 0,
    costPerMile: null,
    fuelExpenseCount: 0,
    chargeExpenseCount: 0,
  };

  if (fuelExpenses.length === 0) {
    return stats;
  }

  // Split expenses into fuel-group and charge-group by fuelType
  const fuelGroup: FuelExpense[] = [];
  const chargeGroup: FuelExpense[] = [];

  for (const expense of fuelExpenses) {
    if (isElectricFuelType(expense.fuelType)) {
      chargeGroup.push(expense);
    } else {
      fuelGroup.push(expense);
    }
  }

  // Calculate totals split by group
  stats.totalFuelConsumed = sumFuelAmount(fuelGroup);
  stats.totalChargeConsumed = sumFuelAmount(chargeGroup);
  stats.totalFuelCost = fuelGroup.reduce((sum, e) => sum + e.expenseAmount, 0);
  stats.totalChargeCost = chargeGroup.reduce((sum, e) => sum + e.expenseAmount, 0);
  stats.fuelExpenseCount = fuelGroup.length;
  stats.chargeExpenseCount = chargeGroup.length;

  // Get all expenses with mileage data (for mileage stats)
  const expensesWithMileage = fuelExpenses.filter(
    (e) => e.mileage !== null && e.mileage !== undefined
  );

  const totalEnergyCost = stats.totalFuelCost + stats.totalChargeCost;

  if (expensesWithMileage.length > 0) {
    calculateMileageStats(stats, expensesWithMileage, initialMileage, totalEnergyCost);
  }

  // Calculate fuel efficiency (MPG) — gated by trackFuel
  if (trackFuel) {
    const fuelWithMileage = fuelGroup.filter((e) => e.mileage !== null && e.mileage !== undefined);
    if (stats.totalFuelConsumed > 0 && fuelWithMileage.length >= 2) {
      stats.averageMpg = calculateAverageMpg(fuelWithMileage);
    }
  }

  // Calculate electric efficiency (mi/kWh) — gated by trackCharging
  if (trackCharging) {
    stats.averageMilesPerKwh = calculateAverageMilesPerKwh(chargeGroup);
  }

  return stats;
}

/**
 * Sum fuelAmount values for a group of expenses
 */
function sumFuelAmount(expenses: FuelExpense[]): number {
  let total = 0;
  for (const expense of expenses) {
    if (expense.fuelAmount) {
      total += expense.fuelAmount;
    }
  }
  return total;
}

/**
 * Calculate mileage-related statistics
 */
function calculateMileageStats(
  stats: VehicleStats,
  expensesWithMileage: FuelExpense[],
  initialMileage: number,
  totalCost: number
): void {
  const mileages = expensesWithMileage.map((e) => e.mileage as number);
  const latestMileage = Math.max(...mileages);
  stats.currentMileage = latestMileage;
  stats.totalMileage = latestMileage - initialMileage;

  if (stats.totalMileage > 0) {
    stats.costPerMile = totalCost / stats.totalMileage;
  }
}

/**
 * Calculate average miles per gallon from sequential fuel expenses
 */
function calculateAverageMpg(expensesWithMileage: FuelExpense[]): number | null {
  const mpgValues: number[] = [];

  for (let i = 1; i < expensesWithMileage.length; i++) {
    const current = expensesWithMileage[i];
    const previous = expensesWithMileage[i - 1];

    // Skip pairs affected by missed fill-ups
    if (current.missedFillup || previous.missedFillup) {
      continue;
    }

    if (current.mileage && previous.mileage && current.fuelAmount) {
      const milesDriven = current.mileage - previous.mileage;
      const mpg = milesDriven / current.fuelAmount;

      // Filter out unrealistic values (likely data errors)
      if (mpg > 0 && mpg < 150) {
        mpgValues.push(mpg);
      }
    }
  }

  if (mpgValues.length > 0) {
    return mpgValues.reduce((sum, mpg) => sum + mpg, 0) / mpgValues.length;
  }

  return null;
}
