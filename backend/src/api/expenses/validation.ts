import { z } from 'zod';
import { CONFIG } from '../../config';

// ---------------------------------------------------------------------------
// Tag element — ONE source of truth (C408). A tag may not contain ';' or ',' because the CSV export
// joins tags with '; ' and the importer splits on /[;,]/, so a separator-bearing tag round-trips into
// MULTIPLE tags (silent data loss, #104/C352). Enforced at EVERY tag write boundary: the regular
// create/update schemas (routes.ts imports this) AND the split-create schema below — the split boundary
// was a bare z.array(z.string()) that bypassed the #104 refine, persisting a `road; trip` tag that
// split on export→re-import (the C352 fix landed on the regular boundaries but missed this one).
// ---------------------------------------------------------------------------
export const tagElementSchema = z
  .string()
  .min(1)
  .max(
    CONFIG.validation.expense.tagMaxLength,
    `Tag must be ${CONFIG.validation.expense.tagMaxLength} characters or less`
  )
  .refine((t) => !t.includes(';') && !t.includes(','), {
    message: 'Tag cannot contain a semicolon or comma',
  });

// A positive money amount QUANTIZED to whole cents (#141, C458). A split's groupTotal is stored from the
// raw totalAmount while computeEvenSplit/computePercentageSplit round each leg to whole cents
// (Math.round(total*100)) — so a sub-cent total (e.g. 100.005) persisted groupTotal=100.005 while the legs
// summed to 100.01, a stored header that disagrees with Σsiblings (NORTH_STAR #1, violates the "legs sum to
// groupTotal" invariant). Rounding totalAmount to cents at the boundary makes groupTotal computed from the
// SAME cent-aligned value as the legs. The UI only ever sends 2-decimal amounts, so this is a no-op there.
const centsAmount = z
  .number()
  .positive('Amount must be positive')
  .transform((n) => Math.round(n * 100) / 100);

// ---------------------------------------------------------------------------
// Split Config Schemas (discriminated union on `method`)
// ---------------------------------------------------------------------------

export const evenSplitSchema = z.object({
  method: z.literal('even'),
  vehicleIds: z.array(z.string().min(1)).min(1),
});

const absoluteAllocationSchema = z.object({
  vehicleId: z.string().min(1),
  amount: z.number().min(0, 'Amount must be non-negative'),
});

export const absoluteSplitSchema = z.object({
  method: z.literal('absolute'),
  allocations: z.array(absoluteAllocationSchema).min(1),
});

const percentageAllocationSchema = z.object({
  vehicleId: z.string().min(1),
  percentage: z.number().min(0).max(100, 'Percentage must be 0-100'),
});

export const percentageSplitSchema = z.object({
  method: z.literal('percentage'),
  allocations: z.array(percentageAllocationSchema).min(1),
});

export const splitConfigSchema = z.discriminatedUnion('method', [
  evenSplitSchema,
  absoluteSplitSchema,
  percentageSplitSchema,
]);

/** Inferred SplitConfig type — the API-layer discriminated union. */
export type SplitConfig = z.infer<typeof splitConfigSchema>;

/**
 * The distinct vehicleIds a split config touches, across all three methods (even: `vehicleIds`;
 * absolute/percentage: the allocation rows). ONE source of truth for the `even ? vehicleIds :
 * allocations.map(...)` extraction that was hand-copied at 3 sites (the expenses route's ownership
 * loop, the expense repo's validateVehicleOwnership, the reminder validator's split-vs-vehicleIds
 * check). Typed on the minimal structural shape so BOTH `SplitConfig` (this module) and the DB-layer
 * `ReminderSplitConfig` satisfy it without a cross-import. De-duped (Set) — a malformed config naming
 * the same vehicle twice yields it once, matching the callers' prior `[...new Set(ids)]`.
 */
export function splitConfigVehicleIds(
  config:
    | { method: 'even'; vehicleIds: string[] }
    | { method: 'absolute' | 'percentage'; allocations: { vehicleId: string }[] }
): string[] {
  const ids =
    config.method === 'even' ? config.vehicleIds : config.allocations.map((a) => a.vehicleId);
  return [...new Set(ids)];
}

// ---------------------------------------------------------------------------
// Create / Update Split Expense Schemas
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared refinement: validate percentage sum = 100 and absolute sum = total
// ---------------------------------------------------------------------------

function refineSplitConfig(
  data: { splitConfig: z.infer<typeof splitConfigSchema>; totalAmount?: number },
  ctx: z.RefinementCtx
) {
  const { splitConfig } = data;
  if (splitConfig.method === 'percentage') {
    const sum = splitConfig.allocations.reduce((acc, a) => acc + a.percentage, 0);
    if (Math.abs(sum - 100) >= 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Percentages must sum to 100',
        path: ['splitConfig', 'allocations'],
      });
    }
  }
  if (splitConfig.method === 'absolute' && data.totalAmount !== undefined) {
    const sum = splitConfig.allocations.reduce((acc, a) => acc + a.amount, 0);
    if (Math.abs(sum - data.totalAmount) >= 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Absolute allocations must sum to total amount',
        path: ['splitConfig', 'allocations'],
      });
    }
  }
}

export const createSplitExpenseSchema = z
  .object({
    splitConfig: splitConfigSchema,
    category: z.string().min(1),
    tags: z.array(tagElementSchema).max(CONFIG.validation.expense.maxTags).optional(),
    date: z.coerce.date(),
    description: z.string().optional(),
    totalAmount: centsAmount, // quantized to whole cents so groupTotal == Σsiblings (#141)
    // Manual split create accepts ONLY 'financing' as a source link (mirrors the regular create at
    // routes.ts:84) — and the /split POST handler fully validates it (assertFinancingSourceValid per
    // vehicle). 'insurance_term' + 'reminder' splits are created EXCLUSIVELY by system paths that
    // bypass this route (insurance hooks via createSplitExpense; the reminder trigger via a direct
    // tx.insert), so a bare z.string() here was pure over-permissiveness: a hand-crafted POST could
    // forge an UNVALIDATED insurance_term/reminder link on the caller's own siblings (#145 — the #62
    // within-tenant integrity class on the split path #125/C422 missed: skews source-bucketed
    // analytics, and a real matching sourceId would cascade-delete the manual split when its parent
    // insurance term is removed). Restricting to 'financing' closes that with zero system-path impact.
    sourceType: z.literal('financing').optional(),
    sourceId: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    refineSplitConfig(data, ctx);
    // Enforce both-or-neither for source fields
    if ((data.sourceType && !data.sourceId) || (!data.sourceType && data.sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sourceType and sourceId must both be provided or both omitted',
        path: ['sourceType'],
      });
    }
  });

export const updateSplitSchema = z
  .object({
    splitConfig: splitConfigSchema,
    totalAmount: centsAmount.optional(), // quantized to whole cents (#141)
  })
  .superRefine(refineSplitConfig);
