import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { appContext, repos } from '../../app-context';
import { CONFIG } from '../../config';
import {
  expenses,
  odometerEntries,
  reminders,
  reminderVehicles,
  trips,
  vehicleFinancing,
  vehicles as vehiclesTable,
} from '../../db/schema';
import { VEHICLE_KINDS, VEHICLE_TYPES } from '../../db/types';
import type { ApiResponse } from '../../errors';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, ownAccount, vehicleParam } from '../../permissions/authorize';
import { loadResolver, vehicleResources } from '../../permissions/grants';
import { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences, type UnitPreferences } from '../../types';
import { getPeriodStartDate, sortExpensesByDate } from '../../utils/calculations';
import { chunk } from '../../utils/chunk';
import { logger } from '../../utils/logger';
import {
  boundedDollarsToCents,
  minorUnitScale,
  toMajor,
  vehicleFromApi,
  vehicleRowToApi,
} from '../../utils/money';
import { isValidTimeZone } from '../../utils/time-zone';
import { canonicalScale } from '../../utils/unit-conversions';
import {
  mergeUnitPreferences,
  partialUnitPreferencesSchema,
  unitPreferencesSchema,
} from '../../utils/unit-preferences-schema';
import {
  commonSchemas,
  dateInput,
  MAX_ODOMETER_READING,
  ODOMETER_TOO_HIGH_MESSAGE,
  WHOLE_DISTANCE_MESSAGE,
  zValidator,
} from '../../utils/validation';
import {
  requireVehicleAccess,
  resolveVehicleAccess,
  seesFinancials,
  sharedVehicleView,
} from '../../utils/vehicle-access';
import { catalogModelMatchesMake, isCatalogModel } from '../../utils/vehicle-catalog';
import { calculateVehicleStats } from '../../utils/vehicle-stats';
import { carShareAccess } from '../drivers/attribution';
import { carShareRoutes, driverRoutes } from '../drivers/routes';
import { withComputedBalance } from '../financing/repository';
import { deleteAllPhotosForEntity, deletePhotosForEntities } from '../photos/photo-service';
import { vehiclePeople } from '../roles/routes';
import { photoRoutes } from './photo-routes';

const routes = new Hono();

interface SharedAccess {
  level: string;
  sharedBy: string;
  seesFinancials: boolean;
}

const VIN_PATTERN = new RegExp(
  `^[A-Z0-9]{${CONFIG.validation.vehicle.vinMinLength},${CONFIG.validation.vehicle.vinMaxLength}}$`,
  'i'
);

const baseVehicleSchema = createInsertSchema(vehiclesTable, {
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  vehicleKind: z.enum(VEHICLE_KINDS).optional(),
  vin: z
    .union([
      z.literal(''),
      z
        .string()
        .regex(
          VIN_PATTERN,
          `VIN must be ${CONFIG.validation.vehicle.vinMinLength}-${CONFIG.validation.vehicle.vinMaxLength} letters and numbers`
        ),
    ])
    .nullish(),
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
    .max(
      new Date().getFullYear() + CONFIG.validation.vehicle.maxYearsAhead,
      'Year cannot be in the future'
    ),
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
  initialMileage: z
    .number()
    .int(WHOLE_DISTANCE_MESSAGE)
    .min(0, 'Initial mileage cannot be negative')
    .max(MAX_ODOMETER_READING, ODOMETER_TOO_HIGH_MESSAGE)
    .optional(),
  purchasePrice: boundedDollarsToCents(
    'Purchase price',
    CONFIG.validation.vehicle.maxPurchasePrice,
    (n) => n.min(0, 'Purchase price cannot be negative')
  ).optional(),
  purchaseDate: dateInput.optional(),
  catalogModelId: z.string().refine(isCatalogModel, 'Unknown catalogue model').nullish(),
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
    confirmUnitChange: z.boolean().optional(),
  })
  .partial();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.route('/:vehicleId/photos', photoRoutes);
routes.route('/:vehicleId/drivers', driverRoutes);
routes.route('/:vehicleId/car-share', carShareRoutes);

function changedUnits(existing: UnitPreferences, merged: UnitPreferences | undefined): string[] {
  if (!merged) return [];
  return (Object.keys(merged) as Array<keyof UnitPreferences>).filter(
    (unit) => merged[unit] !== existing[unit]
  );
}

function assertCatalogModelMatchesMake(catalogModelId: string | null | undefined, make: string) {
  if (catalogModelId && !catalogModelMatchesMake(catalogModelId, make)) {
    throw new ValidationError("The catalogue model doesn't belong to this vehicle's make");
  }
}

