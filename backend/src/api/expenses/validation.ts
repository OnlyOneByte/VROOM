import { z } from 'zod';
import { CONFIG } from '../../config';
import { dollarsToCents } from '../../utils/money';

// Tags cannot contain separators: the CSV export joins tags with '; ' and the importer splits
// on /[;,]/, so such a tag would silently re-import as several tags.
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

const centsAmount = z.number().positive('Amount must be positive').transform(dollarsToCents);

export const evenSplitSchema = z.object({
  method: z.literal('even'),
  vehicleIds: z.array(z.string().min(1)).min(1),
});

const absoluteAllocationSchema = z.object({
  vehicleId: z.string().min(1),
  amount: z.number().min(0, 'Amount must be non-negative').transform(dollarsToCents),
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

// Transform-free twin for re-validating values already stored in cents (the reminder merge gate);
// running the dollars-to-cents transform again would double-convert them.
const absoluteAllocationStructuralSchema = z.object({
  vehicleId: z.string().min(1),
  amount: z.number().min(0, 'Amount must be non-negative'),
});

export const splitConfigStructuralSchema = z.discriminatedUnion('method', [
  evenSplitSchema,
  z.object({
    method: z.literal('absolute'),
    allocations: z.array(absoluteAllocationStructuralSchema).min(1),
  }),
  percentageSplitSchema,
]);

export type SplitConfig = z.infer<typeof splitConfigSchema>;

export function splitConfigVehicleIds(
  config:
    | { method: 'even'; vehicleIds: string[] }
    | { method: 'absolute' | 'percentage'; allocations: { vehicleId: string }[] }
): string[] {
  const ids =
    config.method === 'even' ? config.vehicleIds : config.allocations.map((a) => a.vehicleId);
  return [...new Set(ids)];
}

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
    totalAmount: centsAmount,
    // Only financing links are accepted from the API; insurance and reminder splits are created by
    // system paths that bypass this route, so a client-supplied link of those types would be unvalidated.
    sourceType: z.literal('financing').optional(),
    sourceId: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    refineSplitConfig(data, ctx);
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
    totalAmount: centsAmount.optional(),
  })
  .superRefine(refineSplitConfig);
