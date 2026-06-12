import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { vehicles as vehiclesTable } from '../../db/schema';
import type { ApiResponse } from '../../errors';
import { ConflictError, NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { getPeriodStartDate } from '../../utils/calculations';
import {
  mergeUnitPreferences,
  partialUnitPreferencesSchema,
  unitPreferencesSchema,
} from '../../utils/unit-preferences-schema';
import { commonSchemas, validateVehicleOwnership } from '../../utils/validation';
import { calculateVehicleStats } from '../../utils/vehicle-stats';
import { expenseRepository } from '../expenses/repository';
import { financingRepository, withComputedBalance } from '../financing/repository';
import { odometerRepository } from '../odometer/repository';
import { deleteAllPhotosForEntity, deletePhotosForEntities } from '../photos/photo-service';
import { preferencesRepository } from '../settings/repository';
import { photoRoutes } from './photo-routes';
import { vehicleRepository } from './repository';

const routes = new Hono();

// unitPreferencesSchema + partialUnitPreferencesSchema now live in utils/unit-preferences-schema.ts
// (shared with settings/routes.ts — the C238 dedup).

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

// Exported so the C41 `.partial()`+`.default()` no-clobber net can assert against it directly
// (partial-update-no-default-injection.test.ts) — it's a createInsertSchema(...).partial() over a
// table with four .default() columns (vehicleType/trackFuel/trackCharging/unitPreferences), the exact
// shape that class targets. Safe today (drizzle-zod doesn't surface DB defaults as Zod defaults), but
// the highest-risk uncovered instance, so it belongs under the standing guard.
export const updateVehicleSchema = baseVehicleSchema
  .omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
    unitPreferences: true,
  })
  .extend({
    unitPreferences: partialUnitPreferencesSchema.optional(),
    // On UPDATE, the nullable optional columns are nullish so an emptied field
    // can be CLEARED with an explicit null (the form sends null on edit). The
    // base schema overrides these as .optional() (rejects null); re-declare them
    // here. Drizzle's .set() passes null through and drops undefined, so null
    // clears and omitting leaves unchanged. (vin keeps drizzle-zod's nullable
    // default, but is re-declared here for consistency.)
    licensePlate: baseVehicleSchema.shape.licensePlate.nullish(),
    nickname: baseVehicleSchema.shape.nickname.nullish(),
    vin: baseVehicleSchema.shape.vin.nullish(),
    initialMileage: baseVehicleSchema.shape.initialMileage.nullish(),
    purchasePrice: baseVehicleSchema.shape.purchasePrice.nullish(),
    purchaseDate: baseVehicleSchema.shape.purchaseDate.nullish(),
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

  // Enrich financing with computed balance. Batch all balances in two queries
  // (computeBalances) instead of an N+1 over each financed vehicle.
  const financingIds = userVehicles
    .map((v) => v.financing?.id)
    .filter((id): id is string => id !== undefined);
  const balances = await financingRepository.computeBalances(financingIds);

  const enrichedVehicles = userVehicles.map((v) => {
    if (v.financing) {
      const computedBalance = balances.get(v.financing.id) ?? 0;
      return { ...v, financing: withComputedBalance(v.financing, computedBalance) };
    }
    return v;
  });

  const response: ApiResponse<typeof enrichedVehicles> = {
    success: true,
    data: enrichedVehicles,
    message: `Found ${enrichedVehicles.length} vehicle${enrichedVehicles.length !== 1 ? 's' : ''}`,
  };

  return c.json(response);
});

// POST /api/vehicles - Create new vehicle
routes.post('/', zValidator('json', createVehicleSchema), async (c) => {
  const user = c.get('user');
  const vehicleData = c.req.valid('json');

  // Check if license plate already exists in THIS user's fleet (scoped — plate uniqueness is
  // per-user, not global; see findByLicensePlate).
  if (vehicleData.licensePlate) {
    const existingVehicle = await vehicleRepository.findByLicensePlate(
      vehicleData.licensePlate,
      user.id
    );
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

  // Enrich financing with computed balance so the frontend can show progress
  let responseData: typeof vehicle & {
    financing?: (typeof vehicle)['financing'] & {
      computedBalance?: number;
      eligibleForPayoff?: boolean;
    };
  } = vehicle;
  if (vehicle.financing) {
    const computedBalance = await financingRepository.computeBalance(vehicle.financing.id);
    responseData = {
      ...vehicle,
      financing: withComputedBalance(vehicle.financing, computedBalance),
    };
  }

  const response: ApiResponse<typeof responseData> = {
    success: true,
    data: responseData,
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

    // Check if license plate already exists in THIS user's fleet (scoped — see findByLicensePlate).
    if (updateData.licensePlate && updateData.licensePlate !== existingVehicle.licensePlate) {
      const vehicleWithPlate = await vehicleRepository.findByLicensePlate(
        updateData.licensePlate,
        user.id
      );
      if (vehicleWithPlate && vehicleWithPlate.id !== id) {
        throw new ConflictError('A vehicle with this license plate already exists');
      }
    }

    // Merge partial unitPreferences with existing values (shared helper — the C238 dedup).
    const { unitPreferences: partialUnitPrefs, ...restUpdateData } = updateData;
    const mergedUnitPreferences = mergeUnitPreferences(
      existingVehicle.unitPreferences,
      partialUnitPrefs
    );

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
  await validateVehicleOwnership(id, user.id);

  // Cascade delete all photos (provider files + DB) BEFORE removing the vehicle.
  // The photos table links to entities by (entity_type, entity_id) strings with
  // NO foreign key, so the DB FK-cascade that removes the vehicle's expenses and
  // odometer entries would otherwise orphan their photo rows AND leak the
  // external storage files. Clean the vehicle's own photos plus every dependent
  // entity's photos here, while those entities still exist to be enumerated.
  const [expenseIds, odometerIds] = await Promise.all([
    expenseRepository.findIdsByVehicleId(id),
    odometerRepository.findIdsByVehicleId(id),
  ]);
  await deleteAllPhotosForEntity('vehicle', id, user.id);
  await deletePhotosForEntities('expense', expenseIds, user.id);
  await deletePhotosForEntities('odometer_entry', odometerIds, user.id);

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
    const vehicle = await validateVehicleOwnership(id, user.id);

    // Get all fuel expenses for this vehicle
    const fuelExpenses = await expenseRepository.findAll({
      vehicleId: id,
      userId: user.id,
      category: 'fuel',
    });

    // Filter by time period (null for 'all' = no lower bound). Shared one-source-of-truth window.
    const startDate = getPeriodStartDate(period);

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

    // `stats.currentMileage` is period-filtered + fuel-only (MAX over the filtered fuel
    // expenses), so it can drop/disappear under a 7d/30d window and never sees manual
    // odometer entries. `currentOdometer` is the canonical ALL-TIME, ALL-SOURCES reading
    // (the D2 helper the mileage trigger uses) — period-independent by design, so a
    // consumer that needs the vehicle's true odometer (lease overage, loan miles-used)
    // can use it instead of the period-scoped stat. Additive: currentMileage is unchanged.
    const currentOdometer = await odometerRepository.getCurrentOdometer(id, user.id);

    return c.json({
      success: true,
      data: {
        period,
        ...stats,
        currentOdometer,
      },
    });
  }
);

export { routes };
