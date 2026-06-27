import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { CONFIG } from '../../config';
import type { NewReminder, Reminder } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, rateLimiter, requireAuth } from '../../middleware';
import { centsToDollars, expenseToApi, reminderToApi } from '../../utils/money';
import { requireVehicleRead, resolveVehicleOwnerId } from '../../utils/sharing';
import {
  commonSchemas,
  validateReminderOwnership,
  validateVehicleIdsOwned,
} from '../../utils/validation';
import { expenseRepository } from '../expenses/repository';
import { odometerRepository } from '../odometer/repository';
import { recurringCostSummary } from './reminder-cost';
import { reminderRepository } from './repository';
import { advanceReminderDueDate, reminderTriggerService } from './trigger-service';
import {
  assertMergedReminderValid,
  createReminderSchema,
  updateReminderSchema,
} from './validation';

const routes = new Hono();

/**
 * T6 display edge for a ReminderWithVehicles response ({ reminder, vehicleIds }): convert the nested
 * reminder's expenseAmount from integer CENTS → dollars. vehicleIds + the rest pass through. Used at
 * every reminder list/get/create/update return (the money lives under `.reminder`).
 */
function reminderWithVehiclesToApi<T extends { reminder: Record<string, unknown> }>(row: T): T {
  return { ...row, reminder: reminderToApi(row.reminder) };
}

/**
 * Resolve the server-derived mileage fields for a create/update (T4, D4). For a mileage/both
 * reminder: default `lastServiceOdometer` to the vehicle's current odometer when the client omitted
 * it, then derive `nextDueOdometer = lastServiceOdometer + intervalMileage` (the cache the trigger's
 * mileage pass + the notification dedup key read). For a time reminder: clear all three. Validation
 * has already guaranteed a mileage reminder has exactly one vehicle + a positive intervalMileage.
 */
async function resolveMileageFields(
  data: {
    triggerMode?: string;
    intervalMileage?: number | null;
    lastServiceOdometer?: number | null;
  },
  vehicleIds: string[],
  userId: string
): Promise<{
  intervalMileage: number | null;
  lastServiceOdometer: number | null;
  nextDueOdometer: number | null;
}> {
  if (data.triggerMode !== 'mileage' && data.triggerMode !== 'both') {
    return { intervalMileage: null, lastServiceOdometer: null, nextDueOdometer: null };
  }
  const intervalMileage = data.intervalMileage ?? 0;
  const lastServiceOdometer =
    data.lastServiceOdometer ??
    (await odometerRepository.getCurrentOdometer(vehicleIds[0], userId)) ??
    0;
  return {
    intervalMileage,
    lastServiceOdometer,
    nextDueOdometer: lastServiceOdometer + intervalMileage,
  };
}

/**
 * Advance a time reminder's nextDueDate to the FIRST FUTURE occurrence after `now` (the mark-serviced
 * D3 re-arm). Mirrors fastForwardPastNow (NOT the capped catch-up loop — maxCatchUpOccurrences is a
 * materialization budget; mark-serviced creates nothing, so it must reach the future however lapsed).
 * A single one-period advance is wrong when the reminder is MULTIPLE periods overdue: advancing once
 * from a stale nextDueDate lands it still <= now, so the just-serviced reminder stays overdue + re-fires.
 * The loop is bounded by the date advancing past now; the strict-advance backstop bails on a
 * non-progressing cadence (the bug #13 guard — advanceReminderDueDate also throws on a bad interval).
 * Extracted from the mark-serviced handler (C394) to keep it under the cognitive-complexity cap.
 */
function advanceToFirstFutureDue(reminder: Reminder, from: Date): Date {
  const now = new Date();
  let nextDue = advanceReminderDueDate(reminder, from);
  while (nextDue <= now) {
    const advanced = advanceReminderDueDate(reminder, nextDue);
    if (advanced <= nextDue) {
      throw new ValidationError(
        `Reminder ${reminder.id} did not advance (frequency "${reminder.frequency}") — aborting re-arm`
      );
    }
    nextDue = advanced;
  }
  return nextDue;
}

