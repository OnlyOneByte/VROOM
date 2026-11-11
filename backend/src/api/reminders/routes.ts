import { Hono } from 'hono';
import { CONFIG } from '../../config';
import type { NewReminder, Reminder } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, rateLimiter, requireAuth } from '../../middleware';
import {
  centsToDollars,
  expenseToApi,
  reminderToApi,
  reminderWithVehiclesToApi,
} from '../../utils/money';
import {
  requireVehicleRead,
  requireVehicleWrite,
  resolveVehicleOwnerId,
} from '../../utils/sharing';
import { commonSchemas, validateReminderOwnership, zValidator } from '../../utils/validation';
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
 * Derives the mileage fields server-side. A mileage or both reminder defaults lastServiceOdometer to the
 * vehicle's current odometer and sets nextDueOdometer = lastServiceOdometer + intervalMileage. A time
 * reminder clears all three.
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
 * Requires WRITE on every linked vehicle and returns the owner the reminder is stamped with. A reminder
 * has one userId, so all its vehicles must share an owner. A vehicleless reminder belongs to the actor.
 */
async function requireReminderVehiclesWrite(
  vehicleIds: readonly string[],
  actingUserId: string
): Promise<{ ownerId: string }> {
  let ownerId: string | undefined;
  for (const vehicleId of vehicleIds) {
    await requireVehicleWrite(vehicleId, actingUserId);
    const vehicleOwner = await resolveVehicleOwnerId(vehicleId);
    if (!vehicleOwner) throw new NotFoundError('Vehicle');
    if (ownerId === undefined) {
      ownerId = vehicleOwner;
    } else if (ownerId !== vehicleOwner) {
      throw new ValidationError('A reminder cannot span vehicles owned by different users');
    }
  }
  return { ownerId: ownerId ?? actingUserId };
}

