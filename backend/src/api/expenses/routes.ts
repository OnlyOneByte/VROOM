import { stringify } from 'csv-stringify/sync';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { expenses as expensesTable, type NewExpense } from '../../db/schema';
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
  expenseSummaryToApi,
  expenseToApi,
  moneyDollarsToCents,
} from '../../utils/money';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import {
  requireVehicleRead,
  requireVehicleWrite,
  resolveVehicleOwnerId,
} from '../../utils/sharing';
import { commonSchemas, validateFuelExpenseData, zValidator } from '../../utils/validation';
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
} from './import-csv';
import {
  applyMapping,
  CsvMappingError,
  columnMappingSchema,
  type TargetUnits,
} from './import-mapping';
import { detectSource } from './import-mapping-presets';
import { expenseRepository } from './repository';
import {
  createSplitExpenseSchema,
  type SplitConfig,
  splitConfigVehicleIds,
  tagElementSchema,
  updateSplitSchema,
} from './validation';

const routes = new Hono();

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
  // Client sends dollars; storage is integer cents. Volume is not money.
  expenseAmount: moneyDollarsToCents((n) => n.positive('Expense amount must be positive')),
  volume: z.number().positive('Volume must be positive').nullable().optional(),
  date: z.coerce.date(),
  mileage: z.number().int().min(0, 'Mileage cannot be negative').nullable().optional(),
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
  // Only financing links are accepted from the API; insurance and reminder links are written by
  // system paths that bypass this route, so accepting them here would allow unvalidated links.
  sourceType: z.literal('financing').optional(),
  sourceId: z.string().min(1).optional(),
  clientId: z.string().min(1).max(64).optional(),
});

const createExpenseSchemaBase = baseExpenseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  // createdBy is server-set provenance; omitting it closes a forge vector.
  createdBy: true,
  groupId: true,
  groupTotal: true,
  splitMethod: true,
});

const createExpenseSchema = createExpenseSchemaBase
  // Keep-local conflict resolution: on a (userId, clientId) collision, apply the edit instead of
  // returning the stored row.
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

// tags drops the base default: a Zod default survives .partial(), so an update that omits tags
// would otherwise parse to [] and wipe them.
const updateExpenseSchema = createExpenseSchemaBase
  .omit({ clientId: true })
  .partial()
  .extend({
    tags: z.array(tagElementSchema).max(CONFIG.validation.expense.maxTags).optional(),
  })
  // Re-adds the both-or-neither source refine, which does not survive .partial().
  .refine(
    (data) => {
      const hasType = data.sourceType !== undefined;
      const hasId = data.sourceId !== undefined;
      return hasType === hasId;
    },
    {
      message: 'sourceType and sourceId must both be provided or both omitted',
      path: ['sourceType'],
    }
  );

// A stray mileage on a non-fuel row would skew getCurrentOdometer, which reads across categories.
function clearFuelFieldsIfNotFuel<
  T extends {
    category?: string;
    volume?: number | null;
    fuelType?: string | null;
    mileage?: number | null;
    missedFillup?: boolean;
  },
>(data: T, effectiveCategory: string | undefined = data.category): T {
  if (effectiveCategory === undefined || effectiveCategory === 'fuel') return data;
  return { ...data, volume: null, fuelType: null, mileage: null, missedFillup: false };
}

