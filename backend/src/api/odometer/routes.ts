import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse } from '../../utils/pagination';
import { commonSchemas, validateVehicleOwnership } from '../../utils/validation';
import { deleteAllPhotosForEntity } from '../photos/photo-service';
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
      limit,
      offset
    );

    return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
  }
);

// GET /entry/:id — get a single entry by ID
routes.get('/entry/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const entry = await odometerRepository.findById(id);
  if (!entry || entry.userId !== user.id) {
    throw new NotFoundError('Odometer entry');
  }

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
      linkedEntityType: null,
      linkedEntityId: null,
    });

    return c.json({ success: true, data: entry, message: 'Odometer reading created' }, 201);
  }
);

// PUT /:id — update a manual entry (reject if linked)
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    const entry = await odometerRepository.findById(id);
    if (!entry || entry.userId !== user.id) {
      throw new NotFoundError('Odometer entry');
    }

    if (entry.linkedEntityType) {
      throw new ValidationError(
        'Linked odometer entries are managed automatically. Edit the source record instead.'
      );
    }

    const updated = await odometerRepository.update(id, {
      ...data,
      updatedAt: new Date(),
    });

    return c.json({ success: true, data: updated, message: 'Odometer reading updated' });
  }
);

// DELETE /:id — delete a manual entry (reject if linked)
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const entry = await odometerRepository.findById(id);
  if (!entry || entry.userId !== user.id) {
    throw new NotFoundError('Odometer entry');
  }

  if (entry.linkedEntityType) {
    throw new ValidationError(
      'Linked odometer entries are managed automatically. Edit the source record instead.'
    );
  }

  await deleteAllPhotosForEntity('odometer_entry', id, user.id);
  await odometerRepository.delete(id);

  return c.json({ success: true, message: 'Odometer reading deleted' });
});

export { routes };