/**
 * Advances a time reminder to its first occurrence after now. Loops without the catch-up cap because
 * nothing is materialized here, and a single advance could leave a long-lapsed reminder still due.
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

routes.use('*', requireAuth);
routes.use('*', changeTracker);

const triggerRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.trigger,
  keyGenerator: (c) => `trigger:${c.get('user').id}`,
});

// Static segments must be registered before /:id.
routes.post('/trigger', triggerRateLimiter, async (c) => {
  const user = c.get('user');
  const result = await reminderTriggerService.processOverdueReminders(user.id);
  return c.json({
    success: true,
    data: { ...result, createdExpenses: result.createdExpenses.map(expenseToApi) },
  });
});

// Derived from existing reminder rows; there is no separate summary table.
routes.get('/recurring-cost', async (c) => {
  const user = c.get('user');
  const expenseReminders = await reminderRepository.findByUserId(user.id, { type: 'expense' });
  const summary = recurringCostSummary(expenseReminders.map((r) => r.reminder));
  return c.json({
    success: true,
    data: { ...summary, monthlyTotal: centsToDollars(summary.monthlyTotal) },
  });
});

routes.post(
  '/:id/mark-serviced',
  triggerRateLimiter,
  zValidator('param', commonSchemas.idParam),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    // Odometer reads and the write use the owner id: shared-vehicle odometer rows are owner-stamped.
    const existing = await reminderRepository.findByIdWithVehicles(id);
    if (!existing) throw new NotFoundError('Reminder');
    const { reminder, vehicleIds } = existing;
    const { ownerId } = await requireReminderVehiclesWrite(vehicleIds, user.id);

    // Re-arm math lives in the route so the repository doesn't import the trigger service.
    const fields: { lastServiceOdometer?: number; nextDueOdometer?: number; nextDueDate?: Date } =
      {};

    if (reminder.triggerMode === 'mileage' || reminder.triggerMode === 'both') {
      const vehicleId = vehicleIds[0];
      const current = vehicleId
        ? await odometerRepository.getCurrentOdometer(vehicleId, ownerId)
        : null;
      const lastServiceOdometer = current ?? reminder.lastServiceOdometer ?? 0;
      fields.lastServiceOdometer = lastServiceOdometer;
      fields.nextDueOdometer = lastServiceOdometer + (reminder.intervalMileage ?? 0);
    }

    if (
      (reminder.triggerMode === 'time' || reminder.triggerMode === 'both') &&
      reminder.nextDueDate
    ) {
      const nextDue = advanceToFirstFutureDue(reminder, reminder.nextDueDate);
      // A reminder serviced after its endDate must be deactivated, not re-armed to a future date.
      if (reminder.endDate && nextDue > reminder.endDate) {
        await reminderRepository.deactivate(id);
        return c.json({ success: true, data: reminderToApi({ ...reminder, isActive: false }) });
      }
      fields.nextDueDate = nextDue;
    }

    const updated = await reminderRepository.markServiced(id, ownerId, fields);
    return c.json({ success: true, data: reminderToApi(updated) });
  }
);

routes.get('/notifications', async (c) => {
  const user = c.get('user');
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  const notifications = await reminderRepository.findNotifications(user.id, unreadOnly);
  return c.json({ success: true, data: notifications });
});

routes.put('/notifications/:id/read', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  await reminderRepository.markNotificationRead(id, user.id);
  return c.json({ success: true, message: 'Notification marked as read' });
});

routes.post('/', zValidator('json', createReminderSchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  const { vehicleIds, ...reminderData } = data;
  const { ownerId } = await requireReminderVehiclesWrite(vehicleIds, user.id);
  const mileage = await resolveMileageFields(reminderData, vehicleIds, ownerId);
  const result = await reminderRepository.createWithVehicles(
    {
      ...reminderData,
      userId: ownerId,
      // Pure mileage has no time axis, so no due date.
      nextDueDate: reminderData.triggerMode === 'mileage' ? null : reminderData.startDate,
      ...mileage,
    },
    vehicleIds
  );

  return c.json({ success: true, data: reminderWithVehiclesToApi(result) }, 201);
});

routes.get('/', async (c) => {
  const user = c.get('user');
  const vehicleId = c.req.query('vehicleId');
  const type = c.req.query('type');
  const isActiveParam = c.req.query('isActive');

  const filters: { vehicleId?: string; type?: string; isActive?: boolean } = {};
  if (vehicleId) filters.vehicleId = vehicleId;
  if (type) filters.type = type;
  if (isActiveParam !== undefined) filters.isActive = isActiveParam === 'true';

  // A vehicleId filter lists the owner's reminders for that vehicle, gated by read access. Without it the
  // list stays scoped to the acting user, so shared reminders never mix into the all-reminders list.
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

routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const result = await validateReminderOwnership(id, user.id);

  return c.json({ success: true, data: reminderWithVehiclesToApi(result) });
});

routes.get('/:id/expenses', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  await validateReminderOwnership(id, user.id);

  const materialized = await expenseRepository.findBySource('reminder', id, user.id);
  return c.json({ success: true, data: materialized.map(expenseToApi) });
});

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateReminderSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const partialUpdate = c.req.valid('json');

    const existing = await reminderRepository.findByIdWithVehicles(id);
    if (!existing) throw new NotFoundError('Reminder');
    const { ownerId } = await requireReminderVehiclesWrite(existing.vehicleIds, user.id);

    // A new vehicle set must resolve to the same owner, or the reminder and its expenses would move to
    // another user's books.
    if (partialUpdate.vehicleIds) {
      const { ownerId: newOwnerId } = await requireReminderVehiclesWrite(
        partialUpdate.vehicleIds,
        user.id
      );
      if (partialUpdate.vehicleIds.length > 0 && newOwnerId !== ownerId) {
        throw new ValidationError(
          'A reminder cannot be moved to a vehicle owned by a different user'
        );
      }
    }

    const merged = {
      ...existing.reminder,
      ...partialUpdate,
      vehicleIds: partialUpdate.vehicleIds ?? existing.vehicleIds,
    };

    // Merged data already holds cents, so validate with the transform-free gate.
    assertMergedReminderValid(merged);

    const { vehicleIds: mergedVehicleIds, ...reminderFields } = partialUpdate;
    const updateFields: Partial<NewReminder> = { ...reminderFields };

    // Recompute derived mileage fields from the merged state so the milestone and dedup key stay consistent.
    const touchesMileage =
      reminderFields.triggerMode !== undefined ||
      reminderFields.intervalMileage !== undefined ||
      reminderFields.lastServiceOdometer !== undefined;
    if (touchesMileage) {
      const mileage = await resolveMileageFields(merged, merged.vehicleIds, ownerId);
      updateFields.intervalMileage = mileage.intervalMileage;
      updateFields.lastServiceOdometer = mileage.lastServiceOdometer;
      updateFields.nextDueOdometer = mileage.nextDueOdometer;
      if (merged.triggerMode === 'mileage') {
        updateFields.nextDueDate = null;
      } else if (merged.triggerMode === 'time' || merged.triggerMode === 'both') {
        updateFields.nextDueDate = merged.nextDueDate ?? merged.startDate;
      }
    }

    const result = await reminderRepository.updateWithVehicles(
      id,
      ownerId,
      updateFields,
      mergedVehicleIds
    );

    return c.json({ success: true, data: reminderWithVehiclesToApi(result) });
  }
);

routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const existing = await reminderRepository.findByIdWithVehicles(id);
  if (!existing) throw new NotFoundError('Reminder');
  const { ownerId } = await requireReminderVehiclesWrite(existing.vehicleIds, user.id);

  // Materialized expenses are history, so sever their link instead of deleting them.
  // Best-effort: a dangling sourceId is harmless, and the delete is what the user asked for.
  try {
    await expenseRepository.clearSource('reminder', id, ownerId);
  } catch {
    // Intentionally ignored; see above.
  }

  await reminderRepository.delete(id);
  return c.json({ success: true, message: 'Reminder deleted successfully' });
});

export { routes };
