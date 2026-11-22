import { stringify } from 'csv-stringify/sync';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { type Expense, expenses as expensesTable, type NewExpense } from '../../db/schema';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DESCRIPTIONS,
  EXPENSE_CATEGORY_LABELS,
} from '../../db/types';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { neutralizeCsvRow } from '../../utils/csv-safety';
import {
  centsToDollars,
  expenseDollarsToCents,
  expenseSummaryToApi,
  expenseToApi,
} from '../../utils/money';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import {
  requireVehicleOwnerScope,
  requireVehicleRead,
  requireVehicleWrite,
  resolveVehicleOwnerId,
} from '../../utils/sharing';
import { isValidTimeZone, zonedDayWindow } from '../../utils/time-zone';
import {
  commonSchemas,
  dateInput,
  MAX_ODOMETER_READING,
  ODOMETER_TOO_HIGH_MESSAGE,
  VOLUME_TOO_HIGH_MESSAGE,
  validateFuelExpenseData,
  WHOLE_DISTANCE_MESSAGE,
  zValidator,
} from '../../utils/validation';
import { financingRepository } from '../financing/repository';
import { deleteAllPhotosForEntity, deletePhotosForEntities } from '../photos/photo-service';
import { reminderTriggerService } from '../reminders/trigger-service';
import { preferencesRepository } from '../settings/repository';
import { vehicleRepository } from '../vehicles/repository';
import { FuelioParseError, parseFuelioExport } from './fuelio-import';
import {
  buildImportPlan,
  CsvImportError,
  importCsvSchema,
  summarizeImportPlan,
  vehicleNameKey,
} from './import-csv';
import {
  applyMapping,
  CsvMappingError,
  columnMappingSchema,
  type TargetUnitsResolver,
} from './import-mapping';
import { detectSource } from './import-mapping-presets';
import { expenseRepository } from './repository';
import {
  clearFuelFieldsIfNotFuel,
  createSplitExpenseSchema,
  odometerOrderError,
  type SplitConfig,
  splitConfigVehicleIds,
  tagElementSchema,
  updateSplitSchema,
} from './validation';

const routes = new Hono();

async function assertOdometerInOrder(
  vehicleId: string,
  mileage: number | null | undefined,
  date: Date,
  excludeId?: string
): Promise<void> {
  if (mileage == null) return;
  const [vehicle, neighbours] = await Promise.all([
    vehicleRepository.findById(vehicleId),
    expenseRepository.findOdometerNeighbours(vehicleId, zonedDayWindow(date, 'UTC'), excludeId),
  ]);
  const error = odometerOrderError(mileage, neighbours, vehicle?.initialMileage);
  if (error) throw new ValidationError(error);
}

async function assertEditedOdometerInOrder(
  existing: Expense,
  next: { vehicleId: string; date: Date; mileage: number | null | undefined; category: string }
): Promise<void> {
  if (next.category !== 'fuel') return;
  const unchanged =
    next.vehicleId === existing.vehicleId &&
    next.date.getTime() === existing.date.getTime() &&
    next.mileage === existing.mileage &&
    next.category === existing.category;
  if (unchanged) return;
  await assertOdometerInOrder(next.vehicleId, next.mileage, next.date, existing.id);
}

const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

