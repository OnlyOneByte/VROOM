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
import { changeTracker, requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import { buildTripSummary } from '../../utils/trip-summary';
import {
  commonSchemas,
  validateTripOwnership,
  validateVehicleOwnership,
} from '../../utils/validation';
import { odometerRepository } from '../odometer/repository';
import { reminderTriggerService } from '../reminders/trigger-service';
import { tripRepository } from './repository';
import { createTripSchema, TRIP_PURPOSES, updateTripSchema } from './validation';

const routes = new Hono();

const listQuerySchema = z.object({
  ...commonSchemas.clampedPaginationFields,
  vehicleId: z.string().min(1).optional(),
  purpose: z.enum(TRIP_PURPOSES).optional(),
});

const summaryQuerySchema = z.object({
  // Optional vehicle scope (else cross-fleet) + the business-mileage reimbursement rate ($/mile, R4/D3).
  // The rate is a query param (NOT a stored field yet — its persistence is a separate schema slice, §7);
  // default 0 → the businessMileageValue is 0 until a rate is supplied / the preferences field lands.
  vehicleId: z.string().min(1).optional(),
  rate: z.coerce.number().min(0).optional(),
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

  // D2 (ratified): the trip's END reading feeds the all-time currentOdometer + the mileage-reminder axis —
  // write an odometer entry at endOdometer/tripDate, DEDUPED by (vehicle, day, reading) so it doesn't
  // double-count a manual reading the user also logged. Then recheck mileage reminders (the new reading may
  // cross a milestone), mirroring the odometer route's create path. Both are best-effort — the trip is
  // ALREADY persisted, so a side-effect hiccup must NOT fail the create. recheckMileageReminders is
  // internally guarded (C42, never throws), but createFromTrip is a plain repo write whose dedup SELECT /
  // INSERT CAN throw a DatabaseError — left unguarded, that 500'd a create whose trip row already committed,
  // so the FE showed "failed" and a retry made a DUPLICATE (C233: the "never fails the create" comment was a
  // lie for this leg). Wrap the whole D2 block: log + swallow, return the 201 the persisted trip earned.
  try {
    await odometerRepository.createFromTrip({
      vehicleId: data.vehicleId,
      userId: user.id,
      odometer: data.endOdometer,
      recordedAt: data.tripDate,
    });
    await reminderTriggerService.recheckMileageReminders(user.id, data.vehicleId);
  } catch (error) {
    logger.error('Trip D2 odometer-linkage/reminder-recheck failed (trip already persisted)', {
      tripId: trip.id,
      vehicleId: data.vehicleId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

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

// GET /api/v1/trips/summary — the mileage-summary rollup (R4): miles-by-purpose, business-$ at the supplied
// rate, count, avg. Optional vehicleId scopes to one vehicle (ownership-checked), else cross-fleet. MUST be
// registered BEFORE /:id so the literal 'summary' segment isn't captured as a trip id.
routes.get('/summary', zValidator('query', summaryQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, rate } = c.req.valid('query');

  if (vehicleId) {
    await validateVehicleOwnership(vehicleId, user.id);
  }
  const trips = vehicleId
    ? await tripRepository.findByVehicle(vehicleId, user.id)
    : await tripRepository.findByUserId(user.id);

  const summary = buildTripSummary(trips, rate ?? 0);
  return c.json({ success: true, data: summary });
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

// PUT /api/v1/trips/:id — update (ownership-checked). R2 must hold on the EFFECTIVE merged pair, not just
// the request body: updateTripSchema's refine fires only when BOTH odometers are present in the body, so a
// partial PUT sending only one (e.g. endOdometer below the STORED startOdometer) would otherwise persist an
// inverted pair — distance clamps to 0, a phantom 0-mile trip (#109 "refine doesn't survive partial" / #130
// "validate the merged state, not the request"). Re-check against the existing row before writing.
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateTripSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    const existing = await validateTripOwnership(id, user.id);

    // The merged odometer pair = the request value where sent, else the stored value.
    const start = data.startOdometer ?? existing.startOdometer;
    const end = data.endOdometer ?? existing.endOdometer;
    if (end < start) {
      return c.json(
        {
          success: false,
          error: 'endOdometer must be greater than or equal to startOdometer',
        },
        400
      );
    }

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
