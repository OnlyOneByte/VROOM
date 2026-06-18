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
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
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
import {
  createSplitExpenseSchema,
  type SplitConfig,
  splitConfigVehicleIds,
  tagElementSchema,
  updateSplitSchema,
} from './validation';

const routes = new Hono();

// Validation schemas derived from db schema
const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

// tagElementSchema (the #104 separator-rejection + length cap) is the ONE source of truth, now in
// validation.ts so the split-create schema shares it too (C408); reused here by the create base + the
// update override (which drops the base `.default([])` to dodge the .partial() clobber, C34/#tags).
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

const createExpenseSchema = createExpenseSchemaBase
  // #98 (C51): conflict-resolution keep-local opt-in. When an offline edit collides with an existing
  // (userId, clientId) row, this flag tells the idempotent create to APPLY the edit (update the row)
  // rather than no-op-return the stored version — so a resolved local edit is never silently lost. A
  // plain retry omits it → the pure idempotent no-op is unchanged. create-only (not on update).
  .extend({ forceOverwrite: z.boolean().optional() })
  .refine(
    (data) => {
      // Enforce both-or-neither for source fields
      const hasType = !!data.sourceType;
      const hasId = !!data.sourceId;
      return hasType === hasId;
    },
    {
      message: 'sourceType and sourceId must both be provided or both omitted',
      path: ['sourceType'],
    }
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
    tags: z.array(tagElementSchema).max(CONFIG.validation.expense.maxTags).optional(),
  })
  // #109 (C372): mirror the create-path both-or-neither source refine. `.refine()` does NOT survive
  // `.partial()`/`.omit()` re-derivation, so without re-adding it a PUT could set ONE of the pair —
  // `{ sourceId: 'fin-x' }` (no type) or `{ sourceType: 'financing' }` (no id) — persisting an
  // ASYMMETRIC source link the create path forbids (the #62/#34 within-tenant integrity class): it
  // skews source-bucketed analytics, and a half-link with a real sourceId would mis-trigger (or
  // never trigger) the financing cascade-delete cleanup. A PUT supplying NEITHER is fine (a normal
  // edit leaves the row's existing source untouched); supplying BOTH is the validated create-shape.
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

/**
 * Null the fuel-only columns on a NON-fuel expense write (the server-side mirror of the C226/#76 FE
 * fix). `validateFuelExpenseData` only enforces the forward direction (a `fuel` expense MUST have
 * volume+mileage) — it never strips fuel fields from a non-fuel write, so a direct API caller (or a
 * future client) could persist a `maintenance`/`misc` row carrying volume/fuelType/missedFillup, and
 * crucially a stray `mileage`, which getCurrentOdometer reads CROSS-CATEGORY (odometer/repository.ts:
 * the UNION has no category filter) → a typo'd mileage on a non-fuel row poisons the reminder/lease
 * odometer axis (#76's verified reachability). For a non-fuel category these four columns are
 * meaningless, so null them. Only acts when `category` is explicitly present + non-fuel (a PUT that
 * omits category leaves the row's existing category — and its fields — untouched). Returns a shallow
 * copy; never mutates the input. The `charge` field is FE-only (mapped to volume at the API boundary),
 * so it isn't a backend column.
 */
function clearFuelFieldsIfNotFuel<
  T extends {
    category?: string;
    volume?: number | null;
    fuelType?: string | null;
    mileage?: number | null;
    missedFillup?: boolean;
  },
>(data: T, effectiveCategory: string | undefined = data.category): T {
  // Key off the EFFECTIVE category, not data.category. On a PUT that changes mileage/volume but omits
  // `category`, data.category is undefined while the row's effective category is the EXISTING one — so
  // a maintenance row could keep a stray mileage (poisoning getCurrentOdometer cross-category, the #76
  // class). Callers pass the resolved final category; the default keeps the create path's behavior.
  if (effectiveCategory === undefined || effectiveCategory === 'fuel') return data;
  return { ...data, volume: null, fuelType: null, mileage: null, missedFillup: false };
}

/**
 * When an expense write SETS a financing source link, verify it points at the vehicle's ACTIVE financing
 * record. ONE source of truth (C422) for the check the create path enforced inline — the PUT path skipped
 * it, so a `{sourceType:'financing', sourceId:<arbitrary or mismatched id>}` edit persisted verbatim. That
 * link is the exact predicate FinancingRepository.computeBalance sums (originalAmount − SUM(expenseAmount)
 * WHERE source_type='financing' AND source_id=id), so a forged/mismatched link MIS-ATTRIBUTES an expense as
 * a loan payment → understates the displayed balance (NORTH_STAR #1 money figure) + wires the row into the
 * financing cascade-cleanup (the #62 integrity class). Pass `undefined` sourceType (a non-financing or
 * source-less write) → no-op. The both-or-neither refine guarantees sourceId is present when sourceType is.
 */
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

