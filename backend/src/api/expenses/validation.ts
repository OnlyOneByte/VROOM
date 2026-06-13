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
    totalAmount: z.number().positive('Amount must be positive'),
    sourceType: z.string().optional(),
    sourceId: z.string().optional(),
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
    totalAmount: z.number().positive().optional(),
  })
  .superRefine(refineSplitConfig);