// The financing balance sums expenses by (sourceType, sourceId) with no vehicle scope, so a link
// must point at this vehicle's active financing.
async function assertFinancingSourceValid(
  sourceType: string | undefined,
  sourceId: string | undefined,
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

// Each sibling of a split lands on its own vehicle, so the financing check applies to every one.
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

// Checks write access on every vehicle in the split and returns the owner stamp. A group carries
// one userId, so all vehicles must share a single owner. createdBy is null when the actor owns them.
async function requireSplitWriteAccess(
  splitConfig: SplitConfig,
  actingUserId: string
): Promise<{ ownerId: string; createdBy: string | null }> {
  const vehicleIds = splitConfigVehicleIds(splitConfig);
  let ownerId: string | undefined;
  for (const vehicleId of vehicleIds) {
    await requireVehicleWrite(vehicleId, actingUserId);
    const vehicleOwner = await resolveVehicleOwnerId(vehicleId);
    if (!vehicleOwner) throw new NotFoundError('Vehicle');
    if (ownerId === undefined) {
      ownerId = vehicleOwner;
    } else if (ownerId !== vehicleOwner) {
      throw new ValidationError('A split cannot span vehicles owned by different users');
    }
  }
  if (ownerId === undefined) throw new ValidationError('Split has no vehicles');
  return { ownerId, createdBy: ownerId === actingUserId ? null : actingUserId };
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
  // Enum allowlist so the sort column can never be injected.
  sortBy: z.enum(['date', 'amount', 'category']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.post('/split', zValidator('json', createSplitExpenseSchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  await assertSplitFinancingSourceValid(data.sourceType, data.sourceId, data.splitConfig);

  const { ownerId, createdBy } = await requireSplitWriteAccess(data.splitConfig, user.id);
  const siblings = await expenseRepository.createSplitExpense(data, user.id, ownerId, createdBy);
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

    // The group is loaded by groupId because it is owner-stamped; a userId-scoped read would hide it
    // from a shared editor. Both the existing and the new vehicle sets must be writable.
    const groupInfo = await expenseRepository.getSplitGroupAccessInfo(id);
    if (!groupInfo) throw new NotFoundError('Split expense');
    const existingConfig: SplitConfig = { method: 'even', vehicleIds: groupInfo.vehicleIds };
    await requireSplitWriteAccess(existingConfig, user.id);
    // The new vehicle set must resolve to the group's existing owner so the cost stays in one set of books.
    const { ownerId: newOwnerId, createdBy } = await requireSplitWriteAccess(
      data.splitConfig,
      user.id
    );
    if (newOwnerId !== groupInfo.ownerId) {
      throw new ValidationError('A split cannot be moved to a vehicle owned by a different user');
    }

    // The carried-forward financing link must be re-checked against the new vehicles.
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

  // Photo files and refs are removed here because the repository delete only drops the DB rows.
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
});

routes.get('/summary', zValidator('query', summaryQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, period } = c.req.valid('query');

  // Per-vehicle reads use the owner's rows; cross-fleet reads stay on the acting user's rows to avoid double counting.
  let summaryUserId = user.id;
  if (vehicleId) {
    await requireVehicleRead(vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');
    summaryUserId = ownerId;
  }

  const summary = await expenseRepository.getSummary({
    userId: summaryUserId,
    vehicleId,
    period,
  });

  // Shared with the assistant tool so both report the same figures.
  return c.json({ success: true, data: expenseSummaryToApi(summary) });
});

// Uses the unpaginated findAll so the export is never truncated by the list route's page clamp.
const exportQuerySchema = z.object({
  vehicleId: z.string().optional(),
  category: expenseCategorySchema.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  tags: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((t) => t.trim()) : undefined)),
});

// Exported so a test can check that every column the importer reads is written here.
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
  const { vehicleId, category, startDate, endDate, search, tags } = c.req.valid('query');

  // Per-vehicle exports use the owner's rows; cross-fleet exports stay on the acting user's rows.
  let exportUserId = user.id;
  if (vehicleId) {
    await requireVehicleRead(vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');
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
      search,
      tags,
    }),
    vehicleRepository.findByUserId(user.id),
    isSharedExport && vehicleId ? vehicleRepository.findByIds([vehicleId]) : Promise.resolve([]),
    // Read-only, so an export never creates a preferences row.
    preferencesRepository.getByUserId(user.id),
  ]);

  const currency = prefs?.currencyUnit || 'USD';

  const vehicleName = new Map(
    [...vehicles, ...sharedVehicles].map((v) => [
      v.id,
      v.nickname || `${v.year} ${v.make} ${v.model}`,
    ])
  );

  // Neutralizes spreadsheet formula injection in text cells. Safe to prefix because nothing re-parses this export.
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

// CSV text travels in the JSON body. Vehicles are resolved by name within the user's own garage.
const importBodySchema = importCsvSchema.extend({
  mapping: columnMappingSchema.optional(),
});

// Returns {} when no vehicle matches, so values pass through rather than converting toward a guessed unit.
function resolveTargetUnits(
  targetVehicle: string | undefined,
  vehicles: Awaited<ReturnType<typeof vehicleRepository.findByUserId>>
): TargetUnits {
  if (!targetVehicle) return {};
  const wanted = targetVehicle.trim().toLowerCase();
  const match = vehicles.find(
    (v) =>
      v.nickname?.toLowerCase() === wanted ||
      `${v.year} ${v.make} ${v.model}`.toLowerCase() === wanted
  );
  if (!match) return {};
  return {
    distanceUnit: match.unitPreferences.distanceUnit,
    volumeUnit: match.unitPreferences.volumeUnit,
  };
}

