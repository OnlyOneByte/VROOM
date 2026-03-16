import { createId } from '@paralleldrive/cuid2';
import { CONFIG } from '../../config';
import { transaction } from '../../db/connection';
import type { Expense, Reminder, ReminderNotification } from '../../db/schema';
import { expenses, reminderNotifications } from '../../db/schema';
import type { DrizzleTransaction, ReminderSplitConfig } from '../../db/types';
import { expenseSplitService } from '../expenses/split-service';
import type { ReminderWithVehicles } from './repository';
import { reminderRepository } from './repository';

// ============================================================================
// Types
// ============================================================================

export interface TriggerResult {
  createdExpenses: Expense[];
  notifications: ReminderNotification[];
  skipped: Array<{ reminderId: string; reason: string; message?: string }>;
}

// ============================================================================
// Helpers
// ============================================================================

/** Apply anchor-day clamping after advancing month/year on a Date. */
function clampToAnchorDay(next: Date, anchorDay: number): void {
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(anchorDay, lastDay));
}

/** Compute the next due date for a reminder given its frequency config. */
function advanceCustom(
  next: Date,
  intervalValue: number,
  intervalUnit: string,
  anchorDay: number
): void {
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
  }
}

// ============================================================================
// Date Advancement
// ============================================================================

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
  }

  return next;
}

// ============================================================================
// Expense Creation
// ============================================================================

async function createExpenseFromReminder(
  tx: DrizzleTransaction,
  { reminder, vehicleIds }: ReminderWithVehicles,
  dueDate: Date
): Promise<Expense[]> {
  const splitConfig = reminder.expenseSplitConfig as ReminderSplitConfig | null;
  const amount = reminder.expenseAmount ?? 0;
  const category = reminder.expenseCategory ?? 'misc';

  if (!splitConfig) {
    // Single-vehicle expense — use first (only) vehicle from junction
    const [expense] = await tx
      .insert(expenses)
      .values({
        id: createId(),
        vehicleId: vehicleIds[0],
        userId: reminder.userId,
        category,
        tags: reminder.expenseTags ?? null,
        date: dueDate,
        description: reminder.expenseDescription ?? null,
        expenseAmount: amount,
        isFinancingPayment: false,
        missedFillup: false,
        mileage: null,
        volume: null,
        fuelType: null,
        sourceType: 'reminder',
        sourceId: reminder.id,
      })
      .returning();
    return [expense];
  }

  // Split expense — reuse existing ExpenseSplitService
  const allocations = expenseSplitService.computeAllocations(splitConfig, amount);
  const groupId = createId();

  const siblings = await expenseSplitService.createSiblings(tx, {
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

  return siblings;
}

// ============================================================================
// Trigger Service
// ============================================================================

function getAnchorDay(reminder: Reminder): number {
  return reminder.startDate.getDate();
}

async function processExpensePeriod(
  reminder: Reminder,
  vehicleIds: string[],
  nextDue: Date,
  now: Date
): Promise<{ created: Expense[]; advancedDue: Date }> {
  return transaction(async (tx) => {
    const created = await createExpenseFromReminder(tx, { reminder, vehicleIds }, nextDue);
    const advancedDue = computeNextDueDate(
      nextDue,
      reminder.frequency,
      reminder.intervalValue,
      reminder.intervalUnit,
      getAnchorDay(reminder)
    );
    await reminderRepository.advanceNextDueDateTx(tx, reminder.id, nextDue, advancedDue, now);
    return { created, advancedDue };
  });
}

async function processNotificationPeriod(
  reminder: Reminder,
  nextDue: Date,
  now: Date
): Promise<{ created: ReminderNotification; advancedDue: Date }> {
  return transaction(async (tx) => {
    const [created] = await tx
      .insert(reminderNotifications)
      .values({
        id: createId(),
        reminderId: reminder.id,
        userId: reminder.userId,
        dueDate: nextDue,
        isRead: false,
      })
      .returning();

    const advancedDue = computeNextDueDate(
      nextDue,
      reminder.frequency,
      reminder.intervalValue,
      reminder.intervalUnit,
      getAnchorDay(reminder)
    );
    await reminderRepository.advanceNextDueDateTx(tx, reminder.id, nextDue, advancedDue, now);
    return { created, advancedDue };
  });
}

async function fastForwardPastNow(reminder: Reminder, currentDue: Date, now: Date): Promise<void> {
  const previousDue = currentDue;
  let nextDue = currentDue;
  while (nextDue <= now) {
    nextDue = computeNextDueDate(
      nextDue,
      reminder.frequency,
      reminder.intervalValue,
      reminder.intervalUnit,
      getAnchorDay(reminder)
    );
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
        result.skipped.push({
          reminderId: reminder.id,
          reason: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
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

    const maxCatchUp = CONFIG.validation.reminder.maxCatchUpOccurrences;
    let nextDue = reminder.nextDueDate;
    let catchUpCount = 0;

    while (nextDue <= now && catchUpCount < maxCatchUp) {
      // EndDate check inside the loop — process periods up to endDate before deactivating
      if (reminder.endDate && nextDue > reminder.endDate) {
        await reminderRepository.deactivate(reminder.id);
        break;
      }

      if (reminder.type === 'expense') {
        const txResult = await processExpensePeriod(reminder, vehicleIds, nextDue, now);
        result.createdExpenses.push(...txResult.created);
        nextDue = txResult.advancedDue;
      } else {
        const notifResult = await processNotificationPeriod(reminder, nextDue, now);
        result.notifications.push(notifResult.created);
        nextDue = notifResult.advancedDue;
      }

      catchUpCount++;
    }

    // Fast-forward past now when catch-up limit reached
    if (catchUpCount >= maxCatchUp && nextDue <= now) {
      await fastForwardPastNow(reminder, nextDue, now);
      result.skipped.push({ reminderId: reminder.id, reason: 'catch_up_limit_reached' });
    }
  }
}

export const reminderTriggerService = new ReminderTriggerService();