const baseExpenseSchema = createInsertSchema(expensesTable, {
  tags: z
    .array(tagElementSchema)
    .max(
      CONFIG.validation.expense.maxTags,
      `Maximum ${CONFIG.validation.expense.maxTags} tags allowed`
    )
    .optional()
    .default([]),
  category: expenseCategorySchema,
  expenseAmount: expenseDollarsToCents((n) => n.positive('Expense amount must be positive')),
  volume: z
    .number()
    .positive('Volume must be positive')
    .max(CONFIG.validation.expense.maxVolume, VOLUME_TOO_HIGH_MESSAGE)
    .nullable()
    .optional(),
  date: dateInput,
  mileage: z
    .number()
    .int(WHOLE_DISTANCE_MESSAGE)
    .min(0, 'Mileage cannot be negative')
    .max(MAX_ODOMETER_READING, ODOMETER_TOO_HIGH_MESSAGE)
    .nullable()
    .optional(),
  description: z
    .string()
    .max(
      CONFIG.validation.expense.descriptionMaxLength,
      `Description must be ${CONFIG.validation.expense.descriptionMaxLength} characters or less`
    )
    .nullish(),
  location: z
    .string()
    .max(
      CONFIG.validation.expense.locationMaxLength,
      `Location must be ${CONFIG.validation.expense.locationMaxLength} characters or less`
    )
    .nullish(),
  fuelType: z
    .string()
    .max(
      CONFIG.validation.expense.fuelTypeMaxLength,
      `Fuel type must be ${CONFIG.validation.expense.fuelTypeMaxLength} characters or less`
    )
    .nullish(),
  // Insurance and reminder links bypass this route's validation, so only financing links are accepted.
  sourceType: z.literal('financing').optional(),
  sourceId: z.string().min(1).optional(),
  clientId: z.string().min(1).max(64).optional(),
});

const createExpenseSchemaBase = baseExpenseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  // createdBy is server-set; accepting it from the client would allow forged authorship.
  createdBy: true,
  groupId: true,
  groupTotal: true,
  splitMethod: true,
});

const createExpenseSchema = createExpenseSchemaBase
  .extend({ forceOverwrite: z.boolean().optional() })
  .refine(
    (data) => {
      const hasType = !!data.sourceType;
      const hasId = !!data.sourceId;
      return hasType === hasId;
    },
    {
      message: 'sourceType and sourceId must both be provided or both omitted',
      path: ['sourceType'],
    }
  );

// Zod .default() survives .partial(), so an omitted tags field would parse to [] and wipe them.
const updateExpenseSchema = createExpenseSchemaBase
  .omit({ clientId: true })
  .partial()
  .extend({
    tags: z.array(tagElementSchema).max(CONFIG.validation.expense.maxTags).optional(),
    sourceType: z.literal('financing').nullable().optional(),
    sourceId: z.string().min(1).nullable().optional(),
  })
  // Zod refinements do not survive .partial().
  .refine(
    (data) =>
      (data.sourceType === undefined) === (data.sourceId === undefined) &&
      (data.sourceType === null) === (data.sourceId === null),
    {
      message: 'sourceType and sourceId must both be provided or both omitted',
      path: ['sourceType'],
    }
  );

const INSURANCE_EDITABLE_FIELDS = new Set(['description', 'tags']);
const SPLIT_LEG_LOCKED_FIELDS = new Set(['expenseAmount', 'vehicleId', 'date', 'category']);

function comparableValue(value: unknown): string {
  if (value instanceof Date) return String(Math.floor(value.getTime() / 1000));
  return JSON.stringify(value ?? null);
}

function changedFields(update: Record<string, unknown>, existing: Expense): string[] {
  return Object.entries(update)
    .filter(
      ([field, value]) =>
        value !== undefined &&
        comparableValue(value) !== comparableValue(existing[field as keyof Expense])
    )
    .map(([field]) => field);
}

function assertSingleExpenseEditAllowed(update: Record<string, unknown>, existing: Expense): void {
  const changed = changedFields(update, existing);
  if (
    existing.sourceType === 'insurance_term' &&
    changed.some((field) => !INSURANCE_EDITABLE_FIELDS.has(field))
  ) {
    throw new ValidationError(
      'This expense is managed by an insurance term. Edit the term to change it; only the description and tags can be edited here.'
    );
  }
  if (existing.groupId && changed.some((field) => field === 'sourceType' || field === 'sourceId')) {
    throw new ValidationError(
      'This expense is part of a split, so its financing link is set for the whole split.'
    );
  }
  if (existing.groupId && changed.some((field) => SPLIT_LEG_LOCKED_FIELDS.has(field))) {
    throw new ValidationError(
      'This expense is part of a split, so its amount, vehicle, date and category are set for the whole split. Edit the split to change the amount or vehicles, or delete and re-create it to change the date or category.'
    );
  }
  if (
    existing.sourceType === 'financing' &&
    update.vehicleId !== undefined &&
    update.vehicleId !== existing.vehicleId &&
    update.sourceType === undefined
  ) {
    throw new ValidationError(
      "This payment is linked to the current vehicle's financing. Remove the link, or link the new vehicle's financing, to move it."
    );
  }
}

