/**
 * Vehicle Statistics Calculations
 *
 * Extracted from vehicles/routes.ts to make these calculations reusable
 * across different endpoints and reduce route handler complexity.
 */

import { isElectricFuelType } from '../db/types';
import { averageConsecutiveMpg, calculateAverageMilesPerKwh, maxOf } from './calculations';

// Helper types for vehicle stats calculations
export interface FuelExpense {
  id: string;
  mileage: number | null;
  volume: number | null;
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
  stats.totalFuelConsumed = sumVolume(fuelGroup);
  stats.totalChargeConsumed = sumVolume(chargeGroup);
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
 * Sum volume values for a group of expenses
 */
function sumVolume(expenses: FuelExpense[]): number {
  let total = 0;
  for (const expense of expenses) {
    if (expense.volume) {
      total += expense.volume;
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
  const latestMileage = maxOf(mileages);
  stats.currentMileage = latestMileage;
  // Distance driven can never be negative. A backdated/mistyped reading BELOW initialMileage (or the
  // only in-window reading being lower than the purchase odometer) would otherwise surface a negative
  // totalMileage verbatim (#46). Clamp at 0 — correct under ANY stats-period windowing (the separate
  // #45 decision), since a driven distance is non-negative regardless of the window's numerator scope.
  stats.totalMileage = Math.max(0, latestMileage - initialMileage);

  if (stats.totalMileage > 0) {
    stats.costPerMile = totalCost / stats.totalMileage;
  }
}

/**
 * Calculate average miles per gallon from sequential fuel expenses.
 *
 * Pairs CONSECUTIVE fillups (current − previous) for the per-segment distance, so the input MUST be
 * in chronological order. The sole production caller (vehicles/routes.ts) already sorts by date, but a
 * pairwise odometer-delta is silently WRONG on unordered rows (negative deltas dropped by the mpg>0
 * filter, but valid out-of-order segments mis-paired) — so sort defensively here too (#75). The sort
 * is on a copy + idempotent for already-sorted input, so it's behavior-preserving for today's caller
 * while making the helper correct for any future consumer that forgets to pre-sort.
 */
function calculateAverageMpg(unorderedExpenses: FuelExpense[]): number | null {
  // Defensive inline date sort (#75: the helper requires chronological order for correct pairwise
  // odometer deltas), then run the SHARED consecutive-pair MPG average (C17 dedup — the same loop +
  // missedFillup skip + (0,150) band that calculateAverageMPG uses; C161 proved hand-copies drift).
  const sorted = [...unorderedExpenses].sort((a, b) => a.date.getTime() - b.date.getTime());
  return averageConsecutiveMpg(sorted);
}
