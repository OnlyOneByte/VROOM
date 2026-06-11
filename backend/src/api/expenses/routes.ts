import { zValidator } from '@hono/zod-validator';
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
import { ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { neutralizeCsvRow } from '../../utils/csv-safety';
import { buildPaginatedResponse } from '../../utils/pagination';
import {
  commonSchemas,
  validateExpenseOwnership,
  validateFuelExpenseData,
  validateVehicleOwnership,
} from '../../utils/validation';
import { financingRepository } from '../financing/repository';
import { deleteAllPhotosForEntity, deletePhotosForEntities } from '../photos/photo-service';
import { reminderTriggerService } from '../reminders/trigger-service';
import { preferencesRepository } from '../settings/repository';
import { vehicleRepository } from '../vehicles/repository';
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
import { createSplitExpenseSchema, updateSplitSchema } from './validation';

const routes = new Hono();

// Validation schemas derived from db schema
const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

const baseExpenseSchema = createInsertSchema(expensesTable, {
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(
          CONFIG.validation.expense.tagMaxLength,
          `Tag must be ${CONFIG.validation.expense.tagMaxLength} characters or less`
        )
    )
    .max(
      CONFIG.validation.expense.maxTags,
      `Maximum ${CONFIG.validation.expense.maxTags} tags allowed`
    )
    .optional()
    .default([]),
  category: expenseCategorySchema,
  expenseAmount: z.number().positive('Expense amount must be positive'),
  volume: z.number().positive('Volume must be positive').nullable().optional(),
  date: z.coerce.date(),
  mileage: z.number().int().min(0, 'Mileage cannot be negative').nullable().optional(),
  description: z
    .string()
    .max(
      CONFIG.validation.expense.descriptionMaxLength,
      `Description must be ${CONFIG.validation.expense.descriptionMaxLength} characters or less`
    )
    // .nullish() (not .optional()) so an edit can send description:null to CLEAR
    // it — the clear-optional-field class (cycles 82-85). BaseRepository.update
    // writes null through to the column; undefined is still dropped (create omits it).
    .nullish(),
  // Manual create/update accepts ONLY 'financing' as a source link — and the POST handler fully
  // validates it (the referenced financing exists, is active, and sourceId matches). 'insurance_term'
  // + 'reminder' expenses are created EXCLUSIVELY by system paths that bypass this route (insurance
  // hooks via createSplitExpense; the reminder trigger via a direct tx.insert), so accepting them here
  // was pure over-permissiveness: a hand-crafted POST/PUT could forge an UNVALIDATED insurance_term/
  // reminder link on the caller's own row (#62 — within-tenant integrity: skews source-bucketed
  // analytics, and a real matching sourceId would cascade-delete the manual expense when its parent is
  // removed). Restricting the enum to 'financing' closes that with zero impact on the system paths.
  sourceType: z.literal('financing').optional(),
  sourceId: z.string().min(1).optional(),
  // Offline idempotency key — client-generated UUID. Optional; present only for
  // expenses created via the offline outbox.
  clientId: z.string().min(1).max(64).optional(),
});

const createExpenseSchemaBase = baseExpenseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  groupId: true,
  groupTotal: true,
  splitMethod: true,
});

const createExpenseSchema = createExpenseSchemaBase.refine(
  (data) => {
    // Enforce both-or-neither for source fields
    const hasType = !!data.sourceType;
    const hasId = !!data.sourceId;
    return hasType === hasId;
  },
  { message: 'sourceType and sourceId must both be provided or both omitted', path: ['sourceType'] }
);

// clientId is a create-only idempotency key; it must not be mutable via update.
// `tags` is overridden to drop the base `.default([])`: a Zod `.default()` SURVIVES `.partial()`, so
// without this an update that OMITS tags would parse to `{ tags: [] }` and silently WIPE a tagged
// expense's tags on any unrelated edit (e.g. changing just the amount). Re-declaring it as a plain
// optional (no default) means an omitted `tags` stays undefined → dropped by the update, preserving
// the stored value; an explicit array still replaces. (Data-loss class from C31; guarded cycle 34.)
const updateExpenseSchema = createExpenseSchemaBase
  .omit({ clientId: true })
  .partial()
  .extend({
    tags: z
      .array(z.string().min(1).max(CONFIG.validation.expense.tagMaxLength))
      .max(CONFIG.validation.expense.maxTags)
      .optional(),
  });

