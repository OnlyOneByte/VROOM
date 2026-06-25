/**
 * Trip routes (trips-location T3, design §3).
 *
 *   POST   /api/v1/trips                — create a trip (vehicleId in the body, ownership-checked)
 *   GET    /api/v1/trips                — list the user's trips (paginated; optional vehicleId/purpose filter)
 *   GET    /api/v1/trips/:id            — one trip (ownership-checked)
 *   PUT    /api/v1/trips/:id            — update a trip (ownership-checked; R2 refine survives the partial)
 *   DELETE /api/v1/trips/:id            — delete a trip (tenant-safe deleteByIdAndUserId, the #52 guard)
 *   GET    /api/v1/vehicles/:id/trips   — a vehicle's trips (mounted under the trips router as /vehicle/:vehicleId)
 *
 * Ownership: a CREATE validates the body's vehicleId via validateVehicleOwnership; every mutate/read by trip
 * id goes through validateTripOwnership (NotFound, never 403 — the #80 enumeration discipline). Trips own via
 * a userId column, and the repo finders are userId-scoped, so an unowned id is indistinguishable from absent.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import {
  commonSchemas,
  validateTripOwnership,
  validateVehicleOwnership,
} from '../../utils/validation';
import { tripRepository } from './repository';
import { createTripSchema, TRIP_PURPOSES, updateTripSchema } from './validation';

const routes = new Hono();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(CONFIG.pagination.maxPageSize).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  vehicleId: z.string().min(1).optional(),
  purpose: z.enum(TRIP_PURPOSES).optional(),
});

routes.use('*', requireAuth);
routes.use('*', changeTracker);

// POST /api/v1/trips — create (vehicleId in the body, validated for ownership before the insert).
routes.post('/', zValidator('json', createTripSchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  await validateVehicleOwnership(data.vehicleId, user.id);

  const trip = await tripRepository.create({
    vehicleId: data.vehicleId,
    userId: user.id,
    startOdometer: data.startOdometer,
    endOdometer: data.endOdometer,
    purpose: data.purpose,
    tripDate: data.tripDate,
    startLocation: data.startLocation ?? null,
    endLocation: data.endLocation ?? null,
    note: data.note ?? null,
  });

  return c.json({ success: true, data: trip, message: 'Trip created' }, 201);
});

// GET /api/v1/trips — the user's trips, paginated, optionally filtered by vehicleId and/or purpose.
routes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const user = c.get('user');
  const query = c.req.valid('query');
  const { limit, offset } = clampPagination(query);

  const { data, totalCount } = await tripRepository.findByUserIdPaginated(user.id, limit, offset, {
    vehicleId: query.vehicleId,
    purpose: query.purpose,
  });

  return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
});

// GET /api/v1/vehicles/:id/trips is mounted here as /vehicle/:vehicleId (app.ts routes the vehicles-trips
// path to this sub-route) — a vehicle's trips, newest first, tenant-scoped.
routes.get('/vehicle/:vehicleId', zValidator('param', commonSchemas.vehicleIdParam), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('param');

  await validateVehicleOwnership(vehicleId, user.id);

  const data = await tripRepository.findByVehicle(vehicleId, user.id);
  return c.json({ success: true, data });
});

// GET /api/v1/trips/:id — one trip (ownership-checked).
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const trip = await validateTripOwnership(id, user.id);
  return c.json({ success: true, data: trip });
});

// PUT /api/v1/trips/:id — update (ownership-checked; the R2 refine fires only when both odometers present).
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateTripSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    await validateTripOwnership(id, user.id);

    const updated = await tripRepository.update(id, data);
    return c.json({ success: true, data: updated, message: 'Trip updated' });
  }
);

// DELETE /api/v1/trips/:id — tenant-safe delete (keys on id AND userId; false → 404).
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const deleted = await tripRepository.deleteByIdAndUserId(id, user.id);
  if (!deleted) {
    return c.json({ success: false, error: 'Trip not found' }, 404);
  }
  return c.json({ success: true, message: 'Trip deleted' });
});

export { routes };
