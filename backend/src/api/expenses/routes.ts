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
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { neutralizeCsvRow } from '../../utils/csv-safety';
import { centsToDollars, expenseToApi, moneyDollarsToCents } from '../../utils/money';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import {
  requireVehicleRead,
  requireVehicleWrite,
  resolveVehicleOwnerId,
} from '../../utils/sharing';
import { commonSchemas, validateFuelExpenseData } from '../../utils/validation';
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
  // money: client sends DOLLARS, store integer CENTS (money-cents-migration T3). volume is NOT money
  // (gallons/kWh) — it stays a plain number.
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
    // .nullish() (not .optional()) so an edit can send description:null to CLEAR
    // it — the clear-optional-field class (cycles 82-85). BaseRepository.update
    // writes null through to the column; undefined is still dropped (create omits it).
    .nullish(),
  // expense-location T2: an OPTIONAL free-text location label (D1 — no GPS). Same shape + clear-on-edit
  // semantics as description; length-capped at locationMaxLength. createInsertSchema already infers the
  // column, but this override adds the bound + the .nullish() clear contract (the default would be
  // .optional()-ish without the cap).
  location: z
    .string()
    .max(
      CONFIG.validation.expense.locationMaxLength,
      `Location must be ${CONFIG.validation.expense.locationMaxLength} characters or less`
    )
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
  // `createdBy` is SERVER-controlled provenance (vehicle-sharing T5b owner-stamp model), not client
  // input: it is set to the acting editor on a shared-created row and left NULL otherwise. Omitting it
  // from the input schema (it is an insertable column, so createInsertSchema would otherwise accept it)
  // closes a forge vector — a caller could not otherwise be stopped from claiming a different author.
  createdBy: true,
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

/**
 * vehicle-sharing T5b-2b: authorize a split WRITE across its full vehicle set + resolve the owner-stamp.
 * The split path is the multi-vehicle analogue of the single-expense T5b-2 write: a sibling lands on
 * EACH config vehicle, so the acting user must hold WRITE access (owner | accepted editor) to EVERY one
 * — `requireVehicleWrite` per vehicle is the single denial gate (a stranger / viewer / editor-on-another-
 * vehicle all get the same 404, existence-hiding). The owner-stamp model (design §2.1) keys each row's
 * `userId` to the vehicle OWNER, but a split group carries ONE `userId` across all siblings, so the set
 * must resolve to a SINGLE owner: a shared editor may split a cost across several vehicles only when they
 * ALL belong to one owner (the clean-cut resolution of the multi-owner fork named in the T5b-2b/§2.1
 * notes — a cross-owner split would have to stamp two different userIds into one group and would relocate
 * cost across two users' books). `createdBy` records the actual author (the editor, or NULL when they are
 * the owner — the legacy/self sentinel). Returns the resolved stamp for the repository.
 *
 * Pre-sharing behavior is preserved exactly: when every vehicle is the acting user's own, the loop
 * resolves ownerId === acting and createdBy === null (byte-identical to the old assertVehiclesOwned path).
 */
