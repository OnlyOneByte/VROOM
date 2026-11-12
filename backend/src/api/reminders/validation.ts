import { z } from 'zod';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES } from '../../db/types';
import { moneyDollarsToCents } from '../../utils/money';
import {
  splitConfigSchema,
  splitConfigStructuralSchema,
  splitConfigVehicleIds,
} from '../expenses/validation';

const reminderTypeSchema = z.enum(['expense', 'notification']);
const frequencySchema = z.enum(['weekly', 'monthly', 'yearly', 'custom']);
const intervalUnitSchema = z.enum(['day', 'week', 'month', 'year']);
const triggerModeSchema = z.enum(['time', 'mileage', 'both']);

// Use .nullish() for nullable DB columns: the PUT merge re-validates DB rows, whose unset columns are null.
const reminderBaseSchema = z.object({
  name: z.string().min(1).max(CONFIG.validation.reminder.nameMaxLength),
  description: z.string().max(CONFIG.validation.reminder.descriptionMaxLength).nullish(),
  type: reminderTypeSchema,
  actionMode: z.literal('automatic').default('automatic'),
  frequency: frequencySchema,
  intervalValue: z.number().int().positive().nullish(),
  intervalUnit: intervalUnitSchema.nullish(),
  // Not defaulted: a default survives .partial() and flips existing mileage reminders to 'time'.
  triggerMode: triggerModeSchema.optional(),
  intervalMileage: z
    .number()
    .int()
    .positive()
    .max(CONFIG.validation.reminder.maxIntervalMileage)
    .nullish(),
  lastServiceOdometer: z.number().int().min(0).nullish(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish(),
  // Zod strips unlisted keys: isActive must stay listed or the pause toggle silently no-ops.
  isActive: z.boolean().optional(),
  vehicleIds: z.array(z.string().min(1)).min(1),
  expenseCategory: z.enum(EXPENSE_CATEGORIES).nullish(),
  expenseTags: z
    .array(z.string().min(1).max(CONFIG.validation.reminder.tagMaxLength))
    .max(CONFIG.validation.reminder.maxTags)
    .nullish(),
  expenseAmount: moneyDollarsToCents((n) =>
    n.positive().max(CONFIG.validation.reminder.maxExpenseAmount)
  ).nullish(),
  expenseDescription: z.string().max(CONFIG.validation.reminder.descriptionMaxLength).nullish(),
  expenseSplitConfig: splitConfigSchema.nullish(),
});

type ReminderInput = z.infer<typeof reminderBaseSchema>;
type ReminderRefineInput = Partial<ReminderInput>;

function refineCustomFrequency(data: ReminderRefineInput, ctx: z.RefinementCtx) {
  if (data.frequency !== 'custom') return;
  if (!data.intervalValue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'intervalValue required for custom frequency',
      path: ['intervalValue'],
    });
  }
  if (!data.intervalUnit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'intervalUnit required for custom frequency',
      path: ['intervalUnit'],
    });
  }
}

function refineExpenseType(data: ReminderRefineInput, ctx: z.RefinementCtx) {
  if (data.type !== 'expense') return;
  if (!data.expenseCategory) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'expenseCategory required for expense reminders',
      path: ['expenseCategory'],
    });
  }
  if (!data.expenseAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'expenseAmount required for automatic expense reminders',
      path: ['expenseAmount'],
    });
  }
}

function refineMileageTrigger(data: ReminderRefineInput, ctx: z.RefinementCtx) {
  if (data.triggerMode !== 'mileage' && data.triggerMode !== 'both') return;

  if (!data.intervalMileage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'intervalMileage is required (positive) for a mileage reminder',
      path: ['intervalMileage'],
    });
  }
  if (data.vehicleIds && data.vehicleIds.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A mileage reminder must be linked to exactly one vehicle',
      path: ['vehicleIds'],
    });
  }
}

function refineDateRange(data: ReminderRefineInput, ctx: z.RefinementCtx) {
  if (data.endDate && data.startDate && data.endDate <= data.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endDate must be after startDate',
      path: ['endDate'],
    });
  }
}

function refineSplitConfig(data: ReminderRefineInput, ctx: z.RefinementCtx) {
  if (!data.expenseSplitConfig) return;

  if (data.vehicleIds) {
    const provided = new Set(data.vehicleIds);
    const split = new Set(splitConfigVehicleIds(data.expenseSplitConfig));

    if (provided.size !== split.size || ![...provided].every((id) => split.has(id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Split config vehicle IDs must match vehicleIds',
        path: ['expenseSplitConfig'],
      });
    }
  }

  if (data.expenseSplitConfig.method === 'percentage') {
    const sum = data.expenseSplitConfig.allocations.reduce((acc, a) => acc + a.percentage, 0);
    if (Math.abs(sum - 100) >= 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Percentage allocations must sum to 100',
        path: ['expenseSplitConfig', 'allocations'],
      });
    }
  }

  if (data.expenseSplitConfig.method === 'absolute' && data.expenseAmount != null) {
    const sum = data.expenseSplitConfig.allocations.reduce((acc, a) => acc + a.amount, 0);
    if (Math.abs(sum - data.expenseAmount) >= 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Absolute allocations must sum to expenseAmount',
        path: ['expenseSplitConfig', 'allocations'],
      });
    }
  }
}

export const createReminderSchema = reminderBaseSchema.superRefine((data, ctx) => {
  refineCustomFrequency(data, ctx);
  refineExpenseType(data, ctx);
  refineDateRange(data, ctx);
  refineSplitConfig(data, ctx);
  refineMileageTrigger(data, ctx);
});

// Zod v4 throws on .partial() after refinements, so partialize the base object first.
export const updateReminderSchema = reminderBaseSchema.partial().superRefine((data, ctx) => {
  refineCustomFrequency(data, ctx);
  refineExpenseType(data, ctx);
  refineDateRange(data, ctx);
  refineSplitConfig(data, ctx);
  refineMileageTrigger(data, ctx);
});

// Transform-free: merged data already holds cents, so re-running the dollar transform would double-convert.
const reminderMergeGateSchema = reminderBaseSchema
  .extend({
    expenseAmount: z.number().nonnegative().nullish(),
    expenseSplitConfig: splitConfigStructuralSchema.nullish(),
  })
  .superRefine((data, ctx) => {
    refineCustomFrequency(data, ctx);
    refineExpenseType(data, ctx);
    refineDateRange(data, ctx);
    refineSplitConfig(data, ctx);
    refineMileageTrigger(data, ctx);
  });

export function assertMergedReminderValid(merged: unknown): void {
  reminderMergeGateSchema.parse(merged);
}
