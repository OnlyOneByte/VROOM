import { createId } from '@paralleldrive/cuid2';
import { appContext, repos } from '../../app-context';
import { CONFIG } from '../../config';
import type { AsyncHandle } from '../../db/async-sqlite';
import type { Expense, Reminder, ReminderNotification } from '../../db/schema';
import { expenses, reminderNotifications } from '../../db/schema';
import type { SplitConfig } from '../../db/types';
import { ValidationError } from '../../errors';
import { DEFAULT_UNIT_PREFERENCES, type DistanceUnit, parseUnitPreferences } from '../../types';
import { logger } from '../../utils/logger';
import { formatNumberForMessage } from '../../utils/money';
import { zonedDayWindow, zonedParts, zoneOffsetMs } from '../../utils/time-zone';
import { DISTANCE_UNIT_SHORT_LABELS } from '../../utils/unit-conversions';
import { expenseSplitService } from '../expenses/split-service';
import { notifyUser, type PushPayload } from '../push/push-service';
import type { ReminderWithVehicles } from './repository';

export interface TriggerResult {
  createdExpenses: Expense[];
  notifications: ReminderNotification[];
  skipped: Array<{ reminderId: string; reason: string; message?: string }>;
}

const SKIP_ERROR_MESSAGE = 'This reminder could not be processed. Try again later.';

function pushSkipError(
  result: TriggerResult,
  reminderId: string,
  reason: string,
  error: unknown
): void {
  logger.error('Reminder trigger skipped a reminder after an error', {
    reminderId,
    reason,
    error: error instanceof Error ? error.message : String(error),
  });
  result.skipped.push({
    reminderId,
    reason,
    message: error instanceof ValidationError ? error.message : SKIP_ERROR_MESSAGE,
  });
}

function pushReminderSkipError(result: TriggerResult, reminderId: string, error: unknown): void {
  pushSkipError(result, reminderId, 'error', error);
}

function pushConcurrentTriggerSkip(result: TriggerResult, reminderId: string): void {
  result.skipped.push({ reminderId, reason: 'concurrent_trigger' });
}

function payloadFromReminder(
  reminder: Reminder,
  notification: ReminderNotification,
  distanceUnit: DistanceUnit
): PushPayload {
  const body =
    notification.dueOdometer !== null
      ? `Due at ${formatNumberForMessage(notification.dueOdometer)} ${DISTANCE_UNIT_SHORT_LABELS[distanceUnit]}`
      : 'This reminder is now due';
  return { title: `${reminder.name} due`, body, tag: reminder.id, url: '/reminders' };
}

// notifyUser must never throw: the notification row is already committed when it runs.
async function firePushForNotification(
  reminder: Reminder,
  notification: ReminderNotification,
  distanceUnit: DistanceUnit = DEFAULT_UNIT_PREFERENCES.distanceUnit
): Promise<void> {
  await notifyUser(reminder.userId, payloadFromReminder(reminder, notification, distanceUnit));
}

async function vehicleDistanceUnit(vehicleId: string): Promise<DistanceUnit> {
  const vehicle = await repos().vehicles.findById(vehicleId);
  return (
    parseUnitPreferences(vehicle?.unitPreferences)?.distanceUnit ??
    DEFAULT_UNIT_PREFERENCES.distanceUnit
  );
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  timeOfDayMs: number;
}

function wallClockOf(instant: Date, timeZone: string | undefined): WallClock {
  if (!timeZone) {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth(),
      day: instant.getDate(),
      timeOfDayMs:
        ((instant.getHours() * 60 + instant.getMinutes()) * 60 + instant.getSeconds()) * 1000 +
        instant.getMilliseconds(),
    };
  }
  const p = zonedParts(instant, timeZone);
  return {
    year: p.year,
    month: p.month - 1,
    day: p.day,
    timeOfDayMs: ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + instant.getUTCMilliseconds(),
  };
}

