import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { expenses, vehicles as vehiclesTable } from '../../db/schema';
import type { ApiResponse } from '../../errors';
import { ConflictError, NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { getPeriodStartDate, sortExpensesByDate } from '../../utils/calculations';
import { chunk } from '../../utils/chunk';
import { logger } from '../../utils/logger';
import { moneyDollarsToCents, vehicleRowToApi } from '../../utils/money';
import {
  requireVehicleRead,
  resolveVehicleAccess,
  resolveVehicleOwnerId,
} from '../../utils/sharing';
import {
  mergeUnitPreferences,
  partialUnitPreferencesSchema,
  unitPreferencesSchema,
} from '../../utils/unit-preferences-schema';
import { commonSchemas, validateVehicleOwnership, zValidator } from '../../utils/validation';
import { calculateVehicleStats } from '../../utils/vehicle-stats';
import { expenseRepository } from '../expenses/repository';
import { financingRepository, withComputedBalance } from '../financing/repository';
import { odometerRepository } from '../odometer/repository';
import { deleteAllPhotosForEntity, deletePhotosForEntities } from '../photos/photo-service';
import { reminderRepository } from '../reminders/repository';
import { preferencesRepository } from '../settings/repository';
import { vehicleShareRepository } from '../shares/repository';
import { photoRoutes } from './photo-routes';
import { vehicleRepository } from './repository';

const routes = new Hono();

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
  // Client sends dollars; the column stores integer cents.
  purchasePrice: moneyDollarsToCents((n) =>
    n.min(0, 'Purchase price cannot be negative')
  ).optional(),
  purchaseDate: z.coerce.date().optional(),
});

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

// Exported so tests can assert that the partial update schema injects no column defaults.
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
    // Nullable columns are nullish: null clears a field, omitting it leaves the value unchanged.
    licensePlate: baseVehicleSchema.shape.licensePlate.nullish(),
    nickname: baseVehicleSchema.shape.nickname.nullish(),
    vin: baseVehicleSchema.shape.vin.nullish(),
    initialMileage: baseVehicleSchema.shape.initialMileage.nullish(),
    purchasePrice: baseVehicleSchema.shape.purchasePrice.nullish(),
    purchaseDate: baseVehicleSchema.shape.purchaseDate.nullish(),
  })
  .partial();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.route('/:vehicleId/photos', photoRoutes);

/**
 * Plates are unique per user, not globally. excludeId lets an update ignore the vehicle being edited.
 * @throws ConflictError if another of the user's vehicles already has the plate.
 */
async function assertLicensePlateAvailable(
  licensePlate: string,
  userId: string,
  excludeId?: string
): Promise<void> {
  const existing = await vehicleRepository.findByLicensePlate(licensePlate, userId);
  if (existing && existing.id !== excludeId) {
    throw new ConflictError('A vehicle with this license plate already exists');
  }
}

// ?include=shared also returns vehicles shared to the user via an accepted share, annotated with
// sharedAccess { level, sharedBy }. Read-only: expense writes are not widened.
const listVehiclesQuerySchema = z.object({
  include: z.enum(['shared']).optional(),
});
routes.get('/', zValidator('query', listVehiclesQuerySchema), async (c) => {
  const user = c.get('user');
  const { include } = c.req.valid('query');

  const userVehicles = await vehicleRepository.findByUserId(user.id);

  let sharedRows: Array<
    (typeof userVehicles)[number] & {
      sharedAccess: { level: string; sharedBy: string };
    }
  > = [];
  if (include === 'shared') {
    const grants = await vehicleShareRepository.findAcceptedAccessForUser(user.id);
    if (grants.length > 0) {
      const byVehicleId = new Map(grants.map((g) => [g.vehicleId, g]));
      const sharedVehicles = await vehicleRepository.findByIds([...byVehicleId.keys()]);
      sharedRows = sharedVehicles.map((v) => {
        const g = byVehicleId.get(v.id);
        return {
          ...v,
          sharedAccess: { level: g?.level ?? 'viewer', sharedBy: g?.ownerName ?? 'Unknown' },
        };
      });
    }
  }

  const allVehicles = [...userVehicles, ...sharedRows];

  // Batched to avoid an N+1 over financed vehicles.
  const financingIds = allVehicles
    .map((v) => v.financing?.id)
    .filter((id): id is string => id !== undefined);
  const balances = await financingRepository.computeBalances(financingIds);

  const enrichedVehicles = allVehicles.map((v) => {
    if (v.financing) {
      const computedBalance = balances.get(v.financing.id) ?? 0;
      return { ...v, financing: withComputedBalance(v.financing, computedBalance) };
    }
    return v;
  });

  // Stored cents become dollars at the API boundary.
  const apiVehicles = enrichedVehicles.map(vehicleRowToApi);
  const response: ApiResponse<typeof apiVehicles> = {
    success: true,
    data: apiVehicles,
    message: `Found ${apiVehicles.length} vehicle${apiVehicles.length !== 1 ? 's' : ''}`,
  };

  return c.json(response);
});

