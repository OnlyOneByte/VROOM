import { z } from 'zod';
import { Currency, PaymentFrequency } from '../../types/enums';

/**
 * Common validation schemas
 */

export const idSchema = z.string().min(1, 'ID is required');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

/**
 * Vehicle validation schemas
 */

export const createVehicleSchema = z.object({
  make: z.string().min(1, 'Make is required').max(50, 'Make must be 50 characters or less').trim(),
  model: z
    .string()
    .min(1, 'Model is required')
    .max(50, 'Model must be 50 characters or less')
    .trim(),
  year: z
    .number()
    .int()
    .min(1900, 'Year must be 1900 or later')
    .max(new Date().getFullYear() + 1, 'Year cannot be in the future'),
  licensePlate: z
    .string()
    .max(20, 'License plate must be 20 characters or less')
    .trim()
    .optional()
    .transform((val) => val || undefined),
  nickname: z
    .string()
    .max(50, 'Nickname must be 50 characters or less')
    .trim()
    .optional()
    .transform((val) => val || undefined),
  initialMileage: z.number().int().min(0, 'Initial mileage cannot be negative').optional(),
  purchasePrice: z.number().min(0, 'Purchase price cannot be negative').optional(),
  purchaseDate: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
});

export const updateVehicleSchema = createVehicleSchema.partial();

export const vehicleParamsSchema = z.object({
  id: idSchema,
});

/**
 * Expense validation schemas
 */

export const createExpenseSchema = z.object({
  vehicleId: idSchema,
  tags: z.array(z.string()).default([]),
  category: z.enum(['fuel', 'maintenance', 'financial', 'regulatory', 'enhancement', 'misc'], {
    message: 'Invalid expense category',
  }),
  amount: z
    .number()
    .positive('Amount must be positive')
    .max(1000000, 'Amount cannot exceed $1,000,000'),
  currency: z.nativeEnum(Currency).default(Currency.USD),
  date: z.string().datetime(),
  mileage: z.number().int().min(0, 'Mileage cannot be negative').optional(),
  gallons: z
    .number()
    .positive('Gallons must be positive')
    .max(1000, 'Gallons cannot exceed 1000')
    .optional(),
  description: z
    .string()
    .max(500, 'Description must be 500 characters or less')
    .trim()
    .optional()
    .transform((val) => val || undefined),
  receiptUrl: z
    .string()
    .url('Receipt URL must be a valid URL')
    .optional()
    .transform((val) => val || undefined),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const expenseParamsSchema = z.object({
  id: idSchema,
  vehicleId: idSchema.optional(),
});

export const expenseQuerySchema = z.object({
  ...paginationSchema.shape,
  ...dateRangeSchema.shape,
  tags: z.array(z.string()).optional(),
  category: z
    .enum(['fuel', 'maintenance', 'financial', 'regulatory', 'enhancement', 'misc'])
    .optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
});

/**
 * Loan validation schemas
 */

export const createLoanSchema = z.object({
  lender: z
    .string()
    .min(1, 'Lender is required')
    .max(100, 'Lender must be 100 characters or less')
    .trim(),
  originalAmount: z
    .number()
    .positive('Original amount must be positive')
    .max(10000000, 'Original amount cannot exceed $10,000,000'),
  currentBalance: z
    .number()
    .min(0, 'Current balance cannot be negative')
    .max(10000000, 'Current balance cannot exceed $10,000,000'),
  apr: z.number().min(0, 'APR cannot be negative').max(100, 'APR cannot exceed 100%'),
  termMonths: z
    .number()
    .int()
    .min(1, 'Term must be at least 1 month')
    .max(600, 'Term cannot exceed 600 months'),
  startDate: z.string().datetime(),
  paymentAmount: z
    .number()
    .positive('Payment amount must be positive')
    .max(100000, 'Payment amount cannot exceed $100,000'),
  paymentFrequency: z.nativeEnum(PaymentFrequency).default(PaymentFrequency.MONTHLY),
  paymentDayOfMonth: z.number().int().min(1).max(31).optional(),
  paymentDayOfWeek: z.number().int().min(0).max(6).optional(),
});

export const updateLoanSchema = createLoanSchema.partial();

export const loanParamsSchema = z.object({
  id: idSchema,
  vehicleId: idSchema.optional(),
});

export const loanPaymentSchema = z.object({
  paymentAmount: z
    .number()
    .positive('Payment amount must be positive')
    .max(100000, 'Payment amount cannot exceed $100,000'),
  paymentDate: z.string().datetime().optional(),
  extraPrincipal: z
    .number()
    .min(0, 'Extra principal cannot be negative')
    .max(100000, 'Extra principal cannot exceed $100,000')
    .optional(),
});

/**
 * Insurance validation schemas
 */

export const createInsurancePolicySchema = z.object({
  company: z
    .string()
    .min(1, 'Company is required')
    .max(100, 'Company must be 100 characters or less')
    .trim(),
  policyNumber: z
    .string()
    .max(50, 'Policy number must be 50 characters or less')
    .trim()
    .optional()
    .transform((val) => val || undefined),
  totalCost: z
    .number()
    .positive('Total cost must be positive')
    .max(100000, 'Total cost cannot exceed $100,000'),
  termLengthMonths: z
    .number()
    .int()
    .min(1, 'Term length must be at least 1 month')
    .max(24, 'Term length cannot exceed 24 months'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export const updateInsurancePolicySchema = createInsurancePolicySchema.partial();

export const insurancePolicyParamsSchema = z.object({
  id: idSchema,
  vehicleId: idSchema.optional(),
});

/**
 * Analytics validation schemas
 */

export const analyticsQuerySchema = z.object({
  ...dateRangeSchema.shape,
  vehicleId: idSchema.optional(),
  groupBy: z.enum(['day', 'week', 'month', 'year']).default('month'),
  includeProjections: z.coerce.boolean().default(false),
});

/**
 * User validation schemas
 */

export const updateUserProfileSchema = z.object({
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be 100 characters or less')
    .trim()
    .optional(),
  preferences: z
    .object({
      currency: z.nativeEnum(Currency).optional(),
      dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).optional(),
      distanceUnit: z.enum(['miles', 'kilometers']).optional(),
      fuelUnit: z.enum(['gallons', 'liters']).optional(),
    })
    .optional(),
});

/**
 * Validation refinements and custom validators
 */

// Ensure end date is after start date
export const dateRangeRefinement = <T extends { startDate?: string; endDate?: string }>(
  schema: z.ZodType<T>
) => {
  return schema.refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    {
      message: 'End date must be after start date',
      path: ['endDate'],
    }
  );
};

// Ensure current balance is not greater than original amount
export const loanBalanceRefinement = createLoanSchema.refine(
  (data) => data.currentBalance <= data.originalAmount,
  {
    message: 'Current balance cannot be greater than original amount',
    path: ['currentBalance'],
  }
);

// Ensure insurance end date is after start date
export const insuranceDateRefinement = createInsurancePolicySchema.refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  {
    message: 'End date must be after start date',
    path: ['endDate'],
  }
);

// Fuel expense validation - require gallons and mileage for fuel expenses
export const fuelExpenseRefinement = createExpenseSchema.refine(
  (data) => {
    if (data.category === 'fuel') {
      return data.gallons !== undefined && data.mileage !== undefined;
    }
    return true;
  },
  {
    message: 'Gallons and mileage are required for fuel expenses',
    path: ['gallons'],
  }
);
