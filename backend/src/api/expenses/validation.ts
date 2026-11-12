import { z } from 'zod';
import { CONFIG } from '../../config';
import type { SplitConfig } from '../../db/types';
import { dollarsToCents } from '../../utils/money';

// Tags cannot contain ';' or ',': the CSV export joins tags with '; ' and the importer splits on /[;,]/.
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

export function clearFuelFieldsIfNotFuel<
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

const centsAmount = z.number().positive('Amount must be positive').transform(dollarsToCents);

const evenSplitSchema = z.object({
  method: z.literal('even'),
  vehicleIds: z.array(z.string().min(1)).min(1),
});

const absoluteAllocationSchema = z.object({
  vehicleId: z.string().min(1),
  amount: z.number().min(0, 'Amount must be non-negative').transform(dollarsToCents),
});

const absoluteSplitSchema = z.object({
  method: z.literal('absolute'),
  allocations: z.array(absoluteAllocationSchema).min(1),
});

const percentageAllocationSchema = z.object({
  vehicleId: z.string().min(1),
  percentage: z.number().min(0).max(100, 'Percentage must be 0-100'),
});

const percentageSplitSchema = z.object({
  method: z.literal('percentage'),
  allocations: z.array(percentageAllocationSchema).min(1),
});

export const splitConfigSchema = z.discriminatedUnion('method', [
  evenSplitSchema,
  absoluteSplitSchema,
  percentageSplitSchema,
]) satisfies z.ZodType<SplitConfig>;

// Transform-free twin: running the dollars-to-cents transform on values already in cents would double-convert them.
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

export type { SplitConfig };

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
    // Insurance and reminder splits bypass this route, so only financing links are accepted from the API.
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
