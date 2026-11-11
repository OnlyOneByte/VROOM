import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import {
  requireVehicleRead,
  requireVehicleWrite,
  resolveVehicleOwnerId,
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

    // Odometer rows are stamped with the owner's id, so the query scopes to the owner, not the invitee.
    await requireVehicleRead(vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');

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

    await requireVehicleRead(vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');

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

  // Authorize via the entry's vehicle, not its row owner; a stranger gets the same 404 as a missing row.
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

    // Editors write into the owner's books: the row is stamped with the owner's userId, since odometer
    // rows have no createdBy column to record the editor.
    await requireVehicleWrite(vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');

    const entry = await odometerRepository.create({
      vehicleId,
      userId: ownerId,
      odometer: data.odometer,
      recordedAt: data.recordedAt,
      note: data.note ?? null,
    });

    // Reminders belong to the owner. The recheck never throws, so a failure cannot undo the saved reading.
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

    // Authorize via the vehicle's write access, not the row owner's id; the update never changes userId.
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

  // Photo ownership is validated against the row's userId, so cleanup must use the owner, not the editor.
  const existing = await odometerRepository.findById(id);
  if (!existing) throw new NotFoundError('Odometer entry');
  await requireVehicleWrite(existing.vehicleId, user.id);

  await deleteAllPhotosForEntity('odometer_entry', id, existing.userId);
  await odometerRepository.delete(id);

  return c.json({ success: true, message: 'Odometer reading deleted' });
});

export { routes };