function renamedWithoutCatalogModel(
  existing: { make: string; model: string },
  update: { make?: string; model?: string; catalogModelId?: string | null }
): boolean {
  if (update.catalogModelId !== undefined) return false;
  const makeChanged = update.make !== undefined && update.make !== existing.make;
  const modelChanged = update.model !== undefined && update.model !== existing.model;
  return makeChanged || modelChanged;
}

async function vehicleHasMeasuredHistory(vehicleId: string): Promise<boolean> {
  const db = appContext().asyncDb;
  const [expense, odometer, trip, mileageReminder, leaseLimit] = await Promise.all([
    db
      .select({ id: expenses.id })
      .from(expenses)
      .where(
        and(
          eq(expenses.vehicleId, vehicleId),
          or(isNotNull(expenses.mileage), isNotNull(expenses.volume))
        )
      )
      .limit(1)
      .get(),
    db
      .select({ id: odometerEntries.id })
      .from(odometerEntries)
      .where(eq(odometerEntries.vehicleId, vehicleId))
      .limit(1)
      .get(),
    db.select({ id: trips.id }).from(trips).where(eq(trips.vehicleId, vehicleId)).limit(1).get(),
    db
      .select({ id: reminders.id })
      .from(reminders)
      .innerJoin(reminderVehicles, eq(reminderVehicles.reminderId, reminders.id))
      .where(and(eq(reminderVehicles.vehicleId, vehicleId), isNotNull(reminders.intervalMileage)))
      .limit(1)
      .get(),
    db
      .select({ id: vehicleFinancing.id })
      .from(vehicleFinancing)
      .where(
        and(eq(vehicleFinancing.vehicleId, vehicleId), isNotNull(vehicleFinancing.mileageLimit))
      )
      .limit(1)
      .get(),
  ]);
  return Boolean(expense || odometer || trip || mileageReminder || leaseLimit);
}

async function assertUnitChangeConfirmed(
  vehicle: { id: string; initialMileage: number | null; unitPreferences: UnitPreferences },
  merged: UnitPreferences | undefined,
  confirmed: boolean | undefined
): Promise<void> {
  const changed = changedUnits(vehicle.unitPreferences, merged);
  if (changed.length === 0 || confirmed) return;
  if (vehicle.initialMileage == null && !(await vehicleHasMeasuredHistory(vehicle.id))) return;
  throw new ValidationError(
    'Changing units does not convert readings already saved for this vehicle; they will be shown in the new units as entered. Confirm the change to continue.',
    { requiresUnitChangeConfirmation: true, changedUnits: changed }
  );
}

async function assertLicensePlateAvailable(
  licensePlate: string,
  userId: string,
  excludeId?: string
): Promise<void> {
  const existing = await repos().vehicles.findByLicensePlate(licensePlate, userId);
  if (existing && existing.id !== excludeId) {
    throw new ConflictError('A vehicle with this license plate already exists');
  }
}

const timeZoneSchema = z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional();

const listVehiclesQuerySchema = z.object({
  include: z.enum(['shared']).optional(),
  timeZone: timeZoneSchema,
});
routes.get('/', zValidator('query', listVehiclesQuerySchema), authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const { include, timeZone } = c.req.valid('query');

  const userVehicles = await repos().vehicles.findByUserId(user.id);
  const ownerOf = new Map(userVehicles.map((v) => [v.id, v.userId]));

  let sharedRows: Array<
    (typeof userVehicles)[number] & {
      sharedAccess: { level: string; sharedBy: string };
    }
  > = [];
  if (include === 'shared') {
    const grants = await repos().vehicleShares.findAcceptedAccessForUser(user.id);
    if (grants.length > 0) {
      const byVehicleId = new Map(grants.map((g) => [g.vehicleId, g]));
      const resolver = await loadResolver(c, vehicleResources(byVehicleId.keys()));
      const sharedVehicles = (await repos().vehicles.findByIds([...byVehicleId.keys()])).filter(
        (v) => resolver.can('vehicle.read', { kind: 'vehicle', vehicleId: v.id }).allow
      );
      for (const v of sharedVehicles) ownerOf.set(v.id, v.userId);
      sharedRows = await Promise.all(
        sharedVehicles.map(async (v) => {
          const g = byVehicleId.get(v.id);
          const access = await resolveVehicleAccess(v.id, user.id);
          return {
            ...(access && seesFinancials(access) ? v : sharedVehicleView(v)),
            sharedAccess: { level: g?.level ?? 'viewer', sharedBy: g?.ownerName ?? 'Unknown' },
          };
        })
      );
    }
  }

  const allVehicles = [...userVehicles, ...sharedRows];

  const financingIds = allVehicles
    .map((v) => v.financing?.id)
    .filter((id): id is string => id !== undefined);
  const balances = await repos().financing.computeBalances(financingIds, timeZone);

  const enrichedVehicles = allVehicles.map((v) => {
    if (v.financing) {
      const computedBalance = balances.get(v.financing.id) ?? 0;
      return { ...v, financing: withComputedBalance(v.financing, computedBalance) };
    }
    return v;
  });

  const currencyOf = await repos().preferences.currencies(ownerOf.values());
  await loadResolver(c, vehicleResources(allVehicles.map((v) => v.id)));
  const apiVehicles = enrichedVehicles.map((v) => {
    const ownerCurrency = currencyOf(ownerOf.get(v.id) ?? '');
    return {
      ...vehicleRowToApi(v, minorUnitScale(ownerCurrency)),
      ownerCurrency,
      carShare: carShareAccess(c, v.id, v.carShareEnabled),
    };
  });
  const response: ApiResponse<typeof apiVehicles> = {
    success: true,
    data: apiVehicles,
    message: `Found ${apiVehicles.length} vehicle${apiVehicles.length !== 1 ? 's' : ''}`,
  };

  return c.json(response);
});

