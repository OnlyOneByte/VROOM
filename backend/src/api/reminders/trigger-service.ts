import { createId } from '@paralleldrive/cuid2';
import { CONFIG } from '../../config';
import { transaction } from '../../db/connection';
import type { Expense, Reminder, ReminderNotification } from '../../db/schema';
import { expenses, reminderNotifications } from '../../db/schema';
import type { DrizzleTransaction, ReminderSplitConfig } from '../../db/types';
import { ValidationError } from '../../errors';
import { expenseSplitService } from '../expenses/split-service';
import { odometerRepository } from '../odometer/repository';
import { notifyUser, type PushPayload } from '../push/push-service';
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

/**
 * Push a `reason:'error'` skip for a reminder whose per-reminder processing threw. The three
 * trigger catch sites (time axis, mileage axis, recheck-on-write per-reminder) built this exact
 * `{ reminderId, reason:'error', message }` entry byte-for-byte — collapse them to one source of
 * truth so the skip shape can't drift between the axes. The `'Unknown error'` fallback is kept
 * inline here (NOT routed through extractErrorMessage, whose contract is String(error)) — the
 * deliberate fixed-fallback idiom the helper doc carves out.
 */
function pushReminderSkipError(result: TriggerResult, reminderId: string, error: unknown): void {
  result.skipped.push({
    reminderId,
    reason: 'error',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}

/**
 * Record that this request lost the race for a reminder period and is therefore DONE with that
 * reminder. The period claim (`claimPeriodSync`) fails when the stored due date is no longer the one
 * this request read — normally because another in-flight trigger is working through the same
 * reminder, or because an edit moved the due date mid-sweep. Either way this request's view is stale,
 * so it must stop: not retry, and not touch the reminder's due date / active state. The skip makes
 * the hand-off visible in the response instead of looking like a reminder that silently did nothing.
 */
function pushConcurrentTriggerSkip(result: TriggerResult, reminderId: string): void {
  result.skipped.push({ reminderId, reason: 'concurrent_trigger' });
}

/**
 * Build the Web Push payload for a just-created reminder notification (T4b, design §4). The title
 * carries the user-authored reminder name; the body names the due axis (mileage vs time). NO PII
 * beyond the reminder text the user themselves wrote. A mileage notification carries dueOdometer
 * (dueDate null); a time notification carries dueDate — so the axis is read off the row, not guessed.
 */
function payloadFromReminder(reminder: Reminder, notification: ReminderNotification): PushPayload {
  const body =
    notification.dueOdometer !== null
      ? `Due at ${notification.dueOdometer.toLocaleString('en-US')} mi`
      : 'This reminder is now due';
  return { title: `${reminder.name} due`, body, tag: reminder.id, url: '/reminders' };
}

/**
 * T4b hook (honors D2 — the request-driven-trigger fork, ACK'd 2026-07-08): AFTER a
 * reminder_notifications row is inserted, nudge the user's push subscriptions. BEST-EFFORT —
 * notifyUser is wrapped to NEVER throw (T4a/R3) and is await-and-swallowed here (design §4) so a push
 * can neither fail nor stall the reminder sweep; the in-app notification feed stays the source of
 * truth and push is a purely additive nudge. When the server has no VAPID keypair notifyUser is a
 * no-op (config gap ≠ send failure), so this is inert on a deployment that never configured push.
 */
async function firePushForNotification(
  reminder: Reminder,
  notification: ReminderNotification
): Promise<void> {
  await notifyUser(reminder.userId, payloadFromReminder(reminder, notification));
}

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
  // A non-positive interval can't advance the date: setDate(+0)/setMonth(+0) returns the SAME day, so
  // the catch-up loop in processReminder would re-fire (materializing a duplicate expense) every
  // iteration up to maxCatchUp before any backstop. Zod's positive-int schema blocks this on create/
  // update, so it only fires on DB corruption / bypass — fail fast (mirrors the bad-unit throw).
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
      // An unknown intervalUnit must NOT silently no-op: leaving `next` unchanged makes the
      // catch-up / fast-forward `while (nextDue <= now)` loops spin forever. Zod's
      // intervalUnitSchema blocks bad values on create + update, so this only fires on DB
      // corruption or a validation bypass — fail fast so the caller records a per-reminder skip.
      throw new ValidationError(
        `Invalid reminder intervalUnit "${intervalUnit}" (expected day|week|month|year)`
      );
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
    default:
      // An unknown top-level frequency (e.g. a 'monthy' typo / DB corruption) would otherwise fall
      // through and return `next` UNCHANGED — the catch-up loop then re-fires at the same date,
      // materializing up to maxCatchUp duplicate expenses before fastForwardPastNow's backstop. Zod's
      // frequency enum blocks bad values on create/update; fail fast here so a corrupt reminder
      // becomes a clean per-reminder skip (mirrors advanceCustom's bad-unit throw — completes).
      throw new ValidationError(
        `Invalid reminder frequency "${frequency}" (expected weekly|monthly|yearly|custom)`
      );
  }

  return next;
}

