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
import { requireVehicleOwnerScope } from '../../utils/sharing';
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

async function requireReminderVehiclesWrite(
  vehicleIds: readonly string[],
  actingUserId: string
): Promise<{ ownerId: string }> {
  let ownerId: string | undefined;
  for (const vehicleId of vehicleIds) {
    const vehicleOwner = await requireVehicleOwnerScope(vehicleId, actingUserId, 'write');
    if (ownerId === undefined) {
      ownerId = vehicleOwner;
    } else if (ownerId !== vehicleOwner) {
      throw new ValidationError('A reminder cannot span vehicles owned by different users');
    }
  }
  return { ownerId: ownerId ?? actingUserId };
}

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

    const existing = await reminderRepository.findByIdWithVehicles(id);
    if (!existing) throw new NotFoundError('Reminder');
    const { reminder, vehicleIds } = existing;
    const { ownerId } = await requireReminderVehiclesWrite(vehicleIds, user.id);

    const fields: { lastServiceOdometer?: number; nextDueOdometer?: number; nextDueDate?: Date } =
      {};

    if (reminder.triggerMode === 'mileage' || reminder.triggerMode === 'both') {
      // Shared-vehicle odometer rows are owner-stamped, so reads must use ownerId, not the actor.
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

  let listUserId = user.id;
  if (vehicleId) {
    const ownerId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');
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

    if (partialUpdate.vehicleIds) {
      const { ownerId: newOwnerId } = await requireReminderVehiclesWrite(
        partialUpdate.vehicleIds,
        user.id
      );
      if (newOwnerId !== ownerId) {
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

    assertMergedReminderValid(merged);

    const { vehicleIds: mergedVehicleIds, ...reminderFields } = partialUpdate;
    const updateFields: Partial<NewReminder> = { ...reminderFields };

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

  // clearSource must run before the delete: a dangling sourceId fails backup validation on restore.
  await expenseRepository.clearSource('reminder', id, ownerId);

  await reminderRepository.delete(id);
  return c.json({ success: true, message: 'Reminder deleted successfully' });
});

export { routes };
