import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { repos } from '../../app-context';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import type { NewReminder, Reminder } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, rateLimiter, requireAuth } from '../../middleware';
import {
  authorize,
  ownAccount,
  type ResourceOf,
  requireCan,
  vehicleEntry,
  vehicleOrOwnAccount,
} from '../../permissions/authorize';
import { requestResolver } from '../../permissions/grants';
import type { Resource } from '../../permissions/resolve';
import { logger } from '../../utils/logger';
import {
  centsToDollars,
  expenseToApi,
  reminderToApi,
  reminderWithVehiclesToApi,
} from '../../utils/money';
import { readJsonBody } from '../../utils/request-body';
import { calendarDayIn, isValidTimeZone } from '../../utils/time-zone';
import { commonSchemas, zValidator } from '../../utils/validation';
import { requireVehicleAccess, requireVehiclesAccess } from '../../utils/vehicle-access';
import { expenseRepository } from '../expenses/repository';
import { recurringCostSummary } from './reminder-cost';
import type { ReminderWithVehicles } from './repository';
import {
  advanceReminderDueDate,
  firstDueOnOrAfter,
  previousDueBefore,
  type ReminderSchedule,
  reminderTriggerService,
} from './trigger-service';
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
    (await repos().odometer.getCurrentOdometer(vehicleIds[0], userId)) ??
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
  const [ownerId, ...otherOwners] = await requireVehiclesAccess(vehicleIds, actingUserId, 'read');
  if (ownerId === undefined) {
    throw new ValidationError('A reminder needs at least one vehicle');
  }
  if (otherOwners.length > 0) {
    throw new ValidationError('A reminder cannot span vehicles owned by different users');
  }
  return { ownerId };
}

async function requireExistingReminderWrite(
  existing: ReminderWithVehicles,
  actingUserId: string
): Promise<{ ownerId: string }> {
  const { reminder, vehicleIds } = existing;
  if (vehicleIds.length === 0) {
    if (reminder.userId !== actingUserId) throw new NotFoundError('Reminder');
    return { ownerId: actingUserId };
  }
  const { ownerId } = await requireReminderVehiclesWrite(vehicleIds, actingUserId);
  if (ownerId !== reminder.userId) throw new NotFoundError('Reminder');
  return { ownerId };
}

const vehicleResource = (vehicleId: string): Resource => ({ kind: 'vehicle', vehicleId });

const fromQueryVehicle: ResourceOf = (c) => vehicleOrOwnAccount(c.req.query('vehicleId'), c);

const fromBodyVehicles: ResourceOf = async (c) =>
  (await readJsonBody<{ vehicleIds: string[] }>(c)).vehicleIds.map(vehicleResource);

async function reminderResources(c: Context): Promise<Resource[]> {
  const existing = await repos().reminders.findByIdWithVehicles(c.req.param('id') ?? '');
  if (!existing) throw new NotFoundError('Reminder');
  const { reminder, vehicleIds } = existing;
  if (vehicleIds.length > 0) {
    return vehicleIds.map((vehicleId) =>
      vehicleEntry(vehicleId, reminder.userId, reminder.createdBy)
    );
  }
  if (reminder.userId !== c.get('user').id) throw new NotFoundError('Reminder');
  return [{ kind: 'account', userId: reminder.userId }];
}

const fromReminder: ResourceOf = reminderResources;

const fromReminderReadable: ResourceOf = async (c) => {
  const all = await reminderResources(c);
  const resolver = requestResolver(c, getDb());
  const readable = all.filter((r) => resolver.can('vehicle.reminder.read', r).allow);
  return readable.length > 0 ? readable : all.slice(0, 1);
};

function visibleVehicleIds(c: Context, vehicleIds: readonly string[]): string[] {
  const resolver = requestResolver(c, getDb());
  return vehicleIds.filter(
    (vehicleId) => resolver.can('vehicle.reminder.read', vehicleResource(vehicleId)).allow
  );
}

const timeZoneQuerySchema = z.object({
  timeZone: z
    .string()
    .optional()
    .transform((zone) => {
      if (zone === undefined || isValidTimeZone(zone)) return zone;
      logger.warn('Unknown reminder time zone; using server time', { timeZone: zone.slice(0, 64) });
      return undefined;
    }),
});