async function assertFinancingSourceValid(
  sourceType: string | null | undefined,
  sourceId: string | null | undefined,
  vehicleId: string
): Promise<void> {
  if (sourceType !== 'financing') return;
  const financing = await financingRepository.findByVehicleId(vehicleId);
  if (!financing?.isActive) {
    throw new ValidationError('Vehicle has no active financing');
  }
  if (sourceId !== financing.id) {
    throw new ValidationError('Source ID does not match the active financing record');
  }
}

async function assertSplitFinancingSourceValid(
  sourceType: string | undefined,
  sourceId: string | undefined,
  splitConfig: SplitConfig
): Promise<void> {
  if (sourceType !== 'financing') return;
  for (const vehicleId of splitConfigVehicleIds(splitConfig)) {
    await assertFinancingSourceValid(sourceType, sourceId, vehicleId);
  }
}

async function requireSplitWriteAccess(
  splitConfig: SplitConfig,
  actingUserId: string
): Promise<{ ownerId: string; createdBy: string | null }> {
  const vehicleIds = splitConfigVehicleIds(splitConfig);
  let ownerId: string | undefined;
  for (const vehicleId of vehicleIds) {
    const vehicleOwner = await requireVehicleOwnerScope(vehicleId, actingUserId, 'write');
    if (ownerId === undefined) {
      ownerId = vehicleOwner;
    } else if (ownerId !== vehicleOwner) {
      throw new ValidationError('A split cannot span vehicles owned by different users');
    }
  }
  if (ownerId === undefined) throw new ValidationError('Split has no vehicles');
  return { ownerId, createdBy: ownerId === actingUserId ? null : actingUserId };
}

const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;

function plainDayFilters(
  startDate: string | undefined,
  endDate: string | undefined
): { startDateIsDay: boolean; endDateIsDay: boolean } {
  return {
    startDateIsDay: startDate !== undefined && PLAIN_DAY.test(startDate),
    endDateIsDay: endDate !== undefined && PLAIN_DAY.test(endDate),
  };
}

export const expenseQuerySchema = z.object({
  vehicleId: z.string().optional(),
  tags: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((t) => t.trim()) : undefined)),
  category: expenseCategorySchema.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  timeZone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .optional(),
  offset: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(0))
    .optional(),
  sortBy: z.enum(['date', 'amount', 'category']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.post('/split', zValidator('json', createSplitExpenseSchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  const { ownerId, createdBy } = await requireSplitWriteAccess(data.splitConfig, user.id);
  await assertSplitFinancingSourceValid(data.sourceType, data.sourceId, data.splitConfig);

  const siblings = await expenseRepository.createSplitExpense(data, { ownerId, createdBy });
  const first = siblings[0];
  if (!first?.groupId || first.groupTotal == null || !first.splitMethod) {
    throw new ValidationError('Split expense creation returned invalid data');
  }

  return c.json(
    {
      success: true,
      data: {
        siblings: siblings.map(expenseToApi),
        groupId: first.groupId,
        groupTotal: centsToDollars(first.groupTotal),
        splitMethod: first.splitMethod,
      },
      message: 'Split expense created successfully',
    },
    201
  );
});

routes.put(
  '/split/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateSplitSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    const groupInfo = await expenseRepository.getSplitGroupAccessInfo(id);
    if (!groupInfo) throw new NotFoundError('Split expense');
    const existingConfig: SplitConfig = { method: 'even', vehicleIds: groupInfo.vehicleIds };
    await requireSplitWriteAccess(existingConfig, user.id);
    const { ownerId: newOwnerId, createdBy } = await requireSplitWriteAccess(
      data.splitConfig,
      user.id
    );
    if (newOwnerId !== groupInfo.ownerId) {
      throw new ValidationError('A split cannot be moved to a vehicle owned by a different user');
    }

    const existing = await expenseRepository.getSplitExpense(id, groupInfo.ownerId);
    await assertSplitFinancingSourceValid(
      existing[0]?.sourceType ?? undefined,
      existing[0]?.sourceId ?? undefined,
      data.splitConfig
    );

    const siblings = await expenseRepository.updateSplitExpense(
      id,
      data,
      groupInfo.ownerId,
      createdBy
    );
    const first = siblings[0];
    if (!first?.groupId || first.groupTotal == null || !first.splitMethod) {
      throw new ValidationError('Split expense update returned invalid data');
    }

    return c.json({
      success: true,
      data: {
        siblings: siblings.map(expenseToApi),
        groupId: first.groupId,
        groupTotal: centsToDollars(first.groupTotal),
        splitMethod: first.splitMethod,
      },
      message: 'Split expense updated successfully',
    });
  }
);

