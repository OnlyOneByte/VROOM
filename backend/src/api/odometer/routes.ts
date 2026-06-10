import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse } from '../../utils/pagination';
import {
  commonSchemas,
  validateOdometerOwnership,
  validateVehicleOwnership,
} from '../../utils/validation';
import { deleteAllPhotosForEntity } from '../photos/photo-service';
import { reminderTriggerService } from '../reminders/trigger-service';
import { odometerRepository } from './repository';

const routes = new Hono();

// --- Zod schemas ---

const createSchema = z.object({
  odometer: z.number().int().min(0, 'Odometer must be a non-negative integer'),
  recordedAt: z.coerce
    .date()
    .refine((d) => d <= new Date(), { message: 'Date cannot be in the future' }),
  note: z.string().max(500).optional(),
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(CONFIG.pagination.maxPageSize).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// --- Middleware ---

routes.use('*', requireAuth);
routes.use('*', changeTracker);

// --- Routes ---

// GET /:vehicleId — list entries for a vehicle (paginated)
routes.get(
  '/:vehicleId',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('query', listQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');

    await validateVehicleOwnership(vehicleId, user.id);

    const limit = Math.min(
      query.limit ?? CONFIG.pagination.defaultPageSize,
      CONFIG.pagination.maxPageSize
    );
    const offset = query.offset ?? 0;

    const { data, totalCount } = await odometerRepository.findByVehicleIdPaginated(
      vehicleId,
      user.id,
      limit,
      offset
    );

    return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
  }
);

// GET /:vehicleId/history — unified odometer history (UNION of expenses + manual entries)
routes.get(
  '/:vehicleId/history',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('query', listQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');

    await validateVehicleOwnership(vehicleId, user.id);

    const limit = Math.min(
      query.limit ?? CONFIG.pagination.defaultPageSize,
      CONFIG.pagination.maxPageSize
    );
    const offset = query.offset ?? 0;

    const { data, totalCount } = await odometerRepository.getHistory(vehicleId, user.id, {
      limit,
      offset,
    });

    return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
  }
);

// GET /entry/:id — get a single entry by ID
routes.get('/entry/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const entry = await validateOdometerOwnership(id, user.id);

  return c.json({ success: true, data: entry });
});

// POST /:vehicleId — create manual entry
routes.post(
  '/:vehicleId',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('json', createSchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const data = c.req.valid('json');

    await validateVehicleOwnership(vehicleId, user.id);

    const entry = await odometerRepository.create({
      vehicleId,
      userId: user.id,
      odometer: data.odometer,
      recordedAt: data.recordedAt,
      note: data.note ?? null,
    });

    // D5: a new reading may have crossed a mileage reminder's milestone — re-check this vehicle's
    // mileage reminders now so the notification fires immediately, not only on the next /trigger.
    // Best-effort (recheck never throws); the reading is already persisted.
    await reminderTriggerService.recheckMileageReminders(user.id, vehicleId);

    return c.json({ success: true, data: entry, message: 'Odometer reading created' }, 201);
  }
);

// PUT /:id — update a manual entry
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    await validateOdometerOwnership(id, user.id);

    const updated = await odometerRepository.update(id, {
      ...data,
      updatedAt: new Date(),
    });

    return c.json({ success: true, data: updated, message: 'Odometer reading updated' });
  }
);

// DELETE /:id — delete a manual entry
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  await validateOdometerOwnership(id, user.id);

  await deleteAllPhotosForEntity('odometer_entry', id, user.id);
  await odometerRepository.delete(id);

  return c.json({ success: true, message: 'Odometer reading deleted' });
});

export { routes };
