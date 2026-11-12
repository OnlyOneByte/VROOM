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

routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // 404, not 403, so a non-member cannot learn that the vehicle exists.
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

// Must run before the vehicle delete: the FK cascade removes the legs.
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

async function shrinkSplitGroupsToSurvivingLegs(userId: string, groupIds: string[]): Promise<void> {
  const db = getDb();
  // SQLite caps bound parameters, and inArray binds one per id: keep batches small.
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

  // Photos have no FK: the vehicle cascade would orphan them, so delete them before the row goes.
  const [expenseIds, odometerIds, splitGroupIds] = await Promise.all([
    expenseRepository.findIdsByVehicleId(id),
    odometerRepository.findIdsByVehicleId(id),
    splitGroupIdsForVehicle(id, user.id),
  ]);
  await deleteAllPhotosForEntity('vehicle', id, user.id);
  await deletePhotosForEntities('expense', expenseIds, user.id);
  await deletePhotosForEntities('odometer_entry', odometerIds, user.id);

  await vehicleRepository.delete(id);

  // Errors are logged, not thrown: the delete has already committed, and a retry would 404.
  try {
    await shrinkSplitGroupsToSurvivingLegs(user.id, splitGroupIds);
    // Split configs are JSON with no FK: prune deleted legs or reminders will target them.
    await reminderRepository.pruneSplitConfigsForDeletedVehicle(user.id, id);
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