// Apply middleware to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// Rate limiter for trigger endpoint
const triggerRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.trigger,
  keyGenerator: (c) => `trigger:${c.get('user').id}`,
});

// POST /trigger — process overdue reminders (must be before /:id)
routes.post('/trigger', triggerRateLimiter, async (c) => {
  const user = c.get('user');
  const result = await reminderTriggerService.processOverdueReminders(user.id);
  // T6 display edge: the trigger materializes expense rows (cents) → dollars for the FE contract.
  return c.json({
    success: true,
    data: { ...result, createdExpenses: result.createdExpenses.map(expenseToApi) },
  });
});

// GET /recurring-cost — the monthly recurring run-rate across the user's active expense reminders
// (recurring-expenses T7 backend, R5/D4). A read-only derivation over existing rows (NO new table):
// the dashboard "recurring costs" widget (T7 eyes-on) fetches this. Static suffix → before /:id.
routes.get('/recurring-cost', async (c) => {
  const user = c.get('user');
  const expenseReminders = await reminderRepository.findByUserId(user.id, { type: 'expense' });
  const summary = recurringCostSummary(expenseReminders.map((r) => r.reminder));
  // T6 display edge: monthlyTotal is a cents-derived run-rate → dollars for the FE widget.
  return c.json({
    success: true,
    data: { ...summary, monthlyTotal: centsToDollars(summary.monthlyTotal) },
  });
});

// POST /:id/mark-serviced — re-arm a reminder after a service (D3). A static suffix segment, so it
// doesn't collide with GET/PUT /:id. Rate-limited like /trigger (it reads the odometer + writes).
routes.post(
  '/:id/mark-serviced',
  triggerRateLimiter,
  zValidator('param', commonSchemas.idParam),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    const { reminder, vehicleIds } = await validateReminderOwnership(id, user.id);

    // Compute the re-arm per axis (D3). The route owns the math (it has the odometer repo +
    // advanceReminderDueDate) to keep the repository free of a trigger-service import cycle.
    const fields: { lastServiceOdometer?: number; nextDueOdometer?: number; nextDueDate?: Date } =
      {};

    // Mileage axis: anchor to the CURRENT odometer, recompute the milestone cache.
    if (reminder.triggerMode === 'mileage' || reminder.triggerMode === 'both') {
      const vehicleId = vehicleIds[0];
      const current = vehicleId
        ? await odometerRepository.getCurrentOdometer(vehicleId, user.id)
        : null;
      const lastServiceOdometer = current ?? reminder.lastServiceOdometer ?? 0;
      fields.lastServiceOdometer = lastServiceOdometer;
      fields.nextDueOdometer = lastServiceOdometer + (reminder.intervalMileage ?? 0);
    }

    // Time axis: advance nextDueDate to the FIRST FUTURE occurrence (advanceToFirstFutureDue, above).
    if (
      (reminder.triggerMode === 'time' || reminder.triggerMode === 'both') &&
      reminder.nextDueDate
    ) {
      const nextDue = advanceToFirstFutureDue(reminder, reminder.nextDueDate);
      // #114 (C394): honor endDate on the re-arm, mirroring the trigger-service fastForwardPastNow guard
      // (C362/#107). A BOUNDED reminder serviced AFTER its endDate would otherwise be re-armed to a future
      // nextDueDate and left is_active=1 — living on past its end + firing again. If the advanced date
      // crosses endDate the reminder is done: deactivate it (the whole reminder, incl. a both-axes one —
      // endDate bounds the reminder, not just the time axis) and return it inactive, not a forward date.
      if (reminder.endDate && nextDue > reminder.endDate) {
        await reminderRepository.deactivate(id);
        return c.json({ success: true, data: reminderToApi({ ...reminder, isActive: false }) });
      }
      fields.nextDueDate = nextDue;
    }

    const updated = await reminderRepository.markServiced(id, user.id, fields);
    return c.json({ success: true, data: reminderToApi(updated) });
  }
);

