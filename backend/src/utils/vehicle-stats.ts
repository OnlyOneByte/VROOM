/**
 * Vehicle Statistics Calculations
 *
 * Extracted from vehicles/routes.ts to make these calculations reusable
 * across different endpoints and reduce route handler complexity.
 */

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
  costPerMile: number | null;
  fuelExpenseCount: number;
}

/**
 * Calculate comprehensive vehicle statistics from fuel expenses
 */
export function calculateVehicleStats(
  fuelExpenses: FuelExpense[],
  initialMileage: number
): VehicleStats {
  const stats: VehicleStats = {
    totalMileage: 0,
    currentMileage: null,
    totalFuelConsumed: 0,
    totalChargeConsumed: 0,
    averageMpg: null,
    averageMilesPerKwh: null,
    totalFuelCost: 0,
    costPerMile: null,
    fuelExpenseCount: fuelExpenses.length,
  };

  if (fuelExpenses.length === 0) {
    return stats;
  }

  // Calculate totals
  const totals = calculateTotals(fuelExpenses);
  stats.totalFuelConsumed = totals.fuelAmount;
  stats.totalChargeConsumed = 0; // Deprecated - keeping for backward compatibility
  stats.totalFuelCost = totals.cost;

  // Get expenses with mileage data
  const expensesWithMileage = fuelExpenses.filter(
    (e) => e.mileage !== null && e.mileage !== undefined
  );

  if (expensesWithMileage.length > 0) {
    calculateMileageStats(stats, expensesWithMileage, initialMileage, totals.cost);
  }

  // Calculate efficiency metrics
  if (totals.fuelAmount > 0 && expensesWithMileage.length >= 2) {
    stats.averageMpg = calculateAverageMpg(expensesWithMileage);
  }

  return stats;
}

/**
 * Calculate total fuel amount and cost from expenses
 */
function calculateTotals(expenses: FuelExpense[]): {
  fuelAmount: number;
  cost: number;
} {
  let fuelAmount = 0;
  let cost = 0;

  for (const expense of expenses) {
    if (expense.fuelAmount) {
      fuelAmount += expense.fuelAmount;
    }
    cost += expense.expenseAmount;
  }

  return { fuelAmount, cost };
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