routes.post('/', zValidator('json', createVehicleSchema), authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const vehicleData = c.req.valid('json');

  if (vehicleData.licensePlate) {
    await assertLicensePlateAvailable(vehicleData.licensePlate, user.id);
  }
  assertCatalogModelMatchesMake(vehicleData.catalogModelId, vehicleData.make);

  let { unitPreferences } = vehicleData;
  if (!unitPreferences) {
    const userSettings = await repos().preferences.getOrCreate(user.id);
    unitPreferences = userSettings.unitPreferences;
  }

  const ownerCurrency = (await repos().preferences.currencies([user.id]))(user.id);
  const scale = minorUnitScale(ownerCurrency);
  const createdVehicle = await repos().vehicles.create({
    ...vehicleFromApi(vehicleData, scale),
    unitPreferences,
    userId: user.id,
  });

  const response: ApiResponse<typeof createdVehicle & { ownerCurrency: string }> = {
    success: true,
    data: { ...vehicleRowToApi(createdVehicle, scale), ownerCurrency },
    message: 'Vehicle created successfully',
  };

  return c.json(response, 201);
});

routes.get(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('query', z.object({ timeZone: timeZoneSchema })),
  authorize(vehicleParam('id')),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { timeZone } = c.req.valid('query');

    const access = await requireVehicleAccess(id, user.id, 'read');
    const vehicle = (await repos().vehicles.findByIds([id]))[0] ?? null;

    if (!vehicle) {
      throw new NotFoundError('Vehicle');
    }

    let sharedAccess: SharedAccess | undefined;
    if (access.role !== 'owner') {
      const grants = await repos().vehicleShares.findAcceptedAccessForUser(user.id);
      const grant = grants.find((g) => g.vehicleId === id);
      sharedAccess = {
        level: grant?.level ?? access.role,
        sharedBy: grant?.ownerName ?? 'Unknown',
        seesFinancials: seesFinancials(access),
      };
    }

    let responseData: typeof vehicle & {
      financing?: (typeof vehicle)['financing'] & {
        computedBalance?: number;
        eligibleForPayoff?: boolean;
      };
      sharedAccess?: SharedAccess;
    } = seesFinancials(access) ? vehicle : sharedVehicleView(vehicle);
    if (responseData.financing) {
      const computedBalance = await repos().financing.computeBalance(
        responseData.financing.id,
        timeZone
      );
      responseData = {
        ...responseData,
        financing: withComputedBalance(responseData.financing, computedBalance),
      };
    }
    if (sharedAccess) {
      responseData = { ...responseData, sharedAccess };
    }
    const carShare = carShareAccess(c, id, vehicle.carShareEnabled);

    const ownerCurrency = (await repos().preferences.currencies([vehicle.userId]))(vehicle.userId);
    const response: ApiResponse<
      typeof responseData & { carShare: typeof carShare; ownerCurrency: string }
    > = {
      success: true,
      data: {
        ...vehicleRowToApi(responseData, minorUnitScale(ownerCurrency)),
        ownerCurrency,
        carShare,
      },
    };

    return c.json(response);
  }
);

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateVehicleSchema),
  authorize(vehicleParam('id')),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const updateData = c.req.valid('json');

    const existingVehicle = (await repos().vehicles.findByIds([id]))[0] ?? null;
    if (!existingVehicle) {
      throw new NotFoundError('Vehicle');
    }
    const access = await requireVehicleAccess(id, user.id, 'read');
    if (
      !seesFinancials(access) &&
      (updateData.purchasePrice !== undefined || updateData.vin !== undefined)
    ) {
      throw new ForbiddenError('Only people who can see loan details can change the price or VIN');
    }

    if (updateData.licensePlate && updateData.licensePlate !== existingVehicle.licensePlate) {
      await assertLicensePlateAvailable(updateData.licensePlate, existingVehicle.userId, id);
    }
    assertCatalogModelMatchesMake(
      updateData.catalogModelId,
      updateData.make ?? existingVehicle.make
    );

    const { unitPreferences: partialUnitPrefs, confirmUnitChange, ...restUpdateData } = updateData;
    const mergedUnitPreferences = mergeUnitPreferences(
      existingVehicle.unitPreferences,
      partialUnitPrefs
    );
    await assertUnitChangeConfirmed(existingVehicle, mergedUnitPreferences, confirmUnitChange);

    const ownerId = existingVehicle.userId;
    const ownerCurrency = (await repos().preferences.currencies([ownerId]))(ownerId);
    const scale = minorUnitScale(ownerCurrency);
    const updatedVehicle = await repos().vehicles.update(id, {
      ...vehicleFromApi(restUpdateData, scale),
      ...(mergedUnitPreferences && { unitPreferences: mergedUnitPreferences }),
      ...(renamedWithoutCatalogModel(existingVehicle, updateData) && { catalogModelId: null }),
    });

    return c.json({
      success: true,
      data: {
        ...vehicleRowToApi(
          seesFinancials(access) ? updatedVehicle : sharedVehicleView(updatedVehicle),
          scale
        ),
        ownerCurrency,
      },
      message: 'Vehicle updated successfully',
    });
  }
);