routes.post('/import', zValidator('json', importBodySchema), async (c) => {
  const user = c.get('user');
  const { csv, dryRun, mapping } = c.req.valid('json');

  const vehicles = await vehicleRepository.findByUserId(user.id);
  if (vehicles.length === 0) {
    throw new ValidationError('Add a vehicle before importing expenses');
  }

  // Without a target vehicle, units are not converted: a multi-vehicle file may mix units.
  let importCsv = csv;
  let unmappedCategories: string[] = [];
  if (mapping) {
    const target = resolveTargetUnits(mapping.targetVehicle, vehicles);
    try {
      if (mapping.source === 'fuelio') {
        // Fuelio's multi-section export cannot go through the single-header column mapper.
        const result = parseFuelioExport(csv, {
          targetVehicle: mapping.targetVehicle ?? '',
          targetUnits: target,
          includeCosts: true,
        });
        importCsv = result.csv;
        unmappedCategories = result.unmappedCategories;
      } else {
        const result = applyMapping(csv, mapping, target);
        importCsv = result.csv;
        unmappedCategories = result.unmappedCategories;
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
    plan = buildImportPlan(importCsv, vehicles);
  } catch (err) {
    if (err instanceof CsvImportError) throw new ValidationError(err.message);
    throw err;
  }

  if (dryRun) {
    return c.json({
      success: true,
      data: { dryRun: true, imported: 0, unmappedCategories, ...summarizeImportPlan(plan) },
    });
  }

  // Idempotent via deterministic clientIds, so re-importing the same file counts rows as duplicates.
  const readyRows = plan.rows
    .filter((row) => row.status === 'ready' && row.expense)
    .map((row) => ({ ...row.expense, userId: user.id }) as NewExpense);
  const { imported, duplicates } = await expenseRepository.importExpenses(readyRows, user.id);

  return c.json({
    success: true,
    data: { dryRun: false, imported, duplicates, unmappedCategories, ...summarizeImportPlan(plan) },
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
  const expenseData = clearFuelFieldsIfNotFuel(body);

  await requireVehicleWrite(expenseData.vehicleId, user.id);

  // Rows are stamped with the vehicle owner's id so shared-editor entries count once in the owner's books.
  // createdBy records the actual author when that is not the owner.
  const ownerId = await resolveVehicleOwnerId(expenseData.vehicleId);
  if (!ownerId) throw new NotFoundError('Vehicle');
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

  // A retried offline POST with the same clientId returns the original row. forceOverwrite applies the edit instead.
  const createdExpense = await expenseRepository.createIdempotent(
    {
      ...expenseData,
      userId: ownerId,
      createdBy,
    },
    forceOverwrite ?? false
  );

  // A mileage reading can cross a reminder milestone; recheck so it fires immediately.
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

// GET /api/expenses - Get all expenses for the user (with optional vehicle filter)
routes.get('/', zValidator('query', expenseQuerySchema), async (c) => {
  const user = c.get('user');
  const query = c.req.valid('query');

  // Per-vehicle reads use the owner's rows, since shared rows are owner-stamped. Cross-fleet reads
  // stay on the acting user's rows so shared costs are not double counted.
  let listUserId = user.id;
  if (query.vehicleId) {
    await requireVehicleRead(query.vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(query.vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');
    listUserId = ownerId;
  }

  const { data, totalCount } = await expenseRepository.findPaginated({
    userId: listUserId,
    vehicleId: query.vehicleId,
    category: query.category,
    startDate: query.startDate,
    endDate: query.endDate,
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
  // Loaded by id because rows are owner-stamped; access is checked through the vehicle.
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

    // Reassignment needs write access to the target and the same owner, since rows carry the owner's id.
    if (updateData.vehicleId && updateData.vehicleId !== existingExpense.vehicleId) {
      await requireVehicleWrite(updateData.vehicleId, user.id);
      const targetOwnerId = await resolveVehicleOwnerId(updateData.vehicleId);
      if (targetOwnerId !== existingExpense.userId) {
        throw new ValidationError('Cannot move an expense to a vehicle owned by a different user');
      }
    }

    // A forged sourceId on update would corrupt the loan balance, so it is validated as on create.
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

    // Keyed on the effective category so a non-fuel row cannot keep a stray mileage.
    const normalizedUpdate = clearFuelFieldsIfNotFuel(updateData, finalCategory);

    const updatedExpense = await expenseRepository.update(id, normalizedUpdate);

    // An edit can also cross a reminder milestone, so it rechecks like create does.
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

  // Photos have no foreign key to the expense, so they are removed explicitly before the row.
  await deleteAllPhotosForEntity('expense', id, existingExpense.userId);

  await expenseRepository.delete(id);
  return c.json({ success: true, message: 'Expense deleted successfully' });
});

export { routes };