function advanceToFirstFutureDue(
  reminder: Reminder,
  from: Date,
  timeZone: string | undefined
): Date {
  const now = new Date();
  let nextDue = advanceReminderDueDate(reminder, from, timeZone);
  while (nextDue <= now) {
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

function nextDueAfterService(
  reminder: Reminder,
  due: Date,
  now: Date,
  timeZone: string | undefined
): Date {
  if (due <= now) return advanceToFirstFutureDue(reminder, due, timeZone);
  const periodStart = previousDueBefore(reminder, due, timeZone);
  const alreadyAdvanced =
    periodStart !== null &&
    (periodStart > now ||
      (reminder.lastTriggeredAt !== null && reminder.lastTriggeredAt >= periodStart));
  return alreadyAdvanced ? due : advanceReminderDueDate(reminder, due, timeZone);
}

const DAY_MS = 86_400_000;
const NOON_MS = 12 * 3_600_000;

export function isSameSubmittedDay(stored: Date, submitted: Date): boolean {
  const submittedTimeOfDay = ((submitted.getTime() % DAY_MS) + DAY_MS) % DAY_MS;
  const submitterOffset = NOON_MS - submittedTimeOfDay;
  const dayOf = (d: Date) => Math.floor((d.getTime() + submitterOffset) / DAY_MS);
  return dayOf(stored) === dayOf(submitted);
}

function isUnchangedDay(
  stored: Date | null,
  submitted: Date | null | undefined,
  timeZone: string | undefined
): boolean {
  if (stored === null || submitted == null) return false;
  if (timeZone) return calendarDayIn(stored, timeZone) === calendarDayIn(submitted, timeZone);
  return isSameSubmittedDay(stored, submitted);
}

function keepStoredDatesOnSameDay<
  T extends { startDate?: Date; endDate?: Date | null; timeZone?: string },
>(update: T, existing: Reminder): T {
  const { startDate, endDate, ...rest } = update;
  const isUnchanged = (stored: Date | null, submitted: Date | null | undefined) =>
    isUnchangedDay(stored, submitted, update.timeZone);
  return {
    ...rest,
    ...(startDate !== undefined && !isUnchanged(existing.startDate, startDate)
      ? { startDate }
      : {}),
    ...(endDate !== undefined && !isUnchanged(existing.endDate, endDate) ? { endDate } : {}),
  } as T;
}

type MergedSchedule = ReminderSchedule & { triggerMode: string; endDate?: Date | null };

function scheduleChanged(existing: Reminder, merged: MergedSchedule): boolean {
  const customIntervalChanged =
    merged.frequency === 'custom' &&
    (merged.intervalValue !== existing.intervalValue ||
      merged.intervalUnit !== existing.intervalUnit);
  return (
    merged.startDate.getTime() !== existing.startDate.getTime() ||
    merged.frequency !== existing.frequency ||
    customIntervalChanged ||
    (merged.triggerMode === 'mileage') !== (existing.triggerMode === 'mileage')
  );
}

function rescheduledFields(
  existing: Reminder,
  update: Partial<NewReminder>,
  merged: MergedSchedule,
  timeZone: string | undefined
): Partial<NewReminder> {
  if (merged.triggerMode === 'mileage') return {};
  const resumed = update.isActive === true && !existing.isActive;
  if (!resumed && !scheduleChanged(existing, merged)) return {};
  const nextDueDate = firstDueOnOrAfter(merged, new Date(), timeZone);
  const ended = merged.endDate != null && nextDueDate > merged.endDate;
  return ended ? { nextDueDate, isActive: false } : { nextDueDate };
}

routes.use('*', requireAuth);
routes.use('*', changeTracker);

const triggerRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.trigger,
  keyGenerator: (c) => `trigger:${c.get('user').id}`,
});

// Static segments must be registered before /:id.
routes.post(
  '/trigger',
  triggerRateLimiter,
  zValidator('query', timeZoneQuerySchema),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { timeZone } = c.req.valid('query');
    const result = await reminderTriggerService.processOverdueReminders(user.id, timeZone);
    return c.json({
      success: true,
      data: { ...result, createdExpenses: result.createdExpenses.map(expenseToApi) },
    });
  }
);

routes.get('/recurring-cost', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const expenseReminders = await repos().reminders.findByUserId(user.id, { type: 'expense' });
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
  zValidator('query', timeZoneQuerySchema),
  authorize(fromReminder),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { timeZone } = c.req.valid('query');

    const existing = await repos().reminders.findByIdWithVehicles(id);
    if (!existing) throw new NotFoundError('Reminder');
    const { reminder, vehicleIds } = existing;
    const { ownerId } = await requireExistingReminderWrite(existing, user.id);

    const fields: { lastServiceOdometer?: number; nextDueOdometer?: number; nextDueDate?: Date } =
      {};

    if (reminder.triggerMode === 'mileage' || reminder.triggerMode === 'both') {
      // Shared-vehicle odometer rows are owner-stamped, so reads must use ownerId, not the actor.
      const vehicleId = vehicleIds[0];
      const current = vehicleId
        ? await repos().odometer.getCurrentOdometer(vehicleId, ownerId)
        : null;
      const lastServiceOdometer = current ?? reminder.lastServiceOdometer ?? 0;
      fields.lastServiceOdometer = lastServiceOdometer;
      fields.nextDueOdometer = lastServiceOdometer + (reminder.intervalMileage ?? 0);
    }

    if (
      (reminder.triggerMode === 'time' || reminder.triggerMode === 'both') &&
      reminder.nextDueDate
    ) {
      const nextDue = nextDueAfterService(reminder, reminder.nextDueDate, new Date(), timeZone);
      if (reminder.endDate && nextDue > reminder.endDate) {
        await repos().reminders.deactivate(id, ownerId);
        return c.json({ success: true, data: reminderToApi({ ...reminder, isActive: false }) });
      }
      fields.nextDueDate = nextDue;
    }

    const updated = await repos().reminders.markServiced(id, ownerId, fields);
    return c.json({ success: true, data: reminderToApi(updated) });
  }
);

