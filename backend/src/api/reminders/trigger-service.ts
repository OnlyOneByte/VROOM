import { createId } from '@paralleldrive/cuid2';
import { CONFIG } from '../../config';
import { transaction } from '../../db/connection';
import type { Expense, Reminder, ReminderNotification } from '../../db/schema';
import { expenses, reminderNotifications } from '../../db/schema';
import type { DrizzleTransaction, SplitConfig } from '../../db/types';
import { ValidationError } from '../../errors';
import { expenseSplitService } from '../expenses/split-service';
import { odometerRepository } from '../odometer/repository';
import { notifyUser, type PushPayload } from '../push/push-service';
import type { ReminderWithVehicles } from './repository';
import { reminderRepository } from './repository';

export interface TriggerResult {
  createdExpenses: Expense[];
  notifications: ReminderNotification[];
  skipped: Array<{ reminderId: string; reason: string; message?: string }>;
}

function pushReminderSkipError(result: TriggerResult, reminderId: string, error: unknown): void {
  result.skipped.push({
    reminderId,
    reason: 'error',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}

function pushConcurrentTriggerSkip(result: TriggerResult, reminderId: string): void {
  result.skipped.push({ reminderId, reason: 'concurrent_trigger' });
}

function payloadFromReminder(reminder: Reminder, notification: ReminderNotification): PushPayload {
  const body =
    notification.dueOdometer !== null
      ? `Due at ${notification.dueOdometer.toLocaleString('en-US')} mi`
      : 'This reminder is now due';
  return { title: `${reminder.name} due`, body, tag: reminder.id, url: '/reminders' };
}

// notifyUser must never throw: the notification row is already committed when it runs.
async function firePushForNotification(
  reminder: Reminder,
  notification: ReminderNotification
): Promise<void> {
  await notifyUser(reminder.userId, payloadFromReminder(reminder, notification));
}

function clampToAnchorDay(next: Date, anchorDay: number): void {
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(anchorDay, lastDay));
}

function advanceCustom(
  next: Date,
  intervalValue: number,
  intervalUnit: string,
  anchorDay: number
): void {
  if (intervalValue <= 0) {
    throw new ValidationError(
      `Invalid reminder intervalValue ${intervalValue} (must be a positive integer)`
    );
  }
  switch (intervalUnit) {
    case 'day':
      next.setDate(next.getDate() + intervalValue);
      break;
    case 'week':
      next.setDate(next.getDate() + intervalValue * 7);
      break;
    case 'month':
      next.setDate(1);
      next.setMonth(next.getMonth() + intervalValue);
      clampToAnchorDay(next, anchorDay);
      break;
    case 'year':
      next.setDate(1);
      next.setFullYear(next.getFullYear() + intervalValue);
      clampToAnchorDay(next, anchorDay);
      break;
    default:
      throw new ValidationError(
        `Invalid reminder intervalUnit "${intervalUnit}" (expected day|week|month|year)`
      );
  }
}

export function computeNextDueDate(
  currentDueDate: Date,
  frequency: string,
  intervalValue?: number | null,
  intervalUnit?: string | null,
  anchorDay?: number
): Date {
  const next = new Date(currentDueDate.getTime());
  const dayTarget = anchorDay ?? currentDueDate.getDate();

  switch (frequency) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      clampToAnchorDay(next, dayTarget);
      break;
    case 'yearly':
      next.setDate(1);
      next.setFullYear(next.getFullYear() + 1);
      clampToAnchorDay(next, dayTarget);
      break;
    case 'custom':
      advanceCustom(next, intervalValue ?? 1, intervalUnit ?? 'day', dayTarget);
      break;
    default:
      throw new ValidationError(
        `Invalid reminder frequency "${frequency}" (expected weekly|monthly|yearly|custom)`
      );
  }

  return next;
}

export function advanceReminderDueDate(reminder: Reminder, from: Date): Date {
  return computeNextDueDate(
    from,
    reminder.frequency,
    reminder.intervalValue,
    reminder.intervalUnit,
    getAnchorDay(reminder)
  );
}

