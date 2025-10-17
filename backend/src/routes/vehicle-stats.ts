import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError } from '../lib/errors';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';

const vehicleStats = new Hono();

// Validation schemas
const vehicleParamsSchema = z.object({
  id: z.string().min(1, 'Vehicle ID is required'),
});

const statsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('all'),
});

// Apply authentication to all routes
vehicleStats.use('*', requireAuth);

// GET /api/vehicles/:id/stats - Get vehicle statistics
vehicleStats.get(
  '/:id/stats',
  zValidator('param', vehicleParamsSchema),
  zValidator('query', statsQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { period } = c.req.valid('query');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const expenseRepository = repositoryFactory.getExpenseRepository();

    // Verify vehicle exists and belongs to user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, id);
    if (!vehicle) {
      throw new NotFoundError('Vehicle');
    }

    // Get all fuel expenses for this vehicle
    const fuelExpenses = await expenseRepository.findByCategory(id, 'fuel');

    // Filter by time period
    const now = new Date();
    let startDate: Date | null = null;

    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = null;
        break;
    }

    const filteredFuelExpenses = startDate
      ? fuelExpenses.filter((e) => new Date(e.date) >= startDate)
      : fuelExpenses;

    // Sort by date ascending for calculations
    const sortedExpenses = [...filteredFuelExpenses].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Calculate statistics
    const stats = calculateVehicleStats(sortedExpenses, vehicle.initialMileage || 0);

    return c.json({
      success: true,
      data: {
        period,
        ...stats,
      },
    });
  }
);

interface FuelExpense {
  id: string;
  mileage: number | null;
  volume: number | null;
  charge: number | null;
  date: Date;
  amount: number;
}

interface VehicleStats {
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

function calculateVehicleStats(fuelExpenses: FuelExpense[], initialMileage: number): VehicleStats {
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
  stats.totalFuelConsumed = totals.volume;
  stats.totalChargeConsumed = totals.charge;
  stats.totalFuelCost = totals.cost;

  // Get expenses with mileage data
  const expensesWithMileage = fuelExpenses.filter(
    (e) => e.mileage !== null && e.mileage !== undefined
  );

  if (expensesWithMileage.length > 0) {
    calculateMileageStats(stats, expensesWithMileage, initialMileage, totals.cost);
  }

  // Calculate efficiency metrics
  if (totals.volume > 0 && expensesWithMileage.length >= 2) {
    stats.averageMpg = calculateAverageMpg(expensesWithMileage);
  }

  if (totals.charge > 0 && expensesWithMileage.length >= 2) {
    stats.averageMilesPerKwh = calculateAverageMilesPerKwh(expensesWithMileage);
  }

  return stats;
}

function calculateTotals(expenses: FuelExpense[]): {
  volume: number;
  charge: number;
  cost: number;
} {
  let volume = 0;
  let charge = 0;
  let cost = 0;

  for (const expense of expenses) {
    if (expense.volume) {
      volume += expense.volume;
    }
    if (expense.charge) {
      charge += expense.charge;
    }
    cost += expense.amount;
  }

  return { volume, charge, cost };
}

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

function calculateAverageMpg(expensesWithMileage: FuelExpense[]): number | null {
  const mpgValues: number[] = [];

  for (let i = 1; i < expensesWithMileage.length; i++) {
    const current = expensesWithMileage[i];
    const previous = expensesWithMileage[i - 1];

    if (current.mileage && previous.mileage && current.volume) {
      const milesDriven = current.mileage - previous.mileage;
      const mpg = milesDriven / current.volume;

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

function calculateAverageMilesPerKwh(expensesWithMileage: FuelExpense[]): number | null {
  const efficiencyValues: number[] = [];

  for (let i = 1; i < expensesWithMileage.length; i++) {
    const current = expensesWithMileage[i];
    const previous = expensesWithMileage[i - 1];

    if (current.mileage && previous.mileage && current.charge) {
      const milesDriven = current.mileage - previous.mileage;
      const milesPerKwh = milesDriven / current.charge;

      // Filter out unrealistic values (typically 2-5 mi/kWh for EVs)
      if (milesPerKwh > 0 && milesPerKwh < 20) {
        efficiencyValues.push(milesPerKwh);
      }
    }
  }

  if (efficiencyValues.length > 0) {
    return efficiencyValues.reduce((sum, eff) => sum + eff, 0) / efficiencyValues.length;
  }

  return null;
}

export { vehicleStats };