routes.get('/notifications', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  const notifications = await repos().reminders.findNotifications(user.id, unreadOnly);
  return c.json({ success: true, data: notifications });
});

routes.put(
  '/notifications/:id/read',
  zValidator('param', commonSchemas.idParam),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await repos().reminders.markNotificationRead(id, user.id);
    return c.json({ success: true, message: 'Notification marked as read' });
  }
);

routes.post(
  '/',
  zValidator('json', createReminderSchema),
  authorize(fromBodyVehicles),
  async (c) => {
    const user = c.get('user');
    const data = c.req.valid('json');

    const { vehicleIds, timeZone: _createTimeZone, ...reminderData } = data;
    const { ownerId } = await requireReminderVehiclesWrite(vehicleIds, user.id);
    const mileage = await resolveMileageFields(reminderData, vehicleIds, ownerId);
    const result = await repos().reminders.createWithVehicles(
      {
        ...reminderData,
        userId: ownerId,
        createdBy: ownerId === user.id ? null : user.id,
        nextDueDate: reminderData.triggerMode === 'mileage' ? null : reminderData.startDate,
        ...mileage,
      },
      vehicleIds
    );

    return c.json({ success: true, data: reminderWithVehiclesToApi(result) }, 201);
  }
);

routes.get('/', authorize(fromQueryVehicle), async (c) => {
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
    const { ownerId } = await requireVehicleAccess(vehicleId, user.id, 'read');
    listUserId = ownerId;
  }

  const reminders = await repos().reminders.findByUserId(listUserId, filters);
  const visible =
    listUserId === user.id
      ? reminders
      : reminders.map((row) => ({ ...row, vehicleIds: visibleVehicleIds(c, row.vehicleIds) }));
  return c.json({ success: true, data: visible.map(reminderWithVehiclesToApi) });
});

routes.get(
  '/:id/expenses',
  zValidator('param', commonSchemas.idParam),
  authorize(fromReminderReadable),
  async (c) => {
    const { id } = c.req.valid('param');
    const existing = await repos().reminders.findByIdWithVehicles(id);
    if (!existing) throw new NotFoundError('Reminder');
    const resolver = requestResolver(c, getDb());
    const materialized = await expenseRepository.findBySource(
      'reminder',
      id,
      existing.reminder.userId
    );
    const readable = materialized.filter(
      (expense) => resolver.can('vehicle.expense.read', vehicleResource(expense.vehicleId)).allow
    );
    return c.json({ success: true, data: readable.map(expenseToApi) });
  }
);

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateReminderSchema),
  authorize(fromReminder),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    const existing = await repos().reminders.findByIdWithVehicles(id);
    if (!existing) throw new NotFoundError('Reminder');
    const { ownerId } = await requireExistingReminderWrite(existing, user.id);
    const partialUpdate = keepStoredDatesOnSameDay(c.req.valid('json'), existing.reminder);

    if (partialUpdate.vehicleIds) {
      for (const vehicleId of partialUpdate.vehicleIds) {
        requireCan(c, 'vehicle.reminder.write', vehicleResource(vehicleId));
      }
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

    assertMergedReminderValid(merged, partialUpdate);

    const { vehicleIds: mergedVehicleIds, timeZone, ...reminderFields } = partialUpdate;
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

    Object.assign(
      updateFields,
      rescheduledFields(existing.reminder, reminderFields, merged, timeZone)
    );

    const result = await repos().reminders.updateWithVehicles(
      id,
      ownerId,
      updateFields,
      mergedVehicleIds
    );

    return c.json({ success: true, data: reminderWithVehiclesToApi(result) });
  }
);

routes.delete(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  authorize(fromReminder),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    const existing = await repos().reminders.findByIdWithVehicles(id);
    if (!existing) throw new NotFoundError('Reminder');
    const { ownerId } = await requireExistingReminderWrite(existing, user.id);

    // clearSource must run before the delete: a dangling sourceId fails backup validation on restore.
    await expenseRepository.clearSource('reminder', id, ownerId);

    await repos().reminders.deleteOwned(id, ownerId);
    return c.json({ success: true, message: 'Reminder deleted successfully' });
  }
);

export { routes };