// bun:sqlite: keep transaction bodies synchronous; awaited statements autocommit separately.
function createExpenseFromReminder(
  tx: DrizzleTransaction,
  { reminder, vehicleIds }: ReminderWithVehicles,
  dueDate: Date
): Expense[] {
  const splitConfig = reminder.expenseSplitConfig as SplitConfig | null;
  const amount = reminder.expenseAmount ?? 0;
  const category = reminder.expenseCategory ?? 'misc';

  if (!splitConfig) {
    const vehicleId = vehicleIds[0];
    if (!vehicleId) {
      throw new ValidationError('Reminder has no linked vehicle to create an expense for');
    }
    const expense = tx
      .insert(expenses)
      .values({
        id: createId(),
        vehicleId,
        userId: reminder.userId,
        category,
        tags: reminder.expenseTags ?? null,
        date: dueDate,
        description: reminder.expenseDescription ?? null,
        expenseAmount: amount,
        missedFillup: false,
        mileage: null,
        volume: null,
        fuelType: null,
        sourceType: 'reminder',
        sourceId: reminder.id,
      })
      .returning()
      .get();
    return [expense];
  }

  const allocations = expenseSplitService.computeAllocations(splitConfig, amount);
  const groupId = createId();

  return expenseSplitService.createSiblingsSync(tx, {
    groupId,
    userId: reminder.userId,
    splitMethod: splitConfig.method,
    groupTotal: amount,
    allocations,
    category,
    date: dueDate,
    tags: reminder.expenseTags ?? undefined,
    description: reminder.expenseDescription ?? undefined,
    sourceType: 'reminder',
    sourceId: reminder.id,
  });
}

function getAnchorDay(reminder: Reminder): number {
  return reminder.startDate.getDate();
}

function hasReminderEndedBy(reminder: Reminder, nextDue: Date): boolean {
  return reminder.endDate != null && nextDue > reminder.endDate;
}

async function processExpensePeriod(
  reminder: Reminder,
  vehicleIds: string[],
  nextDue: Date,
  now: Date
): Promise<{ created: Expense[]; advancedDue: Date } | null> {
  const advancedDue = advanceReminderDueDate(reminder, nextDue);
  return transaction((tx) => {
    if (!reminderRepository.claimPeriodSync(tx, reminder.id, nextDue, advancedDue, now)) {
      return null;
    }
    return {
      created: createExpenseFromReminder(tx, { reminder, vehicleIds }, nextDue),
      advancedDue,
    };
  });
}

async function processNotificationPeriod(
  reminder: Reminder,
  nextDue: Date,
  now: Date
): Promise<{ created: ReminderNotification; advancedDue: Date } | null> {
  const advancedDue = advanceReminderDueDate(reminder, nextDue);
  return transaction((tx) => {
    if (!reminderRepository.claimPeriodSync(tx, reminder.id, nextDue, advancedDue, now)) {
      return null;
    }
    const created = tx
      .insert(reminderNotifications)
      .values({
        id: createId(),
        reminderId: reminder.id,
        userId: reminder.userId,
        dueDate: nextDue,
        isRead: false,
      })
      .returning()
      .get();
    return { created, advancedDue };
  });
}

async function processPeriod(
  reminder: Reminder,
  vehicleIds: string[],
  nextDue: Date,
  now: Date,
  result: TriggerResult
): Promise<Date | null> {
  if (reminder.type === 'expense') {
    const period = await processExpensePeriod(reminder, vehicleIds, nextDue, now);
    if (!period) return null;
    result.createdExpenses.push(...period.created);
    return period.advancedDue;
  }

  const period = await processNotificationPeriod(reminder, nextDue, now);
  if (!period) return null;
  result.notifications.push(period.created);
  await firePushForNotification(reminder, period.created);
  return period.advancedDue;
}

async function fastForwardPastNow(reminder: Reminder, currentDue: Date, now: Date): Promise<void> {
  const previousDue = currentDue;
  let nextDue = currentDue;
  while (nextDue <= now) {
    if (hasReminderEndedBy(reminder, nextDue)) {
      await reminderRepository.deactivate(reminder.id);
      return;
    }
    const advanced = advanceReminderDueDate(reminder, nextDue);
    if (advanced <= nextDue) {
      throw new ValidationError(
        `Reminder ${reminder.id} did not advance (frequency "${reminder.frequency}") — aborting fast-forward`
      );
    }
    nextDue = advanced;
  }
  if (hasReminderEndedBy(reminder, nextDue)) {
    await reminderRepository.deactivate(reminder.id);
    return;
  }
  await reminderRepository.advanceNextDueDate(reminder.id, previousDue, nextDue);
}

