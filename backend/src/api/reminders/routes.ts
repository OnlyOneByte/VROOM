import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { CONFIG } from '../../config';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, rateLimiter, requireAuth } from '../../middleware';
import { commonSchemas } from '../../utils/validation';
import { vehicleRepository } from '../vehicles/repository';
import { reminderRepository } from './repository';
import { reminderTriggerService } from './trigger-service';
import { createReminderSchema, updateReminderSchema } from './validation';

const routes = new Hono();

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
  const result = await reminderRepository.createWithVehicles(
    { ...reminderData, userId: user.id, nextDueDate: reminderData.startDate },
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
    const result = await reminderRepository.updateWithVehicles(
      id,
      user.id,
      reminderFields,
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

  await reminderRepository.delete(id);
  return c.json({ success: true, message: 'Reminder deleted successfully' });
});

export { routes };