// Exported so the query-contract (search/limit/tags coercion) can be unit-tested
// at the route boundary without standing up a server.
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
  // Sort is an enum allowlist (not a free column name) so it can never inject;
  // both default server-side (date desc) when omitted, preserving prior behavior.
  sortBy: z.enum(['date', 'amount', 'category']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

// Apply authentication and change tracking to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// ===========================================================================
// Split expense routes (must be before /:id to avoid path conflicts)
// ===========================================================================

// POST /api/expenses/split — Create split expense as sibling rows
routes.post('/split', zValidator('json', createSplitExpenseSchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  const siblings = await expenseRepository.createSplitExpense(data, user.id);
  const first = siblings[0];
  if (!first?.groupId || first.groupTotal == null || !first.splitMethod) {
    throw new ValidationError('Split expense creation returned invalid data');
  }

  return c.json(
    {
      success: true,
      data: {
        siblings,
        groupId: first.groupId,
        groupTotal: first.groupTotal,
        splitMethod: first.splitMethod,
      },
      message: 'Split expense created successfully',
    },
    201
  );
});

// PUT /api/expenses/split/:id — Update split config, regenerate siblings
routes.put(
  '/split/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateSplitSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    const siblings = await expenseRepository.updateSplitExpense(id, data, user.id);
    const first = siblings[0];
    if (!first?.groupId || first.groupTotal == null || !first.splitMethod) {
      throw new ValidationError('Split expense update returned invalid data');
    }

    return c.json({
      success: true,
      data: {
        siblings,
        groupId: first.groupId,
        groupTotal: first.groupTotal,
        splitMethod: first.splitMethod,
      },
      message: 'Split expense updated successfully',
    });
  }
);

// GET /api/expenses/split/:id — Get split expense siblings
routes.get('/split/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const siblings = await expenseRepository.getSplitExpense(id, user.id);
  const first = siblings[0];
  if (!first?.groupId || first.groupTotal == null || !first.splitMethod) {
    throw new ValidationError('Split expense data is invalid');
  }

  return c.json({
    success: true,
    data: {
      siblings,
      groupId: first.groupId,
      groupTotal: first.groupTotal,
      splitMethod: first.splitMethod,
    },
  });
});

// DELETE /api/expenses/split/:id — Delete split expense group
routes.delete('/split/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // Clean each sibling expense's photos (provider files + refs + rows) BEFORE the
  // group delete. deleteSplitExpense already removes the photo DB rows in its
  // transaction, but NOT the external storage files or photo_refs — so without
  // this those would leak. Cleaning here makes the repo's row-delete a no-op.
  const siblingIds = await expenseRepository.findIdsByGroupId(id, user.id);
  await deletePhotosForEntities('expense', siblingIds, user.id);

  await expenseRepository.deleteSplitExpense(id, user.id);

  return c.json({ success: true, message: 'Split expense deleted successfully' });
});

// GET /api/expenses/categories - Get expense categories
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

// ===========================================================================
// Summary route (must be before /:id to avoid path conflicts)
// ===========================================================================

// GET /api/expenses/vehicle-stats - Per-vehicle expense stats (dashboard)
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
    return c.json({ success: true, data: stats });
  }
);

const summaryQuerySchema = z.object({
  vehicleId: z.string().optional(),
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('all'),
});

// GET /api/expenses/summary - Get expense summary aggregations
routes.get('/summary', zValidator('query', summaryQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, period } = c.req.valid('query');

  // If vehicleId provided, verify user owns the vehicle
  if (vehicleId) {
    await validateVehicleOwnership(vehicleId, user.id);
  }

  const summary = await expenseRepository.getSummary({
    userId: user.id,
    vehicleId,
    period,
  });

  return c.json({ success: true, data: summary });
});

