import { z } from 'zod';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES } from '../../db/types';
import { splitConfigSchema } from '../expenses/validation';

const reminderTypeSchema = z.enum(['expense', 'notification']);
const frequencySchema = z.enum(['weekly', 'monthly', 'yearly', 'custom']);
const intervalUnitSchema = z.enum(['day', 'week', 'month', 'year']);
const triggerModeSchema = z.enum(['time', 'mileage', 'both']);

// Nullable DB-backed fields use .nullish() (accept undefined OR null), NOT
// .optional() (undefined only). The update flow merges the existing DB row —
// whose unset optional columns come back as `null` — and re-validates the
// merged object with createReminderSchema; with .optional() those nulls fail
// validation and EVERY update (incl. the pause/resume toggle) 400s.
const reminderBaseSchema = z.object({
  name: z.string().min(1).max(CONFIG.validation.reminder.nameMaxLength),
  description: z.string().max(CONFIG.validation.reminder.descriptionMaxLength).nullish(),
  type: reminderTypeSchema,
  actionMode: z.literal('automatic').default('automatic'),
  frequency: frequencySchema,
  intervalValue: z.number().int().positive().nullish(),
  intervalUnit: intervalUnitSchema.nullish(),
  // Maintenance-schedule (T4). triggerMode is OPTIONAL, not `.default('time')`: a default would
  // survive `.partial()` on the update schema and silently flip an existing mileage reminder back to
  // 'time' on any update that omits the field. Absent on create → the DB column default ('time')
  // applies; absent on update → the merge keeps the existing value. intervalMileage/
  // lastServiceOdometer are the mileage axis inputs; nextDueOdometer is SERVER-DERIVED (=
  // lastServiceOdometer + intervalMileage) in the route, never client input. Refined per D4 below.
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
  // Active/paused flag. Optional on create (defaults active in the DB); on
  // update this is what the pause/resume toggle flips — it must be accepted
  // here or Zod strips it and the toggle silently no-ops.
  isActive: z.boolean().optional(),
  vehicleIds: z.array(z.string().min(1)).min(1),
  // Expense template fields (required when type = 'expense')
  expenseCategory: z.enum(EXPENSE_CATEGORIES).nullish(),
  expenseTags: z
    .array(z.string().min(1).max(CONFIG.validation.reminder.tagMaxLength))
    .max(CONFIG.validation.reminder.maxTags)
    .nullish(),
  expenseAmount: z.number().positive().max(CONFIG.validation.reminder.maxExpenseAmount).nullish(),
  expenseDescription: z.string().max(CONFIG.validation.reminder.descriptionMaxLength).nullish(),
  expenseSplitConfig: splitConfigSchema.nullish(),
});

type ReminderInput = z.infer<typeof reminderBaseSchema>;
// Refinements run against both the full create schema and the partial update
// schema, so accept a partial shape — each helper guards on the fields it needs.
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
  // Only the mileage axis ('mileage' | 'both') has extra requirements (D4). 'time' (the default)
  // is unconstrained here.
  if (data.triggerMode !== 'mileage' && data.triggerMode !== 'both') return;

  if (!data.intervalMileage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'intervalMileage is required (positive) for a mileage reminder',
      path: ['intervalMileage'],
    });
  }
  // NOTE: lastServiceOdometer is NOT required from the client — the route defaults it to the
  // vehicle's current odometer when omitted (D4). The field-level schema already constrains it to a
  // non-negative int IF provided, so there's nothing to add here. (Earlier this required presence,
  // which wrongly rejected the documented default-on-create behavior.)
  // D4: a mileage axis tracks ONE vehicle (the odometer is per-vehicle).
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

// Note: `.partial()` cannot be called on a schema that already has refinements
// (Zod v4 throws). Partial-ize the base object first, then re-apply the same
// cross-field refinements. The refine helpers guard on each field, so missing
// (undefined) fields in a partial update are handled correctly.
export const updateReminderSchema = reminderBaseSchema.partial().superRefine((data, ctx) => {
  refineCustomFrequency(data, ctx);
  refineExpenseType(data, ctx);
  refineDateRange(data, ctx);
  refineSplitConfig(data, ctx);
  refineMileageTrigger(data, ctx);
});