class ReminderTriggerService {
  async processOverdueReminders(userId: string): Promise<TriggerResult> {
    const now = new Date();
    const result: TriggerResult = { createdExpenses: [], notifications: [], skipped: [] };

    const overdueReminders = await reminderRepository.findOverdue(userId, now);
    for (const { reminder, vehicleIds } of overdueReminders) {
      try {
        await this.processReminder(reminder, vehicleIds, now, result);
      } catch (error) {
        pushReminderSkipError(result, reminder.id, error);
      }
    }

    const mileageReminders = await reminderRepository.findMileageTracking(userId);
    for (const { reminder, vehicleIds } of mileageReminders) {
      try {
        await this.processMileageReminder(reminder, vehicleIds, result);
      } catch (error) {
        pushReminderSkipError(result, reminder.id, error);
      }
    }

    return result;
  }

  async recheckMileageReminders(userId: string, vehicleId: string): Promise<TriggerResult> {
    const result: TriggerResult = { createdExpenses: [], notifications: [], skipped: [] };
    let mileageReminders: ReminderWithVehicles[];
    try {
      mileageReminders = await reminderRepository.findMileageTracking(userId);
    } catch (error) {
      result.skipped.push({
        reminderId: 'all',
        reason: 'recheck_query_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return result;
    }
    for (const { reminder, vehicleIds } of mileageReminders) {
      if (!vehicleIds.includes(vehicleId)) continue;
      try {
        await this.processMileageReminder(reminder, vehicleIds, result);
      } catch (error) {
        pushReminderSkipError(result, reminder.id, error);
      }
    }
    return result;
  }

  private async processMileageReminder(
    reminder: Reminder,
    vehicleIds: string[],
    result: TriggerResult
  ): Promise<void> {
    if (reminder.nextDueOdometer === null) return;
    if (vehicleIds.length !== 1) {
      result.skipped.push({ reminderId: reminder.id, reason: 'mileage_requires_single_vehicle' });
      return;
    }

    const currentOdometer = await odometerRepository.getCurrentOdometer(
      vehicleIds[0],
      reminder.userId
    );
    if (currentOdometer === null || currentOdometer < reminder.nextDueOdometer) {
      return;
    }

    if (await reminderRepository.mileageNotificationExists(reminder.id, reminder.nextDueOdometer)) {
      return;
    }

    const created = await reminderRepository.createMileageNotification(
      reminder.id,
      reminder.userId,
      reminder.nextDueOdometer
    );
    if (created) {
      result.notifications.push(created);
      await firePushForNotification(reminder, created);
    }
  }

  private async processReminder(
    reminder: Reminder,
    vehicleIds: string[],
    now: Date,
    result: TriggerResult
  ): Promise<void> {
    if (vehicleIds.length === 0) {
      result.skipped.push({ reminderId: reminder.id, reason: 'no_vehicles' });
      return;
    }

    if (reminder.nextDueDate === null) {
      return;
    }

    const maxCatchUp = CONFIG.validation.reminder.maxCatchUpOccurrences;
    let nextDue: Date = reminder.nextDueDate;
    let catchUpCount = 0;

    while (nextDue <= now && catchUpCount < maxCatchUp) {
      if (hasReminderEndedBy(reminder, nextDue)) {
        break;
      }

      const advancedDue = await processPeriod(reminder, vehicleIds, nextDue, now, result);
      if (advancedDue === null) {
        pushConcurrentTriggerSkip(result, reminder.id);
        return;
      }
      nextDue = advancedDue;

      catchUpCount++;
    }

    if (hasReminderEndedBy(reminder, nextDue)) {
      await reminderRepository.deactivate(reminder.id);
      return;
    }

    if (catchUpCount >= maxCatchUp && nextDue <= now) {
      await fastForwardPastNow(reminder, nextDue, now);
      result.skipped.push({ reminderId: reminder.id, reason: 'catch_up_limit_reached' });
    }
  }
}

export const reminderTriggerService = new ReminderTriggerService();