routes.post('/', zValidator('json', createVehicleSchema), async (c) => {
  const user = c.get('user');
  const vehicleData = c.req.valid('json');

  if (vehicleData.licensePlate) {
    await assertLicensePlateAvailable(vehicleData.licensePlate, user.id);
  }

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
    data: vehicleRowToApi(createdVehicle),
    message: 'Vehicle created successfully',
  };

  return c.json(response, 201);
});

// Owners and accepted viewers/editors may read. Non-owners get a sharedAccess annotation so the UI can
// gate edit controls by level; owner-only actions (delete, financing, share management) stay server-side strict.
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // 404 rather than 403 so vehicle existence is not revealed.
  const access = await resolveVehicleAccess(id, user.id);
  if (!access) {
    throw new NotFoundError('Vehicle');
  }

  const vehicle =
    access.role === 'owner'
      ? await vehicleRepository.findByIdWithAccess(id, user.id)
      : ((await vehicleRepository.findByIds([id]))[0] ?? null);

  if (!vehicle) {
    throw new NotFoundError('Vehicle');
  }

  // The resolver already proved an accepted share exists; this lookup only supplies the label.
  let sharedAccess: { level: string; sharedBy: string } | undefined;
  if (access.role !== 'owner') {
    const grants = await vehicleShareRepository.findAcceptedAccessForUser(user.id);
    const grant = grants.find((g) => g.vehicleId === id);
    sharedAccess = { level: grant?.level ?? access.role, sharedBy: grant?.ownerName ?? 'Unknown' };
  }

  let responseData: typeof vehicle & {
    financing?: (typeof vehicle)['financing'] & {
      computedBalance?: number;
      eligibleForPayoff?: boolean;
    };
    sharedAccess?: { level: string; sharedBy: string };
  } = vehicle;
  if (vehicle.financing) {
    const computedBalance = await financingRepository.computeBalance(vehicle.financing.id);
    responseData = {
      ...vehicle,
      financing: withComputedBalance(vehicle.financing, computedBalance),
    };
  }
  if (sharedAccess) {
    responseData = { ...responseData, sharedAccess };
  }

  const response: ApiResponse<typeof responseData> = {
    success: true,
    data: vehicleRowToApi(responseData),
  };

  return c.json(response);
});

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateVehicleSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const updateData = c.req.valid('json');

    const existingVehicle = await vehicleRepository.findByIdWithAccess(id, user.id);
    if (!existingVehicle) {
      throw new NotFoundError('Vehicle');
    }

    if (updateData.licensePlate && updateData.licensePlate !== existingVehicle.licensePlate) {
      await assertLicensePlateAvailable(updateData.licensePlate, user.id, id);
    }

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
      data: vehicleRowToApi(updatedVehicle),
      message: 'Vehicle updated successfully',
    });
  }
);

/** Split groups this vehicle has a leg in. Must be read before the FK cascade removes the legs. */
async function splitGroupIdsForVehicle(vehicleId: string, userId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ groupId: expenses.groupId })
    .from(expenses)
    .where(
      and(
        eq(expenses.vehicleId, vehicleId),
        eq(expenses.userId, userId),
        isNotNull(expenses.groupId)
      )
    );
  return rows.map((r) => r.groupId).filter((groupId): groupId is string => groupId !== null);
}

