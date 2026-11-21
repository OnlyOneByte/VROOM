import { z } from 'zod';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES } from '../../db/types';
import { expenseDollarsToCents } from '../../utils/money';
import { isValidTimeZone, zoneOffsetMs } from '../../utils/time-zone';
import {
  dateInput,
  MAX_ODOMETER_READING,
  ODOMETER_TOO_HIGH_MESSAGE,
  WHOLE_DISTANCE_MESSAGE,
} from '../../utils/validation';
import { buildCalendarDate } from '../expenses/local-date';
import {
  FUEL_SPLIT_MESSAGE,
  splitConfigSchema,
  splitConfigStructuralSchema,
  splitConfigVehicleIds,
} from '../expenses/validation';

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_INTERVAL_YEARS = CONFIG.validation.reminder.maxIntervalYears;
const MAX_INTERVAL_BY_UNIT = {
  day: Math.ceil(MAX_INTERVAL_YEARS * 365.25),
  week: Math.ceil((MAX_INTERVAL_YEARS * 365.25) / 7),
  month: MAX_INTERVAL_YEARS * 12,
  year: MAX_INTERVAL_YEARS,
} as const;
const MAX_INTERVAL_MESSAGE = `The interval can be at most ${MAX_INTERVAL_YEARS} years`;
const REMINDER_DATE_FIELDS = ['startDate', 'endDate'] as const;

function plainDateToInstant(value: string, timeZone: string | undefined): Date | null {
  const parts = PLAIN_DATE.exec(value);
  if (!parts) return null;
  const utcNoon = buildCalendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3]));
  if (!utcNoon) return new Date(Number.NaN);
  if (!timeZone) return utcNoon;
  const guess = utcNoon.getTime() - zoneOffsetMs(utcNoon.getTime(), timeZone);
  return new Date(utcNoon.getTime() - zoneOffsetMs(guess, timeZone));
}

const reminderDateSchema = z.preprocess(
  (value) => (typeof value === 'string' ? (plainDateToInstant(value, undefined) ?? value) : value),
  dateInput
);

function withZonedPlainDates(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const timeZone = input.timeZone;
  if (typeof timeZone !== 'string' || !isValidTimeZone(timeZone)) return value;
  const zoned = { ...input };
  for (const field of REMINDER_DATE_FIELDS) {
    const raw = input[field];
    if (typeof raw === 'string') zoned[field] = plainDateToInstant(raw, timeZone) ?? raw;
  }
  return zoned;
}

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
  intervalValue: z
    .number()
    .int()
    .positive()
    .max(MAX_INTERVAL_BY_UNIT.day, MAX_INTERVAL_MESSAGE)
    .nullish(),
  intervalUnit: intervalUnitSchema.nullish(),
  // Not defaulted: a default survives .partial() and flips existing mileage reminders to 'time'.
  triggerMode: triggerModeSchema.optional(),
  intervalMileage: z
    .number()
    .int(WHOLE_DISTANCE_MESSAGE)
    .positive()
    .max(CONFIG.validation.reminder.maxIntervalMileage)
    .nullish(),
  lastServiceOdometer: z
    .number()
    .int(WHOLE_DISTANCE_MESSAGE)
    .min(0)
    .max(MAX_ODOMETER_READING, ODOMETER_TOO_HIGH_MESSAGE)
    .nullish(),
  startDate: reminderDateSchema,
  endDate: reminderDateSchema.nullish(),
  // Zod strips unlisted keys: isActive must stay listed or the pause toggle silently no-ops.
  isActive: z.boolean().optional(),
  timeZone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional(),
  vehicleIds: z.array(z.string().min(1)).min(1),
  expenseCategory: z.enum(EXPENSE_CATEGORIES).nullish(),
  expenseTags: z
    .array(z.string().min(1).max(CONFIG.validation.reminder.tagMaxLength))
    .max(CONFIG.validation.reminder.maxTags)
    .nullish(),
  expenseAmount: expenseDollarsToCents((n) =>
    n.positive().max(CONFIG.validation.reminder.maxExpenseAmount)
  ).nullish(),
  expenseDescription: z.string().max(CONFIG.validation.reminder.descriptionMaxLength).nullish(),
  expenseSplitConfig: splitConfigSchema.nullish(),
});