function fromWallClock(w: WallClock, timeZone: string | undefined): Date {
  if (!timeZone) {
    return new Date(w.year, w.month, w.day, 0, 0, 0, w.timeOfDayMs);
  }
  const wall = Date.UTC(w.year, w.month, w.day) + w.timeOfDayMs;
  const guess = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(guess, timeZone));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addMonths(w: WallClock, months: number, anchorDay: number): WallClock {
  const total = w.year * 12 + w.month + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  return { ...w, year, month, day: Math.min(anchorDay, daysInMonth(year, month)) };
}

function advanceCustom(
  w: WallClock,
  intervalValue: number,
  intervalUnit: string,
  anchorDay: number
): WallClock {
  if (intervalValue <= 0) {
    throw new ValidationError(
      `Invalid reminder intervalValue ${intervalValue} (must be a positive integer)`
    );
  }
  switch (intervalUnit) {
    case 'day':
      return { ...w, day: w.day + intervalValue };
    case 'week':
      return { ...w, day: w.day + intervalValue * 7 };
    case 'month':
      return addMonths(w, intervalValue, anchorDay);
    case 'year':
      return addMonths(w, intervalValue * 12, anchorDay);
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
  anchorDay?: number,
  timeZone?: string
): Date {
  const current = wallClockOf(currentDueDate, timeZone);
  const dayTarget = anchorDay ?? current.day;
  let next: WallClock;

  switch (frequency) {
    case 'weekly':
      next = { ...current, day: current.day + 7 };
      break;
    case 'monthly':
      next = addMonths(current, 1, dayTarget);
      break;
    case 'yearly':
      next = addMonths(current, 12, dayTarget);
      break;
    case 'custom':
      next = advanceCustom(current, intervalValue ?? 1, intervalUnit ?? 'day', dayTarget);
      break;
    default:
      throw new ValidationError(
        `Invalid reminder frequency "${frequency}" (expected weekly|monthly|yearly|custom)`
      );
  }

  return fromWallClock(next, timeZone);
}

export type ReminderSchedule = Pick<
  Reminder,
  'id' | 'frequency' | 'intervalValue' | 'intervalUnit' | 'startDate'
>;

export function advanceReminderDueDate(
  reminder: ReminderSchedule,
  from: Date,
  timeZone?: string
): Date {
  return computeNextDueDate(
    from,
    reminder.frequency,
    reminder.intervalValue,
    reminder.intervalUnit,
    getAnchorDay(reminder, timeZone),
    timeZone
  );
}

function advanceStrictly(reminder: ReminderSchedule, from: Date, timeZone?: string): Date {
  const next = advanceReminderDueDate(reminder, from, timeZone);
  if (next <= from) {
    throw new ValidationError(
      `Reminder ${reminder.id} did not advance (frequency "${reminder.frequency}")`
    );
  }
  return next;
}

export function firstDueOnOrAfter(
  reminder: ReminderSchedule,
  floor: Date,
  timeZone?: string
): Date {
  let due = reminder.startDate;
  while (due < floor) due = advanceStrictly(reminder, due, timeZone);
  return due;
}

export function previousDueBefore(
  reminder: ReminderSchedule,
  due: Date,
  timeZone?: string
): Date | null {
  let previous: Date | null = null;
  let candidate = reminder.startDate;
  while (candidate < due) {
    previous = candidate;
    candidate = advanceStrictly(reminder, candidate, timeZone);
  }
  return previous;
}

async function createExpenseFromReminder(
  tx: AsyncHandle,
  { reminder, vehicleIds }: ReminderWithVehicles,
  dueDate: Date
): Promise<Expense[]> {
  const splitConfig = reminder.expenseSplitConfig as SplitConfig | null;
  const amount = reminder.expenseAmount ?? 0;
  const category = reminder.expenseCategory ?? 'misc';

  if (!splitConfig) {
    const vehicleId = vehicleIds[0];
    if (!vehicleId) {
      throw new ValidationError('Reminder has no linked vehicle to create an expense for');
    }
    const [expense] = await tx
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
      .returning();
    if (!expense) throw new Error('Expense insert returned no row');
    return [expense];
  }

  const allocations = expenseSplitService.computeAllocations(splitConfig, amount);
  const groupId = createId();

  return expenseSplitService.createSiblings(tx, {
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

function getAnchorDay(reminder: ReminderSchedule, timeZone: string | undefined): number {
  return wallClockOf(reminder.startDate, timeZone).day;
}

export function advanceToFirstFutureDue(
  reminder: Reminder,
  from: Date,
  timeZone: string | undefined
): Date {
  const now = new Date();
  let nextDue = advanceReminderDueDate(reminder, from, timeZone);
  while (isTimeDue(nextDue, now, timeZone)) {
    const advanced = advanceReminderDueDate(reminder, nextDue, timeZone);
    if (advanced <= nextDue) {
      throw new ValidationError(
        `Reminder ${reminder.id} did not advance (frequency "${reminder.frequency}") — aborting re-arm`
      );
    }
    nextDue = advanced;
  }
  return nextDue;
}

export function nextDueAfterService(
  reminder: Reminder,
  due: Date,
  now: Date,
  timeZone: string | undefined
): Date {
  if (isTimeDue(due, now, timeZone)) return advanceToFirstFutureDue(reminder, due, timeZone);
  const periodStart = previousDueBefore(reminder, due, timeZone);
  const alreadyAdvanced =
    periodStart !== null &&
    (!isTimeDue(periodStart, now, timeZone) ||
      (reminder.lastTriggeredAt !== null &&
        reminder.lastTriggeredAt >= startOfDayIn(periodStart, timeZone)));
  return alreadyAdvanced ? due : advanceReminderDueDate(reminder, due, timeZone);
}

export function startOfDayIn(instant: Date, timeZone: string | undefined): Date {
  return timeZone
    ? zonedDayWindow(instant, timeZone).dayStart
    : new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
}

export function endOfDayIn(now: Date, timeZone: string | undefined): Date {
  const nextDay = timeZone
    ? zonedDayWindow(now, timeZone).nextDay
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return new Date(nextDay.getTime() - 1);
}

export function isTimeDue(nextDue: Date, now: Date, timeZone?: string): boolean {
  return nextDue <= endOfDayIn(now, timeZone);
}

function hasReminderEndedBy(reminder: Reminder, nextDue: Date): boolean {
  return reminder.endDate != null && nextDue > reminder.endDate;
}

async function processExpensePeriod(
  reminder: Reminder,
  vehicleIds: string[],
  nextDue: Date,
  now: Date,
  timeZone: string | undefined
): Promise<{ created: Expense[]; advancedDue: Date } | null> {
  const advancedDue = advanceReminderDueDate(reminder, nextDue, timeZone);
  return appContext().asyncDb.transaction(async (tx) => {
    const claimed = await repos().reminders.claimPeriod(tx, reminder.id, nextDue, advancedDue, now);
    if (!claimed) return null;
    await rearmMileageAfterDate(reminder, vehicleIds);
    return {
      created: await createExpenseFromReminder(tx, { reminder: claimed, vehicleIds }, nextDue),
      advancedDue,
    };
  });
}

async function processNotificationPeriod(
  reminder: Reminder,
  vehicleIds: string[],
  nextDue: Date,
  now: Date,
  timeZone: string | undefined
): Promise<{ created: ReminderNotification; advancedDue: Date } | null> {
  const advancedDue = advanceReminderDueDate(reminder, nextDue, timeZone);
  return appContext().asyncDb.transaction(async (tx) => {
    if (!(await repos().reminders.claimPeriod(tx, reminder.id, nextDue, advancedDue, now))) {
      return null;
    }
    await rearmMileageAfterDate(reminder, vehicleIds);
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
    if (!created) throw new Error('Notification insert returned no row');
    return { created, advancedDue };
  });
}

async function processPeriod(
  reminder: Reminder,
  vehicleIds: string[],
  nextDue: Date,
  now: Date,
  result: TriggerResult,
  timeZone: string | undefined
): Promise<Date | null> {
  if (reminder.type === 'expense') {
    const period = await processExpensePeriod(reminder, vehicleIds, nextDue, now, timeZone);
    if (!period) return null;
    result.createdExpenses.push(...period.created);
    return period.advancedDue;
  }

  const period = await processNotificationPeriod(reminder, vehicleIds, nextDue, now, timeZone);
  if (!period) return null;
  result.notifications.push(period.created);
  await firePushForNotification(reminder, period.created);
  return period.advancedDue;
}

async function fastForwardPastNow(
  reminder: Reminder,
  currentDue: Date,
  now: Date,
  timeZone: string | undefined
): Promise<void> {
  const previousDue = currentDue;
  let nextDue = currentDue;
  while (isTimeDue(nextDue, now, timeZone)) {
    if (hasReminderEndedBy(reminder, nextDue)) {
      await repos().reminders.deactivate(reminder.id, reminder.userId);
      return;
    }
    const advanced = advanceReminderDueDate(reminder, nextDue, timeZone);
    if (advanced <= nextDue) {
      throw new ValidationError(
        `Reminder ${reminder.id} did not advance (frequency "${reminder.frequency}") — aborting fast-forward`
      );
    }
    nextDue = advanced;
  }
  if (hasReminderEndedBy(reminder, nextDue)) {
    await repos().reminders.deactivate(reminder.id, reminder.userId);
    return;
  }
  await repos().reminders.advanceNextDueDate(reminder.id, previousDue, nextDue);
}

async function rearmAfterMileage(
  reminder: Reminder,
  odometer: number,
  timeZone: string | undefined
): Promise<void> {
  const now = new Date();
  const nextDueDate =
    reminder.nextDueDate && nextDueAfterService(reminder, reminder.nextDueDate, now, timeZone);
  if (nextDueDate && hasReminderEndedBy(reminder, nextDueDate)) {
    await repos().reminders.deactivate(reminder.id, reminder.userId);
    return;
  }
  await repos().reminders.markServiced(reminder.id, reminder.userId, {
    lastServiceOdometer: odometer,
    nextDueOdometer: odometer + (reminder.intervalMileage ?? 0),
    ...(nextDueDate ? { nextDueDate } : {}),
  });
}

async function rearmMileageAfterDate(reminder: Reminder, vehicleIds: string[]): Promise<void> {
  const [vehicleId] = vehicleIds;
  if (reminder.triggerMode !== 'both' || vehicleId === undefined || vehicleIds.length !== 1) return;
  const odometer = await repos().odometer.getCurrentOdometer(vehicleId, reminder.userId);
  if (odometer === null) return;
  await repos().reminders.rearmMileage(
    reminder.id,
    reminder.userId,
    odometer,
    odometer + (reminder.intervalMileage ?? 0)
  );
}

class ReminderTriggerService {
  async processOverdueReminders(userId: string, timeZone?: string): Promise<TriggerResult> {
    const now = new Date();
    const result: TriggerResult = { createdExpenses: [], notifications: [], skipped: [] };

    const overdueReminders = await repos().reminders.findOverdue(userId, endOfDayIn(now, timeZone));
    for (const { reminder, vehicleIds } of overdueReminders) {
      try {
        await this.processReminder(reminder, vehicleIds, now, result, timeZone);
      } catch (error) {
        pushReminderSkipError(result, reminder.id, error);
      }
    }

    const mileageReminders = await repos().reminders.findMileageTracking(userId);
    await this.processMileageReminders(mileageReminders, result, timeZone);

    return result;
  }

  async recheckMileageReminders(userId: string, vehicleId: string): Promise<TriggerResult> {
    const result: TriggerResult = { createdExpenses: [], notifications: [], skipped: [] };
    let mileageReminders: ReminderWithVehicles[];
    try {
      mileageReminders = await repos().reminders.findMileageTracking(userId);
    } catch (error) {
      pushSkipError(result, 'all', 'recheck_query_failed', error);
      return result;
    }
    await this.processMileageReminders(
      mileageReminders.filter(({ vehicleIds }) => vehicleIds.includes(vehicleId)),
      result
    );
    return result;
  }

  private async processMileageReminders(
    mileageReminders: ReminderWithVehicles[],
    result: TriggerResult,
    timeZone?: string
  ): Promise<void> {
    const odometerByVehicle = new Map<string, Promise<number | null>>();
    const currentOdometer = (vehicleId: string, userId: string): Promise<number | null> => {
      let reading = odometerByVehicle.get(vehicleId);
      if (!reading) {
        reading = repos().odometer.getCurrentOdometer(vehicleId, userId);
        odometerByVehicle.set(vehicleId, reading);
      }
      return reading;
    };

    for (const { reminder, vehicleIds } of mileageReminders) {
      try {
        await this.processMileageReminder(reminder, vehicleIds, result, currentOdometer, timeZone);
      } catch (error) {
        pushReminderSkipError(result, reminder.id, error);
      }
    }
  }

  private async processMileageReminder(
    reminder: Reminder,
    vehicleIds: string[],
    result: TriggerResult,
    currentOdometer: (vehicleId: string, userId: string) => Promise<number | null>,
    timeZone: string | undefined
  ): Promise<void> {
    if (reminder.nextDueOdometer === null) return;
    const [vehicleId] = vehicleIds;
    if (vehicleId === undefined || vehicleIds.length !== 1) {
      result.skipped.push({ reminderId: reminder.id, reason: 'mileage_requires_single_vehicle' });
      return;
    }

    const odometer = await currentOdometer(vehicleId, reminder.userId);
    if (odometer === null || odometer < reminder.nextDueOdometer) {
      return;
    }

    const distanceUnit = await vehicleDistanceUnit(vehicleId);
    const dueOdometer = reminder.nextDueOdometer;
    const { created, booked } = await appContext().asyncDb.transaction(async (tx) => {
      if (!(await repos().reminders.stillDueAt(reminder.id, reminder.userId, dueOdometer))) {
        return { created: null, booked: [] };
      }
      const claimed = await repos().reminders.createMileageNotification(
        reminder.id,
        reminder.userId,
        dueOdometer
      );
      if (!claimed) return { created: null, booked: [] };
      if (reminder.triggerMode === 'both') await rearmAfterMileage(reminder, odometer, timeZone);
      const expenses =
        reminder.type === 'expense'
          ? await createExpenseFromReminder(tx, { reminder, vehicleIds }, new Date())
          : [];
      return { created: claimed, booked: expenses };
    });
    result.createdExpenses.push(...booked);
    if (created) {
      result.notifications.push(created);
      await firePushForNotification(reminder, created, distanceUnit);
    }
  }

  private async processReminder(
    reminder: Reminder,
    vehicleIds: string[],
    now: Date,
    result: TriggerResult,
    timeZone: string | undefined
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

    while (isTimeDue(nextDue, now, timeZone) && catchUpCount < maxCatchUp) {
      if (hasReminderEndedBy(reminder, nextDue)) {
        break;
      }

      const advancedDue = await processPeriod(reminder, vehicleIds, nextDue, now, result, timeZone);
      if (advancedDue === null) {
        pushConcurrentTriggerSkip(result, reminder.id);
        return;
      }
      nextDue = advancedDue;

      catchUpCount++;
    }

    if (hasReminderEndedBy(reminder, nextDue)) {
      await repos().reminders.deactivate(reminder.id, reminder.userId);
      return;
    }

    if (catchUpCount >= maxCatchUp && isTimeDue(nextDue, now, timeZone)) {
      await fastForwardPastNow(reminder, nextDue, now, timeZone);
      result.skipped.push({ reminderId: reminder.id, reason: 'catch_up_limit_reached' });
    }
  }
}

export const reminderTriggerService = new ReminderTriggerService();