/**
 * Sets each split group's groupTotal to the sum of its surviving legs, so each survivor keeps the cost
 * it incurred. A stale total would let a later even or percentage edit re-divide the pre-delete amount.
 */
async function shrinkSplitGroupsToSurvivingLegs(userId: string, groupIds: string[]): Promise<void> {
  const db = getDb();
  // Chunked: inArray binds one parameter per id, and a fleet's split history is unbounded.
  for (const batch of chunk(groupIds)) {
    await db
      .update(expenses)
      .set({
        groupTotal: sql`(SELECT sum(legs.expense_amount) FROM ${expenses} AS legs
          WHERE legs.group_id = ${expenses.groupId} AND legs.user_id = ${expenses.userId})`,
        updatedAt: new Date(),
      })
      .where(and(eq(expenses.userId, userId), inArray(expenses.groupId, batch)));
  }
}

routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  await validateVehicleOwnership(id, user.id);

  // Photos link to entities by (entity_type, entity_id) with no foreign key, so the cascade would orphan
  // them and leak provider files. Clean them up while the dependent entities can still be enumerated.
  const [expenseIds, odometerIds, splitGroupIds] = await Promise.all([
    expenseRepository.findIdsByVehicleId(id),
    odometerRepository.findIdsByVehicleId(id),
    splitGroupIdsForVehicle(id, user.id),
  ]);
  await deleteAllPhotosForEntity('vehicle', id, user.id);
  await deletePhotosForEntities('expense', expenseIds, user.id);
  await deletePhotosForEntities('odometer_entry', odometerIds, user.id);

  await vehicleRepository.delete(id);

  // Runs after the delete has committed. Failures are logged, not returned, so a retry does not 404 and
  // the successful delete still reports success.
  try {
    // Runs first: unlike the reminder steps below, a stale split-group total does not self-heal.
    await shrinkSplitGroupsToSurvivingLegs(user.id, splitGroupIds);

    // The split config is JSON, not FK-managed, so the deleted leg must be pruned before the next
    // reminder trigger tries to build a sibling for it.
    await reminderRepository.pruneSplitConfigsForDeletedVehicle(user.id, id);

    // Reminders left with no vehicles would be skipped forever, so deactivate them.
    await reminderRepository.deactivateVehicleless(user.id);
  } catch (error) {
    logger.error('Post-delete vehicle cleanup failed (vehicle already deleted)', {
      vehicleId: id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return c.json({
    success: true,
    message: 'Vehicle deleted successfully',
  });
});

const statsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('all'),
});

routes.get(
  '/:id/stats',
  zValidator('param', commonSchemas.idParam),
  zValidator('query', statsQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { period } = c.req.valid('query');

    // Shared rows are stamped with the owner's id, so fuel and odometer data is read from the owner's books.
    const access = await requireVehicleRead(id, user.id);
    const ownerId =
      access.role === 'owner' ? user.id : ((await resolveVehicleOwnerId(id)) ?? user.id);
    const vehicle =
      access.role === 'owner'
        ? await vehicleRepository.findByIdWithAccess(id, user.id)
        : ((await vehicleRepository.findByIds([id]))[0] ?? null);
    if (!vehicle) {
      throw new NotFoundError('Vehicle');
    }

    const fuelExpenses = await expenseRepository.findAll({
      vehicleId: id,
      userId: ownerId,
      category: 'fuel',
    });

    const startDate = getPeriodStartDate(period);

    const filteredFuelExpenses = startDate
      ? fuelExpenses.filter((e) => new Date(e.date) >= (startDate as Date))
      : fuelExpenses;

    const sortedExpenses = sortExpensesByDate(filteredFuelExpenses);

    const stats = calculateVehicleStats(
      sortedExpenses,
      vehicle.initialMileage || 0,
      vehicle.trackFuel,
      vehicle.trackCharging
    );

    // currentMileage is period-filtered and fuel-only; currentOdometer is the all-time reading across all sources.
    const currentOdometer = await odometerRepository.getCurrentOdometer(id, ownerId);

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
