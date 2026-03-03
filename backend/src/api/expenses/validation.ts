import { z } from 'zod';

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
    tags: z.array(z.string()).optional(),
    date: z.coerce.date(),
    description: z.string().optional(),
    totalAmount: z.number().positive('Amount must be positive'),
    insurancePolicyId: z.string().optional(),
    insuranceTermId: z.string().optional(),
  })
  .superRefine(refineSplitConfig);

export const updateSplitSchema = z
  .object({
    splitConfig: splitConfigSchema,
    totalAmount: z.number().positive().optional(),
  })
  .superRefine(refineSplitConfig);