routes.get('/split/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const groupInfo = await expenseRepository.getSplitGroupAccessInfo(id);
  if (!groupInfo) throw new NotFoundError('Split expense');
  for (const vehicleId of groupInfo.vehicleIds) {
    await requireVehicleRead(vehicleId, user.id);
  }

  const siblings = await expenseRepository.getSplitExpense(id, groupInfo.ownerId);
  const first = siblings[0];
  if (!first?.groupId || first.groupTotal == null || !first.splitMethod) {
    throw new ValidationError('Split expense data is invalid');
  }

  return c.json({
    success: true,
    data: {
      siblings: siblings.map(expenseToApi),
      groupId: first.groupId,
      groupTotal: centsToDollars(first.groupTotal),
      splitMethod: first.splitMethod,
    },
  });
});

routes.delete('/split/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const groupInfo = await expenseRepository.getSplitGroupAccessInfo(id);
  if (!groupInfo) throw new NotFoundError('Split expense');
  await requireSplitWriteAccess({ method: 'even', vehicleIds: groupInfo.vehicleIds }, user.id);

  const siblingIds = await expenseRepository.findIdsByGroupId(id, groupInfo.ownerId);
  await deletePhotosForEntities('expense', siblingIds, groupInfo.ownerId);

  await expenseRepository.deleteSplitExpense(id, groupInfo.ownerId);

  return c.json({ success: true, message: 'Split expense deleted successfully' });
});

routes.get('/categories', async (c) => {
  return c.json({
    success: true,
    data: EXPENSE_CATEGORIES.map((category) => ({
      value: category,
      label: EXPENSE_CATEGORY_LABELS[category],
      description: EXPENSE_CATEGORY_DESCRIPTIONS[category],
    })),
  });
});

routes.get(
  '/vehicle-stats',
  zValidator(
    'query',
    z.object({
      recentDays: z
        .string()
        .transform((v) => parseInt(v, 10))
        .pipe(z.number().int().min(1).max(365))
        .optional(),
    })
  ),
  async (c) => {
    const user = c.get('user');
    const { recentDays } = c.req.valid('query');
    const stats = await expenseRepository.getPerVehicleStats(user.id, recentDays);
    return c.json({
      success: true,
      data: stats.map((s) => ({
        ...s,
        totalAmount: centsToDollars(s.totalAmount),
        recentAmount: centsToDollars(s.recentAmount),
      })),
    });
  }
);

const summaryQuerySchema = z.object({
  vehicleId: z.string().optional(),
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('all'),
  timeZone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional(),
});

routes.get('/summary', zValidator('query', summaryQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, period, timeZone } = c.req.valid('query');

  let summaryUserId = user.id;
  if (vehicleId) {
    const ownerId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');
    summaryUserId = ownerId;
  }

  const summary = await expenseRepository.getSummary({
    userId: summaryUserId,
    vehicleId,
    period,
    timeZone,
  });

  return c.json({ success: true, data: expenseSummaryToApi(summary) });
});

