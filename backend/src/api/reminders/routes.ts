import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { CONFIG } from '../../config';
import type { NewReminder } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, rateLimiter, requireAuth } from '../../middleware';
import { commonSchemas } from '../../utils/validation';
import { expenseRepository } from '../expenses/repository';
import { odometerRepository } from '../odometer/repository';
import { vehicleRepository } from '../vehicles/repository';
import { reminderRepository } from './repository';
import { computeNextDueDate, reminderTriggerService } from './trigger-service';
import { createReminderSchema, updateReminderSchema } from './validation';

const routes = new Hono();

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
  vehicleIds: string[]
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
    data.lastServiceOdometer ?? (await odometerRepository.getCurrentOdometer(vehicleIds[0])) ?? 0;
  return {
    intervalMileage,
    lastServiceOdometer,
    nextDueOdometer: lastServiceOdometer + intervalMileage,
  };
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
  return c.json({ success: true, data: result });
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

    const existing = await reminderRepository.findByIdAndUserId(id, user.id);
    if (!existing) {
      throw new NotFoundError('Reminder');
    }
    const { reminder, vehicleIds } = existing;

    // Compute the re-arm per axis (D3). The route owns the math (it has the odometer repo +
    // computeNextDueDate) to keep the repository free of a trigger-service import cycle.
    const fields: { lastServiceOdometer?: number; nextDueOdometer?: number; nextDueDate?: Date } =
      {};

    // Mileage axis: anchor to the CURRENT odometer, recompute the milestone cache.
    if (reminder.triggerMode === 'mileage' || reminder.triggerMode === 'both') {
      const vehicleId = vehicleIds[0];
      const current = vehicleId ? await odometerRepository.getCurrentOdometer(vehicleId) : null;
      const lastServiceOdometer = current ?? reminder.lastServiceOdometer ?? 0;
      fields.lastServiceOdometer = lastServiceOdometer;
      fields.nextDueOdometer = lastServiceOdometer + (reminder.intervalMileage ?? 0);
    }

    // Time axis: advance nextDueDate one period from its current value (reuse the trigger math).
    if (
      (reminder.triggerMode === 'time' || reminder.triggerMode === 'both') &&
      reminder.nextDueDate
    ) {
      fields.nextDueDate = computeNextDueDate(
        reminder.nextDueDate,
        reminder.frequency,
        reminder.intervalValue,
        reminder.intervalUnit,
        reminder.startDate.getDate()
      );
    }

    const updated = await reminderRepository.markServiced(id, user.id, fields);
    return c.json({ success: true, data: updated });
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
  const userVehicles = await vehicleRepository.findByUserId(user.id);
  const ownedVehicleIds = new Set(userVehicles.map((v) => v.id));
  const invalidIds = data.vehicleIds.filter((id: string) => !ownedVehicleIds.has(id));
  if (invalidIds.length > 0) {
    throw new ValidationError(`Vehicles not found or not owned: ${invalidIds.join(', ')}`);
  }

  const { vehicleIds, ...reminderData } = data;
  const mileage = await resolveMileageFields(reminderData, vehicleIds);
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

  return c.json({ success: true, data: result }, 201);
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

  const reminders = await reminderRepository.findByUserId(user.id, filters);
  return c.json({ success: true, data: reminders });
});

// GET /:id — get single reminder
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const result = await reminderRepository.findByIdAndUserId(id, user.id);
  if (!result) {
    throw new NotFoundError('Reminder');
  }

  return c.json({ success: true, data: result });
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
    const existing = await reminderRepository.findByIdAndUserId(id, user.id);
    if (!existing) {
      throw new NotFoundError('Reminder');
    }

    // If vehicleIds are being updated, verify ownership
    if (partialUpdate.vehicleIds) {
      const userVehicles = await vehicleRepository.findByUserId(user.id);
      const ownedVehicleIds = new Set(userVehicles.map((v) => v.id));
      const invalidIds = partialUpdate.vehicleIds.filter(
        (vid: string) => !ownedVehicleIds.has(vid)
      );
      if (invalidIds.length > 0) {
        throw new ValidationError(`Vehicles not found or not owned: ${invalidIds.join(', ')}`);
      }
    }

    // Merge partial update with existing to re-validate the full object
    const merged = {
      ...existing.reminder,
      ...partialUpdate,
      vehicleIds: partialUpdate.vehicleIds ?? existing.vehicleIds,
    };

    // Re-validate merged result to prevent invalid intermediate states
    createReminderSchema.parse(merged);

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
      const mileage = await resolveMileageFields(merged, merged.vehicleIds);
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

    return c.json({ success: true, data: result });
  }
);

// DELETE /:id — delete reminder (CASCADE handles junction + notifications)
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const existing = await reminderRepository.findByIdAndUserId(id, user.id);
  if (!existing) {
    throw new NotFoundError('Reminder');
  }

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