// GET /notifications — list notifications (must be before /:id)
routes.get('/notifications', async (c) => {
  const user = c.get('user');
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  const notifications = await reminderRepository.findNotifications(user.id, unreadOnly);
  return c.json({ success: true, data: notifications });
});

// PUT /notifications/:id/read — mark notification as read
routes.put('/notifications/:id/read', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  await reminderRepository.markNotificationRead(id, user.id);
  return c.json({ success: true, message: 'Notification marked as read' });
});

// POST / — create reminder
routes.post('/', zValidator('json', createReminderSchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  // Verify vehicle ownership — all vehicleIds must belong to the user
  await validateVehicleIdsOwned(data.vehicleIds, user.id);

  const { vehicleIds, ...reminderData } = data;
  const mileage = await resolveMileageFields(reminderData, vehicleIds, user.id);
  const result = await reminderRepository.createWithVehicles(
    {
      ...reminderData,
      userId: user.id,
      // A pure-mileage reminder has no time axis → null date (the trigger's time pass skips it; the
      // mileage pass drives it). time/both keep nextDueDate = startDate as before.
      nextDueDate: reminderData.triggerMode === 'mileage' ? null : reminderData.startDate,
      ...mileage,
    },
    vehicleIds
  );

  return c.json({ success: true, data: reminderWithVehiclesToApi(result) }, 201);
});

// GET / — list reminders
routes.get('/', async (c) => {
  const user = c.get('user');
  const vehicleId = c.req.query('vehicleId');
  const type = c.req.query('type');
  const isActiveParam = c.req.query('isActive');

  const filters: { vehicleId?: string; type?: string; isActive?: boolean } = {};
  if (vehicleId) filters.vehicleId = vehicleId;
  if (type) filters.type = type;
  if (isActiveParam !== undefined) filters.isActive = isActiveParam === 'true';

  // vehicle-sharing T7 READ widening (design §2.1 rule 3, the reminders analogue of T5b-3). A reminder
  // is userId-OWNED with a multi-vehicle junction, so reminders for a shared vehicle belong to the
  // OWNER's books. When the request filters by a specific vehicleId, gate via requireVehicleRead (owner |
  // accepted viewer/editor | 404) and list the OWNER's reminders linked to that vehicle (findByUserId
  // INNER-JOINs the junction, so the vehicleId filter pins it to exactly that vehicle's reminders — the
  // owner cannot leak reminders on OTHER vehicles). Without a vehicleId filter, the list STAYS
  // acting-user-owned (cross-fleet: a shared vehicle's reminders live on the owner's surface, so the
  // invitee sees them only via ?vehicleId — no foreign rows in the all-reminders list). The WRITE paths
  // (POST/PUT/DELETE) keep the strict validateVehicleIdsOwned for now — T7b widens those.
  let listUserId = user.id;
  if (vehicleId) {
    await requireVehicleRead(vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');
    listUserId = ownerId;
  }

  const reminders = await reminderRepository.findByUserId(listUserId, filters);
  return c.json({ success: true, data: reminders.map(reminderWithVehiclesToApi) });
});

// GET /:id — get single reminder
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const result = await validateReminderOwnership(id, user.id);

  return c.json({ success: true, data: reminderWithVehiclesToApi(result) });
});

// GET /:id/expenses — the expense rows this reminder has materialized (recurring-expenses T6 backend:
// the "this reminder created N expenses" view). Ownership-checked, then read by source link.
routes.get('/:id/expenses', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  await validateReminderOwnership(id, user.id);

  const materialized = await expenseRepository.findBySource('reminder', id, user.id);
  // T6 display edge: these materialized expense rows are now CENTS (T5 made the reminder expenseAmount +
  // trigger-service materialization cents-native), so convert → dollars for the FE contract.
  return c.json({ success: true, data: materialized.map(expenseToApi) });
});

