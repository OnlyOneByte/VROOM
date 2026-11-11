import { isElectricFuelType } from '../db/types';
import { averageConsecutiveMpg, calculateAverageMilesPerKwh, maxOf } from './calculations';

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

// Gas and charge expenses are split by fuel type. Efficiency is computed only for the groups the
// tracking flags enable.
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

  const fuelGroup: FuelExpense[] = [];
  const chargeGroup: FuelExpense[] = [];

  for (const expense of fuelExpenses) {
    if (isElectricFuelType(expense.fuelType)) {
      chargeGroup.push(expense);
    } else {
      fuelGroup.push(expense);
    }
  }

  stats.totalFuelConsumed = sumVolume(fuelGroup);
  stats.totalChargeConsumed = sumVolume(chargeGroup);
  stats.totalFuelCost = fuelGroup.reduce((sum, e) => sum + e.expenseAmount, 0);
  stats.totalChargeCost = chargeGroup.reduce((sum, e) => sum + e.expenseAmount, 0);
  stats.fuelExpenseCount = fuelGroup.length;
  stats.chargeExpenseCount = chargeGroup.length;

  const expensesWithMileage = fuelExpenses.filter(
    (e) => e.mileage !== null && e.mileage !== undefined
  );

  const totalEnergyCost = stats.totalFuelCost + stats.totalChargeCost;

  if (expensesWithMileage.length > 0) {
    calculateMileageStats(stats, expensesWithMileage, initialMileage, totalEnergyCost);
  }

  if (trackFuel) {
    const fuelWithMileage = fuelGroup.filter((e) => e.mileage !== null && e.mileage !== undefined);
    if (stats.totalFuelConsumed > 0 && fuelWithMileage.length >= 2) {
      stats.averageMpg = calculateAverageMpg(fuelWithMileage);
    }
  }

  if (trackCharging) {
    stats.averageMilesPerKwh = calculateAverageMilesPerKwh(chargeGroup);
  }

  return stats;
}

function sumVolume(expenses: FuelExpense[]): number {
  let total = 0;
  for (const expense of expenses) {
    if (expense.volume) {
      total += expense.volume;
    }
  }
  return total;
}

function calculateMileageStats(
  stats: VehicleStats,
  expensesWithMileage: FuelExpense[],
  initialMileage: number,
  totalCost: number
): void {
  const mileages = expensesWithMileage.map((e) => e.mileage as number);
  const latestMileage = maxOf(mileages);
  stats.currentMileage = latestMileage;
  // Clamped at 0: a mistyped odometer reading below the initial mileage must not yield negative
  // distance.
  stats.totalMileage = Math.max(0, latestMileage - initialMileage);

  if (stats.totalMileage > 0) {
    stats.costPerMile = totalCost / stats.totalMileage;
  }
}

// Pairs consecutive fill-ups, so the input must be chronological. Sorting a copy keeps the helper
// correct for any caller.
function calculateAverageMpg(unorderedExpenses: FuelExpense[]): number | null {
  const sorted = [...unorderedExpenses].sort((a, b) => a.date.getTime() - b.date.getTime());
  return averageConsecutiveMpg(sorted);
}
