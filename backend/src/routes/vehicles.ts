import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { vehicles as vehiclesTable } from '../db/schema';
import { VALIDATION_LIMITS } from '../lib/constants';
import { ConflictError, NotFoundError } from '../lib/core/errors';
import { requireAuth } from '../lib/middleware/auth';
import { trackDataChanges } from '../lib/middleware/change-tracker';
import { expenseRepository, financingRepository, vehicleRepository } from '../lib/repositories';
import { commonSchemas } from '../lib/utils/validation';
import type { ApiResponse } from '../types/api';

const vehicles = new Hono();

// Validation schemas derived from db schema
const baseVehicleSchema = createInsertSchema(vehiclesTable, {
  make: z
    .string()
    .min(1, 'Make is required')
    .max(
      VALIDATION_LIMITS.VEHICLE.MAKE_MAX_LENGTH,
      `Make must be ${VALIDATION_LIMITS.VEHICLE.MAKE_MAX_LENGTH} characters or less`
    ),
  model: z
    .string()
    .min(1, 'Model is required')
    .max(
      VALIDATION_LIMITS.VEHICLE.MODEL_MAX_LENGTH,
      `Model must be ${VALIDATION_LIMITS.VEHICLE.MODEL_MAX_LENGTH} characters or less`
    ),
  year: z
    .number()
    .int()
    .min(
      VALIDATION_LIMITS.VEHICLE.MIN_YEAR,
      `Year must be ${VALIDATION_LIMITS.VEHICLE.MIN_YEAR} or later`
    )
    .max(new Date().getFullYear() + 1, 'Year cannot be in the future'),
  licensePlate: z
    .string()
    .max(
      VALIDATION_LIMITS.VEHICLE.LICENSE_PLATE_MAX_LENGTH,
      `License plate must be ${VALIDATION_LIMITS.VEHICLE.LICENSE_PLATE_MAX_LENGTH} characters or less`
    )
    .optional(),
  nickname: z
    .string()
    .max(
      VALIDATION_LIMITS.VEHICLE.NICKNAME_MAX_LENGTH,
      `Nickname must be ${VALIDATION_LIMITS.VEHICLE.NICKNAME_MAX_LENGTH} characters or less`
    )
    .optional(),
  initialMileage: z.number().int().min(0, 'Initial mileage cannot be negative').optional(),
  purchasePrice: z.number().min(0, 'Purchase price cannot be negative').optional(),
  purchaseDate: z.coerce.date().optional(),
});

// Omit auto-generated fields for create/update
const createVehicleSchema = baseVehicleSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

const updateVehicleSchema = createVehicleSchema.partial();

// Apply authentication and change tracking to all routes
vehicles.use('*', requireAuth);
vehicles.use('*', trackDataChanges);

// GET /api/vehicles - List user's vehicles (including shared)
vehicles.get('/', async (c) => {
  const user = c.get('user');

  const userVehicles = await vehicleRepository.findAccessibleVehicles(user.id);

  const response: ApiResponse<typeof userVehicles> = {
    success: true,
    data: userVehicles,
    message: `Found ${userVehicles.length} vehicle${userVehicles.length !== 1 ? 's' : ''}`,
  };

  return c.json(response);
});

// POST /api/vehicles - Create new vehicle
vehicles.post('/', zValidator('json', createVehicleSchema), async (c) => {
  const user = c.get('user');
  const vehicleData = c.req.valid('json');

  // Check if license plate already exists (if provided)
  if (vehicleData.licensePlate) {
    const existingVehicle = await vehicleRepository.findByLicensePlate(vehicleData.licensePlate);
    if (existingVehicle) {
      throw new ConflictError('A vehicle with this license plate already exists');
    }
  }

  const createdVehicle = await vehicleRepository.create({
    ...vehicleData,
    userId: user.id,
  });

  const response: ApiResponse<typeof createdVehicle> = {
    success: true,
    data: createdVehicle,
    message: 'Vehicle created successfully',
  };

  return c.json(response, 201);
});

// GET /api/vehicles/:id - Get specific vehicle (with shared access)
vehicles.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const vehicle = await vehicleRepository.findByIdWithAccess(id, user.id);

  if (!vehicle) {
    throw new NotFoundError('Vehicle');
  }

  const response: ApiResponse<typeof vehicle> = {
    success: true,
    data: vehicle,
  };

  return c.json(response);
});

// PUT /api/vehicles/:id - Update vehicle (with shared access check)
vehicles.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateVehicleSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const updateData = c.req.valid('json');

    // Check if vehicle exists and user has access
    const existingVehicle = await vehicleRepository.findByIdWithAccess(id, user.id);
    if (!existingVehicle) {
      throw new NotFoundError('Vehicle');
    }

    // Check if license plate already exists (if being updated)
    if (updateData.licensePlate && updateData.licensePlate !== existingVehicle.licensePlate) {
      const vehicleWithPlate = await vehicleRepository.findByLicensePlate(updateData.licensePlate);
      if (vehicleWithPlate && vehicleWithPlate.id !== id) {
        throw new ConflictError('A vehicle with this license plate already exists');
      }
    }

    const updatedVehicle = await vehicleRepository.update(id, updateData);

    return c.json({
      success: true,
      data: updatedVehicle,
      message: 'Vehicle updated successfully',
    });
  }
);

// DELETE /api/vehicles/:id - Delete vehicle
vehicles.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // Check if vehicle exists and belongs to user
  const existingVehicle = await vehicleRepository.findByUserIdAndId(user.id, id);
  if (!existingVehicle) {
    throw new NotFoundError('Vehicle');
  }

  await vehicleRepository.delete(id);

  return c.json({
    success: true,
    message: 'Vehicle deleted successfully',
  });
});

// GET /api/vehicles/:id/financing/payments - Get payment history for vehicle financing
vehicles.get('/:id/financing/payments', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // Check if vehicle exists and user has access
  const vehicle = await vehicleRepository.findByIdWithAccess(id, user.id);
  if (!vehicle) {
    throw new NotFoundError('Vehicle');
  }

  // Get financing for the vehicle
  const financing = await financingRepository.findByVehicleId(id);
  if (!financing) {
    // No financing exists, return empty array
    return c.json({
      success: true,
      data: [],
      count: 0,
      message: 'No financing found for this vehicle',
    });
  }

  // Get all payments for the financing, sorted by date descending
  const payments = await financingRepository.findPaymentsByFinancingId(financing.id);

  return c.json({
    success: true,
    data: payments,
    count: payments.length,
  });
});

// Validation schema for stats
const statsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('all'),
});

// GET /api/vehicles/:id/stats - Get vehicle statistics
vehicles.get(
  '/:id/stats',
  zValidator('param', commonSchemas.idParam),
  zValidator('query', statsQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { period } = c.req.valid('query');

    // Verify vehicle exists and belongs to user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, id);
    if (!vehicle) {
      throw new NotFoundError('Vehicle');
    }

    // Get all fuel expenses for this vehicle
    const fuelExpenses = await expenseRepository.find({ vehicleId: id, category: 'fuel' });

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
      ? fuelExpenses.filter((e) => new Date(e.date) >= (startDate as Date))
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

// Helper types and functions for vehicle stats
interface FuelExpense {
  id: string;
  mileage: number | null;
  fuelAmount: number | null;
  fuelType: string | null;
  date: Date;
  expenseAmount: number;
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

export { vehicles };