/**
 * Advance a reminder's due date one period from `from`, using the reminder's own frequency config.
 * Thin wrapper over computeNextDueDate that binds the four `reminder.*` fields + the stable anchor day
 * (startDate's day-of-month, NOT the possibly-clamped current day — see getAnchorDay) so the catch-up,
 * notification, fast-forward, and mark-serviced re-arm paths can't drift in how they unpack a reminder.
 * Throws (via computeNextDueDate) on a corrupt frequency / non-positive interval — bug.
 */
export function advanceReminderDueDate(reminder: Reminder, from: Date): Date {
  return computeNextDueDate(
    from,
    reminder.frequency,
    reminder.intervalValue,
    reminder.intervalUnit,
    getAnchorDay(reminder)
  );
}

// ============================================================================
// Expense Creation
// ============================================================================

/**
 * Materialize one period of an expense reminder as expense row(s) inside the caller's transaction.
 *
 * SYNCHRONOUS on purpose — do NOT make this `async`. bun-sqlite is a sync dialect, so an awaiting
 * transaction callback autocommits each statement on its own with BEGIN/COMMIT wrapping nothing:
 * the money rows would then commit independently of the period claim that guards them (and a split
 * reminder could leave half its legs committed when a later leg fails). `.returning().get()` /
 * createSiblingsSync execute inline inside the caller's tx so the whole period is one real atom.
 */