/**
 * A 'financing'-sourced split must point at the ACTIVE financing of EVERY vehicle it lands on —
 * each sibling is a separate vehicleId and computeBalance sums by (sourceType,sourceId) with NO
 * vehicle scope, so a sibling on a vehicle whose active financing isn't `sourceId` mis-attributes a
 * loan payment → understates that balance (#145/#125, the within-tenant financing-source class).
 * No-op for a source-less split (assertFinancingSourceValid returns early when sourceType !==
 * 'financing'). Shared by POST /split (new config) AND PUT /split (the carried-forward link must be
 * re-checked against the NEW vehicle set — #147, the path the per-vehicle check missed).
 */
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

  // A 'financing'-sourced split must point at the active financing of EACH vehicle it touches (#145,
  // the #125/C422 financing-source check the split path missed). The schema restricts sourceType to
  // the 'financing' literal; the shared helper validates per vehicle (no-op for a source-less split).
  await assertSplitFinancingSourceValid(data.sourceType, data.sourceId, data.splitConfig);

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

    // The regenerated siblings CARRY FORWARD the group's existing sourceType/sourceId (the update
    // schema doesn't expose them — see updateSplitExpense), but the NEW splitConfig may land them on a
    // DIFFERENT vehicle set. computeBalance sums financing payments by (sourceType,sourceId) with no
    // vehicle scope, so reallocating a financing-sourced split onto a vehicle whose active financing
    // isn't that sourceId mis-attributes a loan payment → understates the balance (#147, the #125/#145
    // financing-source class on the split-UPDATE path the per-vehicle check missed). Re-validate the
    // carried link against the new vehicles before regenerating. getSplitExpense is userId-scoped (404s
    // a non-owned/absent group); a source-less split is a no-op.
    const existing = await expenseRepository.getSplitExpense(id, user.id);
    await assertSplitFinancingSourceValid(
      existing[0]?.sourceType ?? undefined,
      existing[0]?.sourceId ?? undefined,
      data.splitConfig
    );

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
  // Separate the control flag from the row data: forceOverwrite (#98) governs the idempotent-create
  // collision behavior, it is NOT a column — keep it out of the inserted/overwritten row.
  const { forceOverwrite, ...body } = c.req.valid('json');
  // Strip fuel-only fields from a non-fuel create (#76 server-side): a stray mileage would otherwise
  // poison getCurrentOdometer (cross-category UNION). For a fuel expense this is a no-op.
  const expenseData = clearFuelFieldsIfNotFuel(body);

  // Verify vehicle exists and belongs to user
  await validateVehicleOwnership(expenseData.vehicleId, user.id);

  // Validate: a financing source link must point at the vehicle's active financing (shared with PUT, C422).
  await assertFinancingSourceValid(
    expenseData.sourceType,
    expenseData.sourceId,
    expenseData.vehicleId
  );

  // Validate fuel expense requirements
  validateFuelExpenseData(
    expenseData.category,
    expenseData.mileage,
    expenseData.volume,
    expenseData.fuelType
  );

  // Idempotent create: a retried offline POST with the same clientId returns the
  // original row instead of duplicating it. Plain create when clientId is absent.
  // forceOverwrite (#98): a keep-local conflict resolution APPLIES the edit on collision.
  const createdExpense = await expenseRepository.createIdempotent(
    {
      ...expenseData,
      userId: user.id,
    },
    forceOverwrite ?? false
  );

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

  const { limit, offset } = clampPagination(query);

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

    // A PUT that SETS a financing source link must verify it like the create path does (C422) — else a
    // forged/mismatched sourceId persists + corrupts the displayed loan balance (computeBalance sums this
    // exact link). Keyed on updateData.sourceType so a normal edit (no source fields) is a no-op; validated
    // against the FINAL vehicleId so a simultaneous reassignment checks the right vehicle's financing.
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

    // If the EFFECTIVE category is non-fuel, null any fuel-only columns in this write (#76 server-side).
    // Keyed on finalCategory (not updateData.category) so it covers BOTH a fuel→maintenance switch that
    // omits the fuel fields AND a PUT that writes a stray mileage/volume onto an ALREADY-non-fuel row
    // without resending category (#76 third leg, C434) — either way a stray mileage would poison
    // getCurrentOdometer cross-category. A genuine fuel edit (finalCategory==='fuel') is untouched.
    const normalizedUpdate = clearFuelFieldsIfNotFuel(updateData, finalCategory);

    const updatedExpense = await expenseRepository.update(id, normalizedUpdate);

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