// Must run before the vehicle delete: the FK cascade removes the legs.
async function splitGroupIdsForVehicle(vehicleId: string, userId: string): Promise<string[]> {
  const rows = await appContext()
    .asyncDb.selectDistinct({ groupId: expenses.groupId })
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
  const db = appContext().asyncDb;
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

routes.delete(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  authorize(vehicleParam('id')),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    // Photos have no FK: the vehicle cascade would orphan them, so delete them before the row goes.
    const [expenseIds, odometerIds, splitGroupIds] = await Promise.all([
      repos().expenses.findIdsByVehicleId(id),
      repos().odometer.findIdsByVehicleId(id),
      splitGroupIdsForVehicle(id, user.id),
    ]);
    await deleteAllPhotosForEntity('vehicle', id, user.id);
    await deletePhotosForEntities('expense', expenseIds, user.id);
    await deletePhotosForEntities('odometer_entry', odometerIds, user.id);

    await repos().vehicles.delete(id);

    // Errors are logged, not thrown: the delete has already committed, and a retry would 404.
    try {
      await shrinkSplitGroupsToSurvivingLegs(user.id, splitGroupIds);
      // Split configs are JSON with no FK: prune deleted legs or reminders will target them.
      await repos().reminders.pruneSplitConfigsForDeletedVehicle(user.id, id);
      await repos().reminders.deactivateVehicleless(user.id);
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
  }
);

function periodBaselineMileage(
  fuelExpenses: { date: Date | string; mileage: number | null }[],
  startDate: Date | null,
  initialMileage: number
): number {
  if (!startDate) return initialMileage;
  let baseline = initialMileage;
  for (const e of fuelExpenses) {
    if (e.mileage !== null && new Date(e.date) < startDate && e.mileage > baseline) {
      baseline = e.mileage;
    }
  }
  return baseline;
}

const statsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('all'),
});

routes.get(
  '/:id/stats',
  zValidator('param', commonSchemas.idParam),
  zValidator('query', statsQuerySchema),
  authorize(vehicleParam('id')),
  async (c) => {
    const { id } = c.req.valid('param');
    const { period } = c.req.valid('query');

    const vehicle = (await repos().vehicles.findByIds([id]))[0] ?? null;
    if (!vehicle) {
      throw new NotFoundError('Vehicle');
    }
    const ownerId = vehicle.userId;

    const fuelExpenses = await repos().expenses.findAll({
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
      periodBaselineMileage(fuelExpenses, startDate, vehicle.initialMileage || 0),
      vehicle.trackFuel,
      vehicle.trackCharging,
      canonicalScale(parseUnitPreferences(vehicle.unitPreferences) ?? DEFAULT_UNIT_PREFERENCES)
    );

    const currentOdometer = await repos().odometer.getCurrentOdometer(id, ownerId);
    const { major, majorOrNull } = toMajor(await repos().preferences.moneyScale(ownerId));

    return c.json({
      success: true,
      data: {
        period,
        ...stats,
        totalFuelCost: major(stats.totalFuelCost),
        totalChargeCost: major(stats.totalChargeCost),
        costPerMile: majorOrNull(stats.costPerMile),
        currentOdometer,
      },
    });
  }
);

routes.get(
  '/:id/people',
  zValidator('param', commonSchemas.idParam),
  authorize(vehicleParam('id')),
  vehiclePeople
);

export { routes };