const exportQuerySchema = z.object({
  vehicleId: z.string().optional(),
  category: expenseCategorySchema.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  timeZone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional(),
  search: z.string().trim().min(1).max(100).optional(),
  tags: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((t) => t.trim()) : undefined)),
});

export const EXPORT_COLUMNS = [
  'date',
  'vehicle',
  'category',
  'amount',
  'currency',
  'mileage',
  'volume',
  'fuelType',
  'description',
  'location',
  'tags',
  'missedFillup',
  'createdAt',
] as const;

routes.get('/export', zValidator('query', exportQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, category, startDate, endDate, timeZone, search, tags } = c.req.valid('query');
  const plainDays = plainDayFilters(c.req.query('startDate'), c.req.query('endDate'));

  let exportUserId = user.id;
  if (vehicleId) {
    const ownerId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');
    exportUserId = ownerId;
  }

  const isSharedExport = exportUserId !== user.id;
  const [rows, vehicles, sharedVehicles, prefs] = await Promise.all([
    expenseRepository.findAll({
      userId: exportUserId,
      vehicleId,
      category,
      startDate,
      endDate,
      timeZone,
      ...plainDays,
      search,
      tags,
    }),
    vehicleRepository.findByUserId(user.id),
    isSharedExport && vehicleId ? vehicleRepository.findByIds([vehicleId]) : Promise.resolve([]),
    preferencesRepository.getByUserId(user.id),
  ]);

  const currency = prefs?.currencyUnit || 'USD';

  const vehicleName = new Map(
    [...vehicles, ...sharedVehicles].map((v) => [
      v.id,
      v.nickname || `${v.year} ${v.make} ${v.model}`,
    ])
  );

  // Safe to prefix formula characters only because nothing re-parses this export.
  const records = rows.map((e) =>
    neutralizeCsvRow({
      date: e.date instanceof Date ? e.date.toISOString() : e.date,
      vehicle: vehicleName.get(e.vehicleId) ?? 'Unknown Vehicle',
      category: e.category,
      amount: centsToDollars(e.expenseAmount),
      currency,
      mileage: e.mileage ?? '',
      volume: e.volume ?? '',
      fuelType: e.fuelType ?? '',
      description: e.description ?? '',
      location: e.location ?? '',
      tags: Array.isArray(e.tags) ? e.tags.join('; ') : '',
      missedFillup: e.missedFillup ? 'true' : 'false',
      createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : (e.createdAt ?? ''),
    })
  );

  const csv = stringify(records, {
    header: true,
    columns: EXPORT_COLUMNS as unknown as string[],
    quoted: true,
    quoted_empty: false,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="vroom-expenses-${stamp}.csv"`);
  return c.body(csv);
});

const importBodySchema = importCsvSchema.extend({
  mapping: columnMappingSchema.optional(),
});

function targetUnitsResolver(
  vehicles: Awaited<ReturnType<typeof vehicleRepository.findByUserId>>
): TargetUnitsResolver {
  return (vehicleName) => {
    const wanted = vehicleNameKey(vehicleName);
    const match = vehicles.find(
      (v) =>
        (v.nickname && vehicleNameKey(v.nickname) === wanted) ||
        vehicleNameKey(`${v.year} ${v.make} ${v.model}`) === wanted
    );
    if (!match) return {};
    return {
      distanceUnit: match.unitPreferences.distanceUnit,
      volumeUnit: match.unitPreferences.volumeUnit,
    };
  };
}

routes.post('/import', zValidator('json', importBodySchema), async (c) => {
  const user = c.get('user');
  const { csv, dryRun, mapping, timeZone } = c.req.valid('json');

  const vehicles = await vehicleRepository.findByUserId(user.id);
  if (vehicles.length === 0) {
    throw new ValidationError('Add a vehicle before importing expenses');
  }
  const { currencyUnit: accountCurrency } = await preferencesRepository.getOrCreate(user.id);

  let importCsv = csv;
  let unmappedCategories: string[] = [];
  let rowErrors = new Map<number, string>();
  if (mapping) {
    const targetUnitsFor = targetUnitsResolver(vehicles);
    try {
      if (mapping.source === 'fuelio') {
        // Fuelio's multi-section export cannot go through the single-header column mapper.
        const result = parseFuelioExport(csv, {
          targetVehicle: mapping.targetVehicle ?? '',
          targetUnits: targetUnitsFor(mapping.targetVehicle ?? ''),
          includeCosts: true,
          timeZone,
        });
        importCsv = result.csv;
        unmappedCategories = result.unmappedCategories;
      } else {
        const result = applyMapping(csv, mapping, targetUnitsFor, timeZone);
        importCsv = result.csv;
        unmappedCategories = result.unmappedCategories;
        rowErrors = result.rowErrors;
      }
    } catch (err) {
      if (err instanceof CsvMappingError || err instanceof FuelioParseError) {
        throw new ValidationError(err.message);
      }
      throw err;
    }
  }

  let plan: ReturnType<typeof buildImportPlan>;
  try {
    plan = buildImportPlan(importCsv, vehicles, rowErrors, timeZone);
  } catch (err) {
    if (err instanceof CsvImportError) throw new ValidationError(err.message);
    throw err;
  }

  if (dryRun) {
    return c.json({
      success: true,
      data: {
        dryRun: true,
        imported: 0,
        unmappedCategories,
        ...summarizeImportPlan(plan, accountCurrency),
      },
    });
  }

  const readyRows = plan.rows
    .filter((row) => row.status === 'ready' && row.expense)
    .map((row) => ({ ...row.expense, userId: user.id }) as NewExpense);
  const { imported, duplicates } = await expenseRepository.importExpenses(readyRows, user.id);

  return c.json({
    success: true,
    data: {
      dryRun: false,
      imported,
      duplicates,
      unmappedCategories,
      ...summarizeImportPlan(plan, accountCurrency),
    },
  });
});

const detectSourceSchema = z.object({
  headers: z.array(z.string().max(200)).min(1).max(100),
});
routes.post('/import/detect', zValidator('json', detectSourceSchema), (c) => {
  const { headers } = c.req.valid('json');
  const preset = detectSource(headers);
  return c.json({ success: true, data: preset });
});

routes.post('/', zValidator('json', createExpenseSchema), async (c) => {
  const user = c.get('user');
  const { forceOverwrite, ...body } = c.req.valid('json');
  if (forceOverwrite) {
    throw new ValidationError(
      'forceOverwrite is no longer supported. Overwrite the expense with PUT /api/v1/expenses/:id.'
    );
  }
  const expenseData = clearFuelFieldsIfNotFuel(body);

  const ownerId = await requireVehicleOwnerScope(expenseData.vehicleId, user.id, 'write');
  const createdBy = ownerId === user.id ? null : user.id;

  await assertFinancingSourceValid(
    expenseData.sourceType,
    expenseData.sourceId,
    expenseData.vehicleId
  );

  validateFuelExpenseData(
    expenseData.category,
    expenseData.mileage,
    expenseData.volume,
    expenseData.fuelType
  );

  const replay = expenseData.clientId
    ? await expenseRepository.findByClientId(expenseData.clientId, ownerId)
    : null;
  if (!replay) {
    await assertOdometerInOrder(expenseData.vehicleId, expenseData.mileage, expenseData.date);
  }

  const createdExpense = await expenseRepository.createIdempotent({
    ...expenseData,
    userId: ownerId,
    createdBy,
  });

  if (createdExpense.mileage != null) {
    await reminderTriggerService.recheckMileageReminders(ownerId, createdExpense.vehicleId);
  }

  return c.json(
    {
      success: true,
      data: expenseToApi(createdExpense),
      message: 'Expense created successfully',
    },
    201
  );
});

routes.get('/', zValidator('query', expenseQuerySchema), async (c) => {
  const user = c.get('user');
  const query = c.req.valid('query');

  let listUserId = user.id;
  if (query.vehicleId) {
    const ownerId = await requireVehicleOwnerScope(query.vehicleId, user.id, 'read');
    listUserId = ownerId;
  }

  const { data, totalCount } = await expenseRepository.findPaginated({
    userId: listUserId,
    vehicleId: query.vehicleId,
    category: query.category,
    startDate: query.startDate,
    endDate: query.endDate,
    timeZone: query.timeZone,
    ...plainDayFilters(c.req.query('startDate'), c.req.query('endDate')),
    tags: query.tags,
    search: query.search,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
    limit: query.limit,
    offset: query.offset,
  });

  const { limit, offset } = clampPagination(query);

  return c.json(buildPaginatedResponse(data.map(expenseToApi), totalCount, limit, offset));
});

routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const expense = await expenseRepository.findById(id);
  if (!expense) throw new NotFoundError('Expense');
  await requireVehicleRead(expense.vehicleId, user.id);
  return c.json({ success: true, data: expenseToApi(expense) });
});

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateExpenseSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const updateData = c.req.valid('json');

    const existingExpense = await expenseRepository.findById(id);
    if (!existingExpense) throw new NotFoundError('Expense');
    await requireVehicleWrite(existingExpense.vehicleId, user.id);
    assertSingleExpenseEditAllowed(updateData, existingExpense);
    if (
      updateData.sourceType === null &&
      existingExpense.sourceType !== null &&
      existingExpense.sourceType !== 'financing'
    ) {
      throw new ValidationError('Only a financing link can be removed from an expense');
    }

    if (updateData.vehicleId && updateData.vehicleId !== existingExpense.vehicleId) {
      await requireVehicleWrite(updateData.vehicleId, user.id);
      const targetOwnerId = await resolveVehicleOwnerId(updateData.vehicleId);
      if (targetOwnerId !== existingExpense.userId) {
        throw new ValidationError('Cannot move an expense to a vehicle owned by a different user');
      }
    }

    await assertFinancingSourceValid(
      updateData.sourceType,
      updateData.sourceId,
      updateData.vehicleId ?? existingExpense.vehicleId
    );

    const finalCategory =
      updateData.category !== undefined ? updateData.category : existingExpense.category;
    const finalMileage =
      updateData.mileage !== undefined ? updateData.mileage : existingExpense.mileage;
    const finalVolume =
      updateData.volume !== undefined ? updateData.volume : existingExpense.volume;
    const finalFuelType =
      updateData.fuelType !== undefined ? updateData.fuelType : existingExpense.fuelType;

    validateFuelExpenseData(finalCategory, finalMileage, finalVolume, finalFuelType);

    const normalizedUpdate = clearFuelFieldsIfNotFuel(updateData, finalCategory);
    await assertEditedOdometerInOrder(existingExpense, {
      vehicleId: updateData.vehicleId ?? existingExpense.vehicleId,
      date: updateData.date ?? existingExpense.date,
      mileage: finalMileage,
      category: finalCategory,
    });

    const updatedExpense = await expenseRepository.update(id, normalizedUpdate);

    if (updatedExpense.mileage != null) {
      await reminderTriggerService.recheckMileageReminders(
        existingExpense.userId,
        updatedExpense.vehicleId
      );
    }

    return c.json({
      success: true,
      data: expenseToApi(updatedExpense),
      message: 'Expense updated successfully',
    });
  }
);

routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const existingExpense = await expenseRepository.findById(id);
  if (!existingExpense) throw new NotFoundError('Expense');
  await requireVehicleWrite(existingExpense.vehicleId, user.id);
  if (existingExpense.groupId) {
    throw new ValidationError(
      "This expense is part of a split. Delete the whole split instead of one vehicle's share."
    );
  }

  await deleteAllPhotosForEntity('expense', id, existingExpense.userId);

  await expenseRepository.delete(id);
  return c.json({ success: true, message: 'Expense deleted successfully' });
});

export { routes };