async function requireSplitWriteAccess(
  splitConfig: SplitConfig,
  actingUserId: string
): Promise<{ ownerId: string; createdBy: string | null }> {
  const vehicleIds = splitConfigVehicleIds(splitConfig);
  let ownerId: string | undefined;
  for (const vehicleId of vehicleIds) {
    // WRITE gate per sibling vehicle (owner | accepted editor | 404). REPLACES the strict
    // assertVehiclesOwned so a shared editor can split onto the owner's vehicle.
    await requireVehicleWrite(vehicleId, actingUserId);
    const vehicleOwner = await resolveVehicleOwnerId(vehicleId);
    if (!vehicleOwner) throw new NotFoundError('Vehicle'); // requireVehicleWrite already 404'd absent
    if (ownerId === undefined) {
      ownerId = vehicleOwner;
    } else if (ownerId !== vehicleOwner) {
      // A split spanning two owners cannot satisfy the single-`userId`-per-group owner-stamp invariant.
      throw new ValidationError('A split cannot span vehicles owned by different users');
    }
  }
  // splitConfig schemas guarantee ≥1 vehicle, so ownerId is always set here.
  if (ownerId === undefined) throw new ValidationError('Split has no vehicles');
  return { ownerId, createdBy: ownerId === actingUserId ? null : actingUserId };
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

  // vehicle-sharing T5b-2b: WRITE access to EVERY sibling vehicle + the single owner-stamp (owner |
  // accepted editor on each; a cross-owner set is rejected). Replaces the strict owner-only check the
  // repo used to run, so a shared editor can create a split on the owner's vehicle(s).
  const { ownerId, createdBy } = await requireSplitWriteAccess(data.splitConfig, user.id);
  const siblings = await expenseRepository.createSplitExpense(data, user.id, ownerId, createdBy);
  const first = siblings[0];
  if (!first?.groupId || first.groupTotal == null || !first.splitMethod) {
    throw new ValidationError('Split expense creation returned invalid data');
  }

  return c.json(
    {
      success: true,
      // T6 display edge: each sibling's money + the group total cents → dollars.
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
    // vehicle-sharing T5b-2b: the group is owner-stamped, so load it UNSCOPED (by groupId) and
    // authorize via the share seam — a userId-scoped read would 404 a shared editor on a group they
    // can legitimately edit. requireSplitWriteAccess gates BOTH the existing vehicle set (the editor
    // must currently have write on what they're regenerating) AND, separately below, the NEW set.
    const groupInfo = await expenseRepository.getSplitGroupAccessInfo(id);
    if (!groupInfo) throw new NotFoundError('Split expense');
    const existingConfig: SplitConfig = { method: 'even', vehicleIds: groupInfo.vehicleIds };
    await requireSplitWriteAccess(existingConfig, user.id);
    // The NEW vehicle set must also be writable by the editor AND resolve to the SAME single owner as
    // the group's existing owner-stamp — otherwise the regenerated siblings would relocate the group's
    // cost onto a different user's books (the owner-stamp invariant: one userId across the group).
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

// GET /api/expenses/split/:id — Get split expense siblings
routes.get('/split/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // vehicle-sharing T5b-3 (split READ): load the owner-stamped group UNSCOPED, then authorize READ on
  // every sibling vehicle (owner | accepted viewer/editor). A viewer MAY read a shared split; a
  // stranger gets the same 404 the absent-group branch throws (existence-hiding). Read the rows under
  // the group's owner id (their stamped userId), not the acting user's.
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

// DELETE /api/expenses/split/:id — Delete split expense group
routes.delete('/split/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // vehicle-sharing T5b-2b (split DELETE): load the owner-stamped group UNSCOPED, then authorize WRITE
  // on every sibling vehicle (owner | accepted editor; viewer/stranger get the same 404). An editor
  // may delete a shared split. All subsequent repo reads/writes are scoped to the group's OWNER id
  // (the rows' stamped userId), and photo cleanup likewise — expense photos validate via the owner's
  // userId, so passing the acting editor would 404 the cleanup.
  const groupInfo = await expenseRepository.getSplitGroupAccessInfo(id);
  if (!groupInfo) throw new NotFoundError('Split expense');
  await requireSplitWriteAccess({ method: 'even', vehicleIds: groupInfo.vehicleIds }, user.id);

  // Clean each sibling expense's photos (provider files + refs + rows) BEFORE the
  // group delete. deleteSplitExpense already removes the photo DB rows in its
  // transaction, but NOT the external storage files or photo_refs — so without
  // this those would leak. Cleaning here makes the repo's row-delete a no-op.
  const siblingIds = await expenseRepository.findIdsByGroupId(id, groupInfo.ownerId);
  await deletePhotosForEntities('expense', siblingIds, groupInfo.ownerId);

  await expenseRepository.deleteSplitExpense(id, groupInfo.ownerId);

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
    // T6 display edge: totalAmount/recentAmount are cents sums → dollars for the dashboard cards.
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

// GET /api/expenses/summary - Get expense summary aggregations
routes.get('/summary', zValidator('query', summaryQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, period } = c.req.valid('query');

  // vehicle-sharing T5b-3: per-vehicle summary widens to shared READ access, scoped to the vehicle
  // OWNER's books (the owner-stamp model — see the GET / list note); cross-fleet summary (no
  // vehicleId) stays acting-user-owned only (no double-count). requireVehicleRead 404s a viewer/
  // stranger; resolveVehicleOwnerId then yields the owner whose rows back this vehicle.
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

  // T6 display edge: every money field in the summary is cents-denominated (sums + the monthlyAverage
  // cents/month) → dollars for the FE. counts/periods/categories are untouched.
  return c.json({
    success: true,
    data: {
      ...summary,
      totalAmount: centsToDollars(summary.totalAmount),
      monthlyAverage: centsToDollars(summary.monthlyAverage),
      recentAmount: centsToDollars(summary.recentAmount),
      categoryBreakdown: summary.categoryBreakdown.map((r) => ({
        ...r,
        amount: centsToDollars(r.amount),
      })),
      monthlyTrend: summary.monthlyTrend.map((r) => ({ ...r, amount: centsToDollars(r.amount) })),
    },
  });
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
// The CSV header set the export writes. EXPORTED so the round-trip guard
// (export-import-column-contract.test.ts) can assert every key the importer reads is present here —
// a renamed/dropped column would otherwise silently break the export→re-import round-trip (NORTH_STAR #1)
// with no test catching it (export + import tests each hard-code their own headers).
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

  // vehicle-sharing T5b-3b: a per-vehicle CSV export widens to shared READ, scoped to the vehicle
  // OWNER's books (the owner-stamp model — rows are owner-stamped, so the acting invitee's own userId
  // would export an empty file). requireVehicleRead 404s a viewer/stranger; resolveVehicleOwnerId then
  // yields the owner. A CROSS-FLEET export (no vehicleId) stays acting-user-scoped (unchanged) — a
  // shared vehicle's rows belong to the owner's export, not the invitee's all-vehicles dump.
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
    // For a shared per-vehicle export the row's vehicle is OWNED BY ANOTHER user, so the acting user's
    // own fleet (above) does NOT contain it — fetch the shared vehicle by id for the human name column.
    isSharedExport && vehicleId ? vehicleRepository.findByIds([vehicleId]) : Promise.resolve([]),
    // Read-only: an export must not create a preferences row as a side effect. Currency stays the ACTING
    // user's preference (they are downloading their own file in their own locale), not the owner's.
    preferencesRepository.getByUserId(user.id),
  ]);

  // The user's real currency — NOT a hardcoded 'USD'. A EUR/GBP user's export
  // must label amounts in their own currency (the cycle 74–75 hardcoded-USD class).
  const currency = prefs?.currencyUnit || 'USD';

  const vehicleName = new Map(
    [...vehicles, ...sharedVehicles].map((v) => [
      v.id,
      v.nickname || `${v.year} ${v.make} ${v.model}`,
    ])
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
      // T6 display edge: expenseAmount is stored CENTS; the human-facing export CSV emits DOLLARS so it
      // stays the faithful round-trip target for the import path (import-csv parseAmount → dollarsToCents).
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

  // vehicle-sharing T5b-2: WRITE access is owner OR an accepted EDITOR (viewer denied with the same
  // 404 a stranger gets — requireVehicleWrite, the ONE seam). REPLACES the strict
  // validateVehicleOwnership here so a shared editor can log a cost on the owner's vehicle.
  await requireVehicleWrite(expenseData.vehicleId, user.id);

  // OWNER-STAMP (design §2.1, ratified option a): the row's userId is the vehicle OWNER's id, NOT the
  // acting user's — so a shared editor's expense rides the OWNER's backup/TCO and counts once. For an
  // owner writing their own vehicle this resolves to themselves (unchanged). `createdBy` records who
  // physically entered it: the acting user when they are NOT the owner (a shared editor), else NULL
  // (the legacy/self sentinel — keeps owner-authored rows identical to pre-T5b). requireVehicleWrite
  // already 404'd an absent vehicle, so the owner id is always present here.
  const ownerId = await resolveVehicleOwnerId(expenseData.vehicleId);
  if (!ownerId) throw new ValidationError('Vehicle');
  const createdBy = ownerId === user.id ? null : user.id;

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
  // The idempotency key is scoped to the row's userId — now the OWNER — so a shared editor's
  // retried offline POST de-dupes against the owner's books (the row it actually created).
  const createdExpense = await expenseRepository.createIdempotent(
    {
      ...expenseData,
      userId: ownerId,
      createdBy,
    },
    forceOverwrite ?? false
  );

  // D5: a mileaged expense is also a new odometer reading — re-check this vehicle's mileage reminders
  // so a crossed milestone fires immediately. Scope to the OWNER (the row's userId, the owner-stamp
  // model): the reminders that track this vehicle belong to the owner, not the editor. Only when
  // mileage is present (getCurrentOdometer reads expenses.mileage); idempotent via the dedup,
  // best-effort (never throws).
  if (createdExpense.mileage != null) {
    await reminderTriggerService.recheckMileageReminders(ownerId, createdExpense.vehicleId);
  }

  return c.json(
    {
      success: true,
      // T6 display edge: stored cents → dollars so the FE Expense.amount contract is unchanged.
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

  // vehicle-sharing T5b-3: READ widening (design §2.1 rule 3). Two distinct shapes:
  //  - PER-VEHICLE (?vehicleId=…): gate via requireVehicleRead (owner | accepted viewer/editor | 404).
  //    Because shared-created rows are OWNER-stamped (userId == vehicle owner, T5b-2), a shared
  //    invitee querying their OWN userId would see NOTHING for the shared vehicle — so scope the query
  //    to the vehicle OWNER's userId. With both vehicleId AND ownerId pinned, the result is exactly
  //    that one vehicle's rows (the owner cannot leak their OTHER vehicles through this — vehicleId
  //    filters them out), and an owner reading their own vehicle is unchanged (owner === acting).
  //  - CROSS-FLEET (no vehicleId): stays acting-user-owned only — a shared vehicle's costs belong to
  //    the OWNER's dashboard, NOT the invitee's, so no double-count and no foreign rows leak into the
  //    invitee's all-vehicles list. The invitee sees a shared vehicle's costs ONLY via ?vehicleId.
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

  // T6 display edge: each row's money cents → dollars before the paginated envelope.
  return c.json(buildPaginatedResponse(data.map(expenseToApi), totalCount, limit, offset));
});

// GET /api/expenses/:id - Get specific expense
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  // vehicle-sharing T5b-3: load the (owner-stamped) row UNSCOPED, then authorize via the vehicle's
  // READ access — owner | accepted viewer | accepted editor. A stranger gets the same NotFoundError
  // (existence-hiding) the absent-row branch throws, so a shared invitee can read a single shared-
  // vehicle expense while a non-shared third party cannot distinguish "not yours" from "does not exist".
  const expense = await expenseRepository.findById(id);
  if (!expense) throw new NotFoundError('Expense');
  await requireVehicleRead(expense.vehicleId, user.id);
  return c.json({ success: true, data: expenseToApi(expense) });
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

    // vehicle-sharing T5b-2: load the row UNSCOPED (it is owner-stamped — a shared editor's row carries
    // the OWNER's userId, so the old validateExpenseOwnership(id, acting) would 404 the editor's own
    // edit), then authorize via the vehicle's WRITE access. requireVehicleWrite is the single denial
    // gate: a stranger (no access), a VIEWER (read-only), and an editor on a DIFFERENT vehicle all get
    // the same 404 (existence-hiding) — replacing the prior userId-scoped ownership check.
    const existingExpense = await expenseRepository.findById(id);
    if (!existingExpense) throw new ValidationError('Expense');
    await requireVehicleWrite(existingExpense.vehicleId, user.id);

    // If the edit reassigns the expense to a different vehicle, the acting user must have WRITE access
    // to that vehicle too (the #61 guard, widened to the share seam). Additionally the target vehicle
    // must have the SAME owner as the current one: the row is owner-stamped (existingExpense.userId IS
    // the owner), so moving it onto a DIFFERENT owner's vehicle would silently relocate the cost
    // between two users' books (and break the owner-stamp invariant userId == vehicle owner). A
    // same-owner reassignment (the only kind possible pre-sharing, when both are the acting user's)
    // keeps userId correct with no re-stamp; a cross-owner move is rejected.
    if (updateData.vehicleId && updateData.vehicleId !== existingExpense.vehicleId) {
      await requireVehicleWrite(updateData.vehicleId, user.id);
      const targetOwnerId = await resolveVehicleOwnerId(updateData.vehicleId);
      if (targetOwnerId !== existingExpense.userId) {
        throw new ValidationError('Cannot move an expense to a vehicle owned by a different user');
      }
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
    // reminder's due odometer. The create path rechecks but the update path did not, so an
    // edit-crossed reminder only fired on the next /trigger or login, silently breaking the
    // "fires the moment crossed" guarantee. Mirror the create-path best-effort recheck (never throws,
    // idempotent via the dedup). Use the UPDATED vehicleId so a reassign rechecks the right vehicle,
    // scoped to the row's OWNER (existingExpense.userId — the owner-stamp model; the mileage reminders
    // for this vehicle belong to the owner, not a shared editor). Reassignment is same-owner only
    // (asserted above), so the owner is stable across the edit.
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

// DELETE /api/expenses/:id - Delete expense
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // vehicle-sharing T5b-2: load the (owner-stamped) row UNSCOPED, then authorize via the vehicle's
  // WRITE access — owner or accepted editor; a viewer/stranger gets the same 404 (existence-hiding).
  // An editor may delete a cost row on a shared vehicle (D3 editor capability).
  const existingExpense = await expenseRepository.findById(id);
  if (!existingExpense) throw new ValidationError('Expense');
  await requireVehicleWrite(existingExpense.vehicleId, user.id);

  // Clean the expense's receipt photos (provider files + DB) before deleting the row — the photos
  // table has no FK, so they would otherwise orphan. Scope the photo-ownership check to the row's
  // OWNER (existingExpense.userId — the owner-stamp model): expense photos validate via
  // expenses.userId, which is the owner, so passing the acting editor would 404 the cleanup.
  await deleteAllPhotosForEntity('expense', id, existingExpense.userId);

  await expenseRepository.delete(id);
  return c.json({ success: true, message: 'Expense deleted successfully' });
});

export { routes };