function createExpenseFromReminder(
  tx: DrizzleTransaction,
  { reminder, vehicleIds }: ReminderWithVehicles,
  dueDate: Date
): Expense[] {
  const splitConfig = reminder.expenseSplitConfig as ReminderSplitConfig | null;
  const amount = reminder.expenseAmount ?? 0;
  const category = reminder.expenseCategory ?? 'misc';

  if (!splitConfig) {
    // Single-vehicle expense — use first (only) vehicle from junction.
    // Guard against a reminder with no linked vehicle: vehicleId is NOT NULL,
    // so inserting an undefined here would otherwise surface as an opaque DB error.
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

  // Split expense — reuse existing ExpenseSplitService
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

// ============================================================================
// Trigger Service
// ============================================================================

function getAnchorDay(reminder: Reminder): number {
  return reminder.startDate.getDate();
}

/**
 * Has a bounded reminder's next occurrence crossed its endDate? ONE source of truth for the
 * endDate-boundary predicate that was hand-inlined at four sites here — fastForwardPastNow's
 * in-loop + post-loop guards and processReminder's in-loop-break + natural-exit guards. This is THE
 * bug- family the loop kept re-finding (fast-forward exit, mark-serviced,
 * catch-up natural exit): each was a path where the advanced nextDue stepped past endDate
 * but the reminder stayed active. A divergent copy of the predicate (a `>=`/`>` slip, or dropping the
 * `endDate &&` null-guard so a no-end reminder wrongly deactivates) is exactly that class — so the
 * comparison lives in one place. Callers keep their own ACTION (break vs deactivate+return), since the
 * four sites diverge there by design; only the boundary TEST is shared.
 */
function hasReminderEndedBy(reminder: Reminder, nextDue: Date): boolean {
  return reminder.endDate != null && nextDue > reminder.endDate;
}

/**
 * Process ONE period of an expense reminder: claim the period, then materialize its money row(s).
 * Returns null when the claim was lost — a concurrent trigger already materialized this period.
 *
 * The claim (the `nextDueDate` compare-and-swap) runs FIRST and in the SAME synchronous transaction
 * as the insert, which is what makes "at most one expense row per period" true: the loser has
 * written nothing to roll back, and a synchronous callback cannot be interleaved by another request
 * between the claim and the insert. Both halves inside an *async* callback is what let two
 * overlapping /trigger requests each write every overdue period (doubled money, doubled totals).
 */
async function processExpensePeriod(
  reminder: Reminder,
  vehicleIds: string[],
  nextDue: Date,
  now: Date
): Promise<{ created: Expense[]; advancedDue: Date } | null> {
  // Compute (and validate) the advance BEFORE opening the transaction. computeNextDueDate is a pure
  // function and throws on a corrupt frequency / non-positive intervalValue (completion). Doing it
  // first means a non-advancing reminder throws before ANY expense row is written, rather than
  // relying on the rollback to undo one.
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

/**
 * Process ONE period of a notification reminder — the notification twin of processExpensePeriod
 * (claim first, insert second, one synchronous transaction). Returns null on a lost claim.
 */
async function processNotificationPeriod(
  reminder: Reminder,
  nextDue: Date,
  now: Date
): Promise<{ created: ReminderNotification; advancedDue: Date } | null> {
  // Validate/compute the advance BEFORE the transaction (see processExpensePeriod) so a corrupt
  // reminder throws before a notification row is written.
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

/**
 * Process ONE time-axis period for either reminder type and record what it produced in `result`.
 * Returns the advanced due date to continue the catch-up loop from, or null when the period claim
 * was lost. ONE dispatch site for the expense/notification fork so the two branches cannot drift in
 * how they handle a lost claim.
 */
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
  await firePushForNotification(reminder, period.created); // T4b (best-effort, never throws)
  return period.advancedDue;
}

async function fastForwardPastNow(reminder: Reminder, currentDue: Date, now: Date): Promise<void> {
  const previousDue = currentDue;
  let nextDue = currentDue;
  while (nextDue <= now) {
    // Bug: honor endDate here too. The main catch-up loop deactivates a bounded
    // reminder once nextDue crosses endDate, but a reminder lapsed past maxCatchUp reaches this
    // fast-forward instead — without this check it would advance past now and stay "active" but
    // permanently dormant (never fires, never closes). Deactivate the moment we step past endDate.
    if (hasReminderEndedBy(reminder, nextDue)) {
      await reminderRepository.deactivate(reminder.id);
      return;
    }
    const advanced = advanceReminderDueDate(reminder, nextDue);
    // Non-progress backstop: this loop is bounded only by the date advancing past `now`,
    // so a frequency/intervalUnit that fails to move the date forward would spin forever. advanceCustom
    // now throws on a bad unit, but guard the invariant directly — if the date didn't strictly
    // advance, bail rather than hang the trigger endpoint.
    if (advanced <= nextDue) {
      throw new ValidationError(
        `Reminder ${reminder.id} did not advance (frequency "${reminder.frequency}") — aborting fast-forward`
      );
    }
    nextDue = advanced;
  }
  // Bug: the in-loop endDate check above only inspects values <= now (the while
  // guard). The FINAL advance steps `nextDue` PAST now and exits the loop, so that last value is
  // never tested against endDate. A bounded reminder whose endDate falls in the period straddling
  // now (lastStep <= endDate < this final nextDue) would otherwise be written FORWARD of its endDate
  // yet left active — firing again next trigger (the bug family, here on fast-forward's exit
  // boundary). Deactivate instead of advancing past the end date. Mirrors the in-loop guard at :281.
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

    // Time axis: reminders whose nextDueDate has elapsed (mileage-only reminders have a null date
    // and are excluded by the SQL `<= now`).
    const overdueReminders = await reminderRepository.findOverdue(userId, now);
    for (const { reminder, vehicleIds } of overdueReminders) {
      try {
        await this.processReminder(reminder, vehicleIds, now, result);
      } catch (error) {
        pushReminderSkipError(result, reminder.id, error);
      }
    }

    // Mileage axis (whichever-comes-first): mileage/both reminders are due when the vehicle's
    // current odometer has reached the nextDueOdometer milestone. A `both` reminder can fire on
    // BOTH axes — they are distinct events with distinct dedup keys, so this pass runs independently
    // of the time pass above and over the full candidate set (not just the time-overdue ones).
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

  /**
   * Mileage re-check on write (D5): evaluate ONLY the given vehicle's mileage/both reminders right
   * after a new odometer reading lands (a manual odometer entry or a mileaged expense), so a reminder
   * fires the moment its milestone is crossed instead of waiting for the next /trigger or login pass.
   * Reuses the same per-reminder mileage logic, so it's idempotent via the dedup key — the
   * login-trigger path can't double-fire what this already wrote. Cheap + synchronous (no cron):
   * filters the user's mileage-tracking reminders to those linked to this vehicle. Best-effort —
   * skips are collected, never thrown, so a reminder hiccup can't fail the underlying write.
   */
  async recheckMileageReminders(userId: string, vehicleId: string): Promise<TriggerResult> {
    const result: TriggerResult = { createdExpenses: [], notifications: [], skipped: [] };
    // The candidate query is also best-effort: it throws DatabaseError on failure, and this runs
    // AFTER the odometer/expense write has already persisted — so a query hiccup must NOT propagate
    // and 500 the (successful) write. Swallow it into a skip and return what we have. (review:
    // the per-reminder try/catch below didn't cover this fetch, so the "never throws" contract was a
    // lie when the DB hiccuped between the write and the recheck.)
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

  /**
   * Mileage axis for one reminder: due when the linked vehicle's current odometer (max across
   * expenses + odometer entries) has reached nextDueOdometer. Emits ONE notification per milestone
   * (null dueDate, dueOdometer set), deduped so re-running the trigger is a no-op. There is NO
   * auto-re-arm on this axis — a mileage reminder stays due until the user marks it serviced (D3/
   * T4), so an overdue service keeps signalling rather than silently clearing. Mileage requires
   * exactly one vehicle (D4); a misconfigured multi/zero-vehicle reminder is skipped, not errored.
   */
  private async processMileageReminder(
    reminder: Reminder,
    vehicleIds: string[],
    result: TriggerResult
  ): Promise<void> {
    if (reminder.nextDueOdometer === null) return; // candidate query guarantees this, belt + braces
    if (vehicleIds.length !== 1) {
      result.skipped.push({ reminderId: reminder.id, reason: 'mileage_requires_single_vehicle' });
      return;
    }

    const currentOdometer = await odometerRepository.getCurrentOdometer(
      vehicleIds[0],
      reminder.userId
    );
    if (currentOdometer === null || currentOdometer < reminder.nextDueOdometer) {
      return; // not yet due
    }

    // Idempotent: skip if this milestone already produced a notification.
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
      await firePushForNotification(reminder, created); // T4b (best-effort, never throws)
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

    // Time axis: a mileage-only reminder has a null next_due_date (T3) — it has no time periods to
    // process here. findOverdue's `next_due_date <= now` already excludes NULL rows via SQL
    // three-valued logic, so this is also the type guard that narrows nextDue to Date below. The
    // mileage axis is processed separately; a null date here means "no time work to do".
    if (reminder.nextDueDate === null) {
      return;
    }

    const maxCatchUp = CONFIG.validation.reminder.maxCatchUpOccurrences;
    let nextDue: Date = reminder.nextDueDate;
    let catchUpCount = 0;

    while (nextDue <= now && catchUpCount < maxCatchUp) {
      // EndDate check inside the loop — process periods up to endDate, then stop catching up.
      // Deactivation is handled ONCE after the loop so the natural
      // exit boundary is covered by the same code — one deactivation site, no duplication.
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

    // Bug: honor endDate at the loop's NATURAL exit too (the bug-
    // family on a third path). The in-loop guard above only inspects nextDue <= now (the while
    // condition); the FINAL advance steps nextDue PAST now and exits the loop under the catch-up cap,
    // so that last value was never tested against endDate. A bounded reminder whose endDate fell
    // between its last in-window occurrence and that final advance was left is_active=1 with a future
    // nextDueDate — it then inflates GET /reminders/recurring-cost's run-rate + count and stays in the
    // active list until a LATER trigger lazily closes it (no duplicate expense — the in-loop guard
    // runs before materialization — purely a wrong active-state / wrong run-rate defect). This single
    // guard also covers the in-loop break case above. Mirrors fastForwardPastNow's exit guard (:303).
    if (hasReminderEndedBy(reminder, nextDue)) {
      await reminderRepository.deactivate(reminder.id);
      return;
    }

    // Fast-forward past now when catch-up limit reached
    if (catchUpCount >= maxCatchUp && nextDue <= now) {
      await fastForwardPastNow(reminder, nextDue, now);
      result.skipped.push({ reminderId: reminder.id, reason: 'catch_up_limit_reached' });
    }
  }
}

export const reminderTriggerService = new ReminderTriggerService();