// PUT /:id — update reminder
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateReminderSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const partialUpdate = c.req.valid('json');

    // Fetch existing reminder (scoped to user)
    const existing = await validateReminderOwnership(id, user.id);

    // If vehicleIds are being updated, verify ownership
    if (partialUpdate.vehicleIds) {
      await validateVehicleIdsOwned(partialUpdate.vehicleIds, user.id);
    }

    // Merge partial update with existing to re-validate the full object
    const merged = {
      ...existing.reminder,
      ...partialUpdate,
      vehicleIds: partialUpdate.vehicleIds ?? existing.vehicleIds,
    };

    // Re-validate merged result to prevent invalid intermediate states. Uses the TRANSFORM-FREE gate
    // (assertMergedReminderValid): `merged` mixes the existing row (already integer CENTS) with the parsed
    // partial update (also cents), so re-parsing through createReminderSchema would double-convert the
    // money + reject a ≥$10k reminder on the dollar .max() bound (money-cents-migration T5).
    assertMergedReminderValid(merged);

    const { vehicleIds: mergedVehicleIds, ...reminderFields } = partialUpdate;
    const updateFields: Partial<NewReminder> = { ...reminderFields };

    // If this update touches the mileage axis (triggerMode / intervalMileage / lastServiceOdometer),
    // recompute the derived nextDueOdometer cache + the nullable nextDueDate from the MERGED state,
    // so the trigger's mileage pass + dedup key stay consistent. Switching to pure 'time' clears the
    // mileage fields; switching to pure 'mileage' nulls the time date.
    const touchesMileage =
      reminderFields.triggerMode !== undefined ||
      reminderFields.intervalMileage !== undefined ||
      reminderFields.lastServiceOdometer !== undefined;
    if (touchesMileage) {
      const mileage = await resolveMileageFields(merged, merged.vehicleIds, user.id);
      updateFields.intervalMileage = mileage.intervalMileage;
      updateFields.lastServiceOdometer = mileage.lastServiceOdometer;
      updateFields.nextDueOdometer = mileage.nextDueOdometer;
      if (merged.triggerMode === 'mileage') {
        updateFields.nextDueDate = null;
      } else if (merged.triggerMode === 'time' || merged.triggerMode === 'both') {
        // Leaving pure-mileage for a time-bearing mode: restore the time axis from startDate.
        updateFields.nextDueDate = merged.nextDueDate ?? merged.startDate;
      }
    }

    const result = await reminderRepository.updateWithVehicles(
      id,
      user.id,
      updateFields,
      mergedVehicleIds
    );

    return c.json({ success: true, data: reminderWithVehiclesToApi(result) });
  }
);

// DELETE /:id — delete reminder (CASCADE handles junction + notifications)
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  await validateReminderOwnership(id, user.id);

  // T3/D2 (recurring-expenses): a 'expense'-type reminder auto-materializes real expense rows
  // (sourceType:'reminder', sourceId:reminder.id). Those are HISTORY — deleting the reminder must
  // NOT delete them (NORTH_STAR #1, no silent loss). Sever the link (keep the rows) via clearSource,
  // mirroring the C85 onFinancingDeactivated idiom. Best-effort: a clearSource hiccup must not block
  // the delete the user asked for (the rows simply keep a now-dangling sourceId, harmless). Scoped to
  // the user. No-op for non-expense reminders (they materialize nothing, so 0 rows match).
  try {
    await expenseRepository.clearSource('reminder', id, user.id);
  } catch {
    // swallow — the reminder delete below is the user's actual intent
  }

  await reminderRepository.delete(id);
  return c.json({ success: true, message: 'Reminder deleted successfully' });
});

export { routes };