// GET /api/expenses/export - Download all matching expenses as CSV.
// Uses the UNPAGINATED findAll (so it never silently truncates the way a
// big-limit list call would, since the list route clamps to maxPageSize) and
// honours the core filters findAll supports (vehicle / category / date range).
const exportQuerySchema = z.object({
  vehicleId: z.string().optional(),
  category: expenseCategorySchema.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  // search + tags so the export matches the filtered table exactly (same coercion as
  // the list query: comma-joined tags → array, trimmed non-empty search).
  search: z.string().trim().min(1).max(100).optional(),
  tags: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((t) => t.trim()) : undefined)),
});

// Stable, import-friendly column order. Raw values (ISO dates, unformatted
// numbers) for portability; a human Vehicle name column for readability.
const EXPORT_COLUMNS = [
  'date',
  'vehicle',
  'category',
  'amount',
  'currency',
  'mileage',
  'volume',
  'fuelType',
  'description',
  'tags',
  'missedFillup',
  'createdAt',
] as const;

routes.get('/export', zValidator('query', exportQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, category, startDate, endDate, search, tags } = c.req.valid('query');

  if (vehicleId) {
    await validateVehicleOwnership(vehicleId, user.id);
  }

  const [rows, vehicles, prefs] = await Promise.all([
    expenseRepository.findAll({
      userId: user.id,
      vehicleId,
      category,
      startDate,
      endDate,
      search,
      tags,
    }),
    vehicleRepository.findByUserId(user.id),
    // Read-only: an export must not create a preferences row as a side effect.
    preferencesRepository.getByUserId(user.id),
  ]);

  // The user's real currency — NOT a hardcoded 'USD'. A EUR/GBP user's export
  // must label amounts in their own currency (the cycle 74–75 hardcoded-USD class).
  const currency = prefs?.currencyUnit || 'USD';

  const vehicleName = new Map(
    vehicles.map((v) => [v.id, v.nickname || `${v.year} ${v.make} ${v.model}`])
  );

  // neutralizeCsvRow guards every string cell against spreadsheet formula
  // injection (CWE-1236) — user free-text like `description` / `tags` / a vehicle
  // `nickname` could otherwise start with `=`/`+`/`-`/`@` and be evaluated when
  // the export is opened in Excel/Sheets. Numbers (amount) pass through untouched.
  // This export is one-way (nothing re-parses it), so prefixing is safe here.
  const records = rows.map((e) =>
    neutralizeCsvRow({
      date: e.date instanceof Date ? e.date.toISOString() : e.date,
      vehicle: vehicleName.get(e.vehicleId) ?? 'Unknown Vehicle',
      category: e.category,
      amount: e.expenseAmount,
      currency,
      mileage: e.mileage ?? '',
      volume: e.volume ?? '',
      fuelType: e.fuelType ?? '',
      description: e.description ?? '',
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

// POST /api/expenses/import - Import expenses from a "VROOM CSV" (the round-trip
// target of /export). The request carries the CSV TEXT (not a multipart upload) so
// it rides the same JSON auth/validation path as everything else. Every row is
// validated and its vehicle resolved to one the USER OWNS by name — never a
// file-provided id (cross-tenant-write class, cycle 145). dryRun:true validates +
// reports only (the UI previews, then commits); dryRun:false inserts the ready rows.
// Backward-compatible: when no `mapping` is sent the native VROOM-CSV path runs unchanged;
// when present, a foreign tracker file is translated to the native shape first (T3).
const importBodySchema = importCsvSchema.extend({
  mapping: columnMappingSchema.optional(),
});

/**
 * Resolve the units to convert a mapped import INTO, from the chosen target vehicle's
 * unitPreferences (matched by nickname or "year make model", case-insensitively — the same names
 * buildImportPlan resolves rows against). Returns {} when no targetVehicle is given or it doesn't
 * match a vehicle the user owns, so applyMapping then skips conversion (values pass through) rather
 * than converting toward a guessed unit.
 */
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

  // Foreign-tracker path (T3): translate to native CSV first, then the EXISTING flow runs
  // unchanged. Unit conversion needs the TARGET vehicle's units — resolve them from the chosen
  // targetVehicle so values aren't stored unconverted-but-relabeled (the C60-flagged risk). When
  // the file has its own vehicle column (no targetVehicle), conversion is skipped: a multi-vehicle
  // file may span differing units, so we don't guess — values pass through and the user is told.
  let importCsv = csv;
  let unmappedCategories: string[] = [];
  if (mapping) {
    const target = resolveTargetUnits(mapping.targetVehicle, vehicles);
    try {
      const result = applyMapping(csv, mapping, target);
      importCsv = result.csv;
      unmappedCategories = result.unmappedCategories;
    } catch (err) {
      if (err instanceof CsvMappingError) throw new ValidationError(err.message);
      throw err;
    }
  }

  let plan: ReturnType<typeof buildImportPlan>;
  try {
    plan = buildImportPlan(importCsv, vehicles);
  } catch (err) {
    // File-level problems (unparseable / empty / too many rows) → 400, not 500.
    if (err instanceof CsvImportError) throw new ValidationError(err.message);
    throw err;
  }

  // Preview: report the full per-row plan without writing anything.
  if (dryRun) {
    return c.json({
      success: true,
      data: { dryRun: true, imported: 0, unmappedCategories, ...summarizeImportPlan(plan) },
    });
  }

  // Commit: insert only the rows that validated. Rows that errored are reported
  // back untouched so the user can fix and re-import just those.
  //
  // Insert ATOMICALLY (all-or-nothing transaction) and IDEMPOTENTLY: each ready row carries
  // a deterministic clientId, so re-importing the same file is a no-op — already-present
  // rows are skipped and counted as duplicates rather than duplicated.
  const readyRows = plan.rows
    .filter((row) => row.status === 'ready' && row.expense)
    .map((row) => ({ ...row.expense, userId: user.id }) as NewExpense);
  const { imported, duplicates } = await expenseRepository.importExpenses(readyRows, user.id);

  return c.json({
    success: true,
    data: { dryRun: false, imported, duplicates, unmappedCategories, ...summarizeImportPlan(plan) },
  });
});

// POST /api/expenses/import/detect - identify a known tracker from the uploaded file's headers,
// so the client can pre-fill the mapping step. Body carries only the header names (not the data).
// Returns the matched preset (id/label + its default mapping) or null → manual mapping (T3).
const detectSourceSchema = z.object({
  headers: z.array(z.string().max(200)).min(1).max(100),
});
routes.post('/import/detect', zValidator('json', detectSourceSchema), (c) => {
  const { headers } = c.req.valid('json');
  const preset = detectSource(headers);
  return c.json({ success: true, data: preset });
});

// POST /api/expenses - Create a new expense
routes.post('/', zValidator('json', createExpenseSchema), async (c) => {
  const user = c.get('user');
  const expenseData = c.req.valid('json');

  // Verify vehicle exists and belongs to user
  await validateVehicleOwnership(expenseData.vehicleId, user.id);

  // Validate: if sourceType is provided, verify the referenced entity exists
  if (expenseData.sourceType === 'financing') {
    const financing = await financingRepository.findByVehicleId(expenseData.vehicleId);
    if (!financing?.isActive) {
      throw new ValidationError('Vehicle has no active financing');
    }
    if (expenseData.sourceId !== financing.id) {
      throw new ValidationError('Source ID does not match the active financing record');
    }
  }

  // Validate fuel expense requirements
  validateFuelExpenseData(
    expenseData.category,
    expenseData.mileage,
    expenseData.volume,
    expenseData.fuelType
  );

  // Idempotent create: a retried offline POST with the same clientId returns the
  // original row instead of duplicating it. Plain create when clientId is absent.
  const createdExpense = await expenseRepository.createIdempotent({
    ...expenseData,
    userId: user.id,
  });

  // D5: a mileaged expense is also a new odometer reading — re-check this vehicle's mileage reminders
  // so a crossed milestone fires immediately. Only when mileage is present (getCurrentOdometer reads
  // expenses.mileage); idempotent via the dedup, best-effort (never throws).
  if (createdExpense.mileage != null) {
    await reminderTriggerService.recheckMileageReminders(user.id, createdExpense.vehicleId);
  }

  return c.json(
    {
      success: true,
      data: createdExpense,
      message: 'Expense created successfully',
    },
    201
  );
});

// GET /api/expenses - Get all expenses for the user (with optional vehicle filter)
routes.get('/', zValidator('query', expenseQuerySchema), async (c) => {
  const user = c.get('user');
  const query = c.req.valid('query');

  // If vehicleId filter is provided, verify user owns the vehicle
  if (query.vehicleId) {
    await validateVehicleOwnership(query.vehicleId, user.id);
  }

  const { data, totalCount } = await expenseRepository.findPaginated({
    userId: user.id,
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

  const limit = Math.min(
    query.limit ?? CONFIG.pagination.defaultPageSize,
    CONFIG.pagination.maxPageSize
  );
  const offset = query.offset ?? 0;

  return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
});

// GET /api/expenses/:id - Get specific expense
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const expense = await validateExpenseOwnership(id, user.id);
  return c.json({ success: true, data: expense });
});

// PUT /api/expenses/:id - Update expense
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateExpenseSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const updateData = c.req.valid('json');
    const existingExpense = await validateExpenseOwnership(id, user.id);

    // If the edit reassigns the expense to a different vehicle, that vehicle must be the user's
    // too — mirror the create-path guard (#61). Without this, a PUT could point the (owned) expense
    // at a vehicleId the user doesn't own: it stays their row but references a non-owned vehicle,
    // corrupting their analytics attribution (within-tenant — all reads are userId-scoped, so it's
    // not a cross-tenant leak, but it IS a real integrity gap the create path already prevents).
    if (updateData.vehicleId && updateData.vehicleId !== existingExpense.vehicleId) {
      await validateVehicleOwnership(updateData.vehicleId, user.id);
    }

    const finalCategory =
      updateData.category !== undefined ? updateData.category : existingExpense.category;
    const finalMileage =
      updateData.mileage !== undefined ? updateData.mileage : existingExpense.mileage;
    const finalVolume =
      updateData.volume !== undefined ? updateData.volume : existingExpense.volume;
    const finalFuelType =
      updateData.fuelType !== undefined ? updateData.fuelType : existingExpense.fuelType;

    validateFuelExpenseData(finalCategory, finalMileage, finalVolume, finalFuelType);

    const updatedExpense = await expenseRepository.update(id, updateData);

    // D5 (#71): an EDIT can also cross a mileage milestone — e.g. correcting a reading upward past a
    // reminder's due odometer. The create path rechecks (:573) but the update path did not, so an
    // edit-crossed reminder only fired on the next /trigger or login, silently breaking the
    // "fires the moment crossed" guarantee. Mirror the create-path best-effort recheck (never throws,
    // idempotent via the dedup). Use the UPDATED vehicleId so a reassign rechecks the right vehicle.
    if (updatedExpense.mileage != null) {
      await reminderTriggerService.recheckMileageReminders(user.id, updatedExpense.vehicleId);
    }

    return c.json({
      success: true,
      data: updatedExpense,
      message: 'Expense updated successfully',
    });
  }
);

// DELETE /api/expenses/:id - Delete expense
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  await validateExpenseOwnership(id, user.id);

  // Clean the expense's receipt photos (provider files + DB) before deleting the
  // row — the photos table has no FK, so they'd otherwise orphan.
  await deleteAllPhotosForEntity('expense', id, user.id);

  await expenseRepository.delete(id);
  return c.json({ success: true, message: 'Expense deleted successfully' });
});

export { routes };
