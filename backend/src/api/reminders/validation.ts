import { z } from 'zod';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES } from '../../db/types';
import { splitConfigSchema } from '../expenses/validation';

const reminderTypeSchema = z.enum(['expense', 'notification']);
const frequencySchema = z.enum(['weekly', 'monthly', 'yearly', 'custom']);
const intervalUnitSchema = z.enum(['day', 'week', 'month', 'year']);

const reminderBaseSchema = z.object({
  name: z.string().min(1).max(CONFIG.validation.reminder.nameMaxLength),
  description: z.string().max(CONFIG.validation.reminder.descriptionMaxLength).optional(),
  type: reminderTypeSchema,
  actionMode: z.literal('automatic').default('automatic'),
  frequency: frequencySchema,
  intervalValue: z.number().int().positive().optional(),
  intervalUnit: intervalUnitSchema.optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  vehicleIds: z.array(z.string().min(1)).min(1),
  // Expense template fields (required when type = 'expense')
  expenseCategory: z.enum(EXPENSE_CATEGORIES).optional(),
  expenseTags: z
    .array(z.string().min(1).max(CONFIG.validation.reminder.tagMaxLength))
    .max(CONFIG.validation.reminder.maxTags)
    .optional(),
  expenseAmount: z.number().positive().max(CONFIG.validation.reminder.maxExpenseAmount).optional(),
  expenseDescription: z.string().max(CONFIG.validation.reminder.descriptionMaxLength).optional(),
  expenseSplitConfig: splitConfigSchema.optional(),
});

type ReminderInput = z.infer<typeof reminderBaseSchema>;

function refineCustomFrequency(data: ReminderInput, ctx: z.RefinementCtx) {
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

function refineExpenseType(data: ReminderInput, ctx: z.RefinementCtx) {
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

function refineDateRange(data: ReminderInput, ctx: z.RefinementCtx) {
  if (data.endDate && data.startDate && data.endDate <= data.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endDate must be after startDate',
      path: ['endDate'],
    });
  }
}

function refineSplitConfig(data: ReminderInput, ctx: z.RefinementCtx) {
  if (!data.expenseSplitConfig) return;

  const splitVehicleIds =
    data.expenseSplitConfig.method === 'even'
      ? data.expenseSplitConfig.vehicleIds
      : data.expenseSplitConfig.allocations.map((a) => a.vehicleId);
  const provided = new Set(data.vehicleIds);
  const split = new Set(splitVehicleIds);

  if (provided.size !== split.size || ![...provided].every((id) => split.has(id))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Split config vehicle IDs must match vehicleIds',
      path: ['expenseSplitConfig'],
    });
  }

  // Percentage allocations must sum to 100
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

  // Absolute allocations must sum to expenseAmount
  if (data.expenseSplitConfig.method === 'absolute' && data.expenseAmount !== undefined) {
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
});

export const updateReminderSchema = createReminderSchema.partial();
