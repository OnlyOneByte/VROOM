import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { vehicles as vehiclesTable } from '../../db/schema';
import type { ApiResponse } from '../../errors';
import { ConflictError, NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { ChargeUnit, DistanceUnit, type UnitPreferences, VolumeUnit } from '../../types';
import { commonSchemas } from '../../utils/validation';
import { calculateVehicleStats } from '../../utils/vehicle-stats';
import { expenseRepository } from '../expenses/repository';
import { deleteAllPhotosForEntity } from '../photos/photo-service';
import { preferencesRepository } from '../settings/repository';
import { photoRoutes } from './photo-routes';
import { vehicleRepository } from './repository';

const routes = new Hono();

// Zod schema for unitPreferences enum validation
const unitPreferencesSchema = z.object({
  distanceUnit: z.enum(DistanceUnit, {
    message: "Invalid distanceUnit: must be 'miles' or 'kilometers'",
  }),
  volumeUnit: z.enum(VolumeUnit, {
    message: "Invalid volumeUnit: must be 'gallons_us', 'gallons_uk', or 'liters'",
  }),
  chargeUnit: z.enum(ChargeUnit, {
    message: "Invalid chargeUnit: must be 'kwh'",
  }),
});

// Partial version for update (each field optional)
const partialUnitPreferencesSchema = unitPreferencesSchema.partial();

// Validation schemas derived from db schema
const baseVehicleSchema = createInsertSchema(vehiclesTable, {
  make: z
    .string()
    .min(1, 'Make is required')
    .max(
      CONFIG.validation.vehicle.makeMaxLength,
      `Make must be ${CONFIG.validation.vehicle.makeMaxLength} characters or less`
    ),
  model: z
    .string()
    .min(1, 'Model is required')
    .max(
      CONFIG.validation.vehicle.modelMaxLength,
      `Model must be ${CONFIG.validation.vehicle.modelMaxLength} characters or less`
    ),
  year: z
    .number()
    .int()
    .min(
      CONFIG.validation.vehicle.minYear,
      `Year must be ${CONFIG.validation.vehicle.minYear} or later`
    )
    .max(new Date().getFullYear() + 1, 'Year cannot be in the future'),
  licensePlate: z
    .string()
    .max(
      CONFIG.validation.vehicle.licensePlateMaxLength,
      `License plate must be ${CONFIG.validation.vehicle.licensePlateMaxLength} characters or less`
    )
    .optional(),
  nickname: z
    .string()
    .max(
      CONFIG.validation.vehicle.nicknameMaxLength,
      `Nickname must be ${CONFIG.validation.vehicle.nicknameMaxLength} characters or less`
    )
    .optional(),
  initialMileage: z.number().int().min(0, 'Initial mileage cannot be negative').optional(),
  purchasePrice: z.number().min(0, 'Purchase price cannot be negative').optional(),
  purchaseDate: z.coerce.date().optional(),
});

// Omit auto-generated fields for create/update
const createVehicleSchema = baseVehicleSchema
  .omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
    unitPreferences: true,
  })
  .extend({
    unitPreferences: unitPreferencesSchema.optional(),
  });

const updateVehicleSchema = baseVehicleSchema
  .omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
    unitPreferences: true,
  })
  .extend({
    unitPreferences: partialUnitPreferencesSchema.optional(),
  })
  .partial();

// Apply authentication and change tracking to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// Mount photo sub-router
routes.route('/:vehicleId/photos', photoRoutes);

// GET /api/vehicles - List user's vehicles (including shared)
routes.get('/', async (c) => {
  const user = c.get('user');

  const userVehicles = await vehicleRepository.findByUserId(user.id);

  const response: ApiResponse<typeof userVehicles> = {
    success: true,
    data: userVehicles,
    message: `Found ${userVehicles.length} vehicle${userVehicles.length !== 1 ? 's' : ''}`,
  };

  return c.json(response);
});

// POST /api/vehicles - Create new vehicle
routes.post('/', zValidator('json', createVehicleSchema), async (c) => {
  const user = c.get('user');
  const vehicleData = c.req.valid('json');

  // Check if license plate already exists (if provided)
  if (vehicleData.licensePlate) {
    const existingVehicle = await vehicleRepository.findByLicensePlate(vehicleData.licensePlate);
    if (existingVehicle) {
      throw new ConflictError('A vehicle with this license plate already exists');
    }
  }

  // Default unitPreferences from user's settings if not provided
  let { unitPreferences } = vehicleData;
  if (!unitPreferences) {
    const userSettings = await preferencesRepository.getOrCreate(user.id);
    unitPreferences = userSettings.unitPreferences;
  }

  const createdVehicle = await vehicleRepository.create({
    ...vehicleData,
    unitPreferences,
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
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
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
routes.put(
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

    // Merge partial unitPreferences with existing values
    const { unitPreferences: partialUnitPrefs, ...restUpdateData } = updateData;
    const mergedUnitPreferences: UnitPreferences | undefined = partialUnitPrefs
      ? { ...existingVehicle.unitPreferences, ...partialUnitPrefs }
      : undefined;

    const updatedVehicle = await vehicleRepository.update(id, {
      ...restUpdateData,
      ...(mergedUnitPreferences && { unitPreferences: mergedUnitPreferences }),
    });

    return c.json({
      success: true,
      data: updatedVehicle,
      message: 'Vehicle updated successfully',
    });
  }
);

// DELETE /api/vehicles/:id - Delete vehicle
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // Check if vehicle exists and belongs to user
  const existingVehicle = await vehicleRepository.findByUserIdAndId(user.id, id);
  if (!existingVehicle) {
    throw new NotFoundError('Vehicle');
  }

  // Cascade delete all photos (Drive + DB) before removing the vehicle
  await deleteAllPhotosForEntity('vehicle', id, user.id);

  await vehicleRepository.delete(id);

  return c.json({
    success: true,
    message: 'Vehicle deleted successfully',
  });
});

// Validation schema for stats
const statsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('all'),
});

// GET /api/vehicles/:id/stats - Get vehicle statistics
routes.get(
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
    const fuelExpenses = await expenseRepository.findAll({
      vehicleId: id,
      userId: user.id,
      category: 'fuel',
    });

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
    const stats = calculateVehicleStats(
      sortedExpenses,
      vehicle.initialMileage || 0,
      vehicle.trackFuel,
      vehicle.trackCharging
    );

    return c.json({
      success: true,
      data: {
        period,
        ...stats,
      },
    });
  }
);

export { routes };
