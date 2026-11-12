import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import {
  requireVehicleOwnerScope,
  requireVehicleRead,
  requireVehicleWrite,
} from '../../utils/sharing';
import { commonSchemas, zValidator } from '../../utils/validation';
import { deleteAllPhotosForEntity } from '../photos/photo-service';
import { reminderTriggerService } from '../reminders/trigger-service';
import { odometerRepository } from './repository';

const routes = new Hono();

const createSchema = z.object({
  odometer: z.number().int().min(0, 'Odometer must be a non-negative integer'),
  recordedAt: z.coerce
    .date()
    .refine((d) => d <= new Date(), { message: 'Date cannot be in the future' }),
  note: z.string().max(500).optional(),
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  ...commonSchemas.clampedPaginationFields,
});

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.get(
  '/:vehicleId',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('query', listQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');

    const ownerId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');

    const { limit, offset } = clampPagination(query);

    const { data, totalCount } = await odometerRepository.findByVehicleIdPaginated(
      vehicleId,
      ownerId,
      limit,
      offset
    );

    return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
  }
);

routes.get(
  '/:vehicleId/history',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('query', listQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');

    const ownerId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');

    const { limit, offset } = clampPagination(query);

    const { data, totalCount } = await odometerRepository.getHistory(vehicleId, ownerId, {
      limit,
      offset,
    });

    return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
  }
);

routes.get('/entry/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const entry = await odometerRepository.findById(id);
  if (!entry) throw new NotFoundError('Odometer entry');
  await requireVehicleRead(entry.vehicleId, user.id);

  return c.json({ success: true, data: entry });
});

routes.post(
  '/:vehicleId',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('json', createSchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const data = c.req.valid('json');

    const ownerId = await requireVehicleOwnerScope(vehicleId, user.id, 'write');

    const entry = await odometerRepository.create({
      vehicleId,
      userId: ownerId,
      odometer: data.odometer,
      recordedAt: data.recordedAt,
      note: data.note ?? null,
    });

    await reminderTriggerService.recheckMileageReminders(ownerId, vehicleId);

    return c.json({ success: true, data: entry, message: 'Odometer reading created' }, 201);
  }
);

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    const existing = await odometerRepository.findById(id);
    if (!existing) throw new NotFoundError('Odometer entry');
    await requireVehicleWrite(existing.vehicleId, user.id);

    const updated = await odometerRepository.update(id, {
      ...data,
      updatedAt: new Date(),
    });

    await reminderTriggerService.recheckMileageReminders(existing.userId, updated.vehicleId);

    return c.json({ success: true, data: updated, message: 'Odometer reading updated' });
  }
);

routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const existing = await odometerRepository.findById(id);
  if (!existing) throw new NotFoundError('Odometer entry');
  await requireVehicleWrite(existing.vehicleId, user.id);

  await deleteAllPhotosForEntity('odometer_entry', id, existing.userId);
  await odometerRepository.delete(id);

  return c.json({ success: true, message: 'Odometer reading deleted' });
});

export { routes };