type ReminderInput = z.infer<typeof reminderBaseSchema>;
type ReminderRefineInput = Partial<ReminderInput>;

function refineCustomFrequency(data: ReminderRefineInput, ctx: z.RefinementCtx) {
  if (data.frequency !== 'custom' || data.triggerMode === 'mileage') return;
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

function refineIntervalBound(data: ReminderRefineInput, ctx: z.RefinementCtx) {
  if (
    data.intervalValue &&
    data.intervalUnit &&
    data.intervalValue > MAX_INTERVAL_BY_UNIT[data.intervalUnit]
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: MAX_INTERVAL_MESSAGE,
      path: ['intervalValue'],
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
      message: 'Enter an amount greater than 0',
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

function refineFuelSplit(data: ReminderRefineInput, ctx: z.RefinementCtx) {
  if (data.expenseCategory === 'fuel' && data.expenseSplitConfig) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: FUEL_SPLIT_MESSAGE,
      path: ['expenseCategory'],
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
        message: 'Split amounts must total the expense amount',
        path: ['expenseSplitConfig', 'allocations'],
      });
    }
  }
}

export const createReminderSchema = z.preprocess(
  withZonedPlainDates,
  reminderBaseSchema.superRefine((data, ctx) => {
    refineCustomFrequency(data, ctx);
    refineIntervalBound(data, ctx);
    refineExpenseType(data, ctx);
    refineDateRange(data, ctx);
    refineSplitConfig(data, ctx);
    refineFuelSplit(data, ctx);
    refineMileageTrigger(data, ctx);
  })
);

// Zod v4 throws on .partial() after refinements, so partialize the base object first.
export const updateReminderSchema = z.preprocess(
  withZonedPlainDates,
  reminderBaseSchema.partial().superRefine((data, ctx) => {
    refineCustomFrequency(data, ctx);
    refineIntervalBound(data, ctx);
    refineExpenseType(data, ctx);
    refineDateRange(data, ctx);
    refineSplitConfig(data, ctx);
    refineFuelSplit(data, ctx);
    refineMileageTrigger(data, ctx);
  })
);

// Transform-free: merged data already holds cents, so re-running the dollar transform would double-convert.
const reminderMergeGateSchema = reminderBaseSchema
  .extend({
    expenseAmount: z.number().nonnegative().nullish(),
    expenseSplitConfig: splitConfigStructuralSchema.nullish(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullish(),
    intervalValue: z.number().int().positive().nullish(),
    lastServiceOdometer: z.number().int().min(0).nullish(),
  })
  .superRefine((data, ctx) => {
    refineCustomFrequency(data, ctx);
    refineExpenseType(data, ctx);
    refineDateRange(data, ctx);
    refineSplitConfig(data, ctx);
    refineMileageTrigger(data, ctx);
  });

const reminderMergeGateWithFuelSplitSchema = reminderMergeGateSchema.superRefine(refineFuelSplit);

const reminderIntervalBoundSchema = z
  .object({ intervalValue: z.number().nullish(), intervalUnit: intervalUnitSchema.nullish() })
  .superRefine(refineIntervalBound);

const FUEL_SPLIT_FIELDS = ['expenseCategory', 'expenseSplitConfig', 'vehicleIds'] as const;
const INTERVAL_FIELDS = ['intervalValue', 'intervalUnit'] as const;

export function assertMergedReminderValid(
  merged: unknown,
  update: Partial<
    Record<(typeof FUEL_SPLIT_FIELDS)[number] | (typeof INTERVAL_FIELDS)[number], unknown>
  > = {}
): void {
  const touchesFuelSplit = FUEL_SPLIT_FIELDS.some((field) => update[field] !== undefined);
  (touchesFuelSplit ? reminderMergeGateWithFuelSplitSchema : reminderMergeGateSchema).parse(merged);
  if (INTERVAL_FIELDS.some((field) => update[field] !== undefined)) {
    reminderIntervalBoundSchema.parse(merged);
  }
}
