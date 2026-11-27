import { z } from 'zod';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES, isElectricFuelType, type SplitConfig } from '../../db/types';
import { dollarsToCents, expenseDollarsToCents, formatNumberForMessage } from '../../utils/money';
import { DUPLICATE_VEHICLE_MESSAGE, dateInput, hasUniqueVehicleIds } from '../../utils/validation';

export const MILEAGE_NOT_POSITIVE_MESSAGE = 'Mileage must be greater than 0';

export interface OdometerNeighbours {
  before: number | null;
  after: number | null;
}

export interface OdometerCheck {
  vehicleId: string;
  mileage: number;
  date: Date;
  timeZone: string;
  excludeId?: string;
  initialMileage?: number | null;
}

export function odometerOrderError(
  mileage: number,
  { before, after }: OdometerNeighbours,
  initialMileage?: number | null
): string | null {
  if (initialMileage && mileage < initialMileage) {
    return 'Mileage cannot be less than initial mileage';
  }
  if (before != null && mileage <= before) {
    return `Mileage must be greater than ${formatNumberForMessage(before)} (from earlier entry)`;
  }
  if (after != null && mileage >= after) {
    return `Mileage must be less than ${formatNumberForMessage(after)} (from later entry)`;
  }
  return null;
}

export const FUEL_SPLIT_MESSAGE = 'Fuel expenses cannot be split. Log the fill-up on one vehicle.';

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
    chargerType?: string | null;
    missedFillup?: boolean;
  },
>(
  data: T,
  effectiveCategory: string | undefined = data.category,
  effectiveFuelType: string | null | undefined = data.fuelType
): T {
  if (effectiveCategory === undefined || effectiveCategory === 'fuel') {
    return isElectricFuelType(effectiveFuelType ?? null) ? data : { ...data, chargerType: null };
  }
  return { ...data, volume: null, fuelType: null, chargerType: null, missedFillup: false };
}

const centsAmount = expenseDollarsToCents((n) => n.positive('Amount must be positive'));

export function percentageToBasisPoints(percentage: number): number {
  return Math.round(percentage * 100);
}

export function percentagesSumTo100(allocations: { percentage: number }[]): boolean {
  const sum = allocations.reduce((acc, a) => acc + a.percentage, 0);
  return percentageToBasisPoints(sum) === 10_000;
}

function allocationVehiclesAreUnique(allocations: { vehicleId: string }[]): boolean {
  return hasUniqueVehicleIds(allocations.map((a) => a.vehicleId));
}

const evenSplitVehicleIdsSchema = z.array(z.string().min(1)).min(1);

const evenSplitSchema = z.object({
  method: z.literal('even'),
  vehicleIds: evenSplitVehicleIdsSchema.refine(hasUniqueVehicleIds, DUPLICATE_VEHICLE_MESSAGE),
});

const absoluteAllocationSchema = z.object({
  vehicleId: z.string().min(1),
  amount: expenseDollarsToCents((n) => n.min(0, 'Amount must be non-negative')),
});

const absoluteSplitSchema = z.object({
  method: z.literal('absolute'),
  allocations: z
    .array(absoluteAllocationSchema)
    .min(1)
    .refine(allocationVehiclesAreUnique, DUPLICATE_VEHICLE_MESSAGE),
});

const percentageAllocationSchema = z.object({
  vehicleId: z.string().min(1),
  percentage: z.number().min(0).max(100, 'Percentage must be 0-100'),
});

const percentageSplitSchema = z.object({
  method: z.literal('percentage'),
  allocations: z
    .array(percentageAllocationSchema)
    .min(1)
    .refine(allocationVehiclesAreUnique, DUPLICATE_VEHICLE_MESSAGE),
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
  z.object({ method: z.literal('even'), vehicleIds: evenSplitVehicleIdsSchema }),
  z.object({
    method: z.literal('absolute'),
    allocations: z.array(absoluteAllocationStructuralSchema).min(1),
  }),
  z.object({
    method: z.literal('percentage'),
    allocations: z.array(percentageAllocationSchema).min(1),
  }),
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
    if (!percentagesSumTo100(splitConfig.allocations)) {
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
    category: z.enum(EXPENSE_CATEGORIES).refine((category) => category !== 'fuel', {
      message: FUEL_SPLIT_MESSAGE,
    }),
    tags: z.array(tagElementSchema).max(CONFIG.validation.expense.maxTags).optional(),
    date: dateInput,
    description: z
      .string()
      .max(
        CONFIG.validation.expense.descriptionMaxLength,
        `Description must be ${CONFIG.validation.expense.descriptionMaxLength} characters or less`
      )
      .optional(),
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

export const expectedUpdatedAtSchema = z
  .string()
  .datetime({ offset: true, message: 'expectedUpdatedAt must be an ISO date-time' })
  .transform((value) => new Date(value))
  .optional();

export const updateSplitSchema = z
  .object({
    splitConfig: splitConfigSchema,
    totalAmount: centsAmount.optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .superRefine((data, ctx) => {
    refineSplitConfig(data, ctx);
    if (data.splitConfig.method !== 'absolute' || data.totalAmount !== undefined) return;
    const total = data.splitConfig.allocations.reduce((acc, a) => acc + a.amount, 0);
    const max = CONFIG.validation.expense.maxAmount;
    if (total <= 0 || total > dollarsToCents(max)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `The split total must be more than 0 and at most ${formatNumberForMessage(max)}`,
        path: ['splitConfig', 'allocations'],
      });
    }
  });
