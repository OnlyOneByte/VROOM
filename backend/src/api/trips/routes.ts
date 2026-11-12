import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import { buildTripSummary } from '../../utils/trip-summary';
import {
  commonSchemas,
  validateTripOwnership,
  validateVehicleOwnership,
  zValidator,
} from '../../utils/validation';
import { odometerRepository } from '../odometer/repository';
import { reminderTriggerService } from '../reminders/trigger-service';
import { preferencesRepository } from '../settings/repository';
import { tripRepository } from './repository';
import { createTripSchema, TRIP_PURPOSES, updateTripSchema } from './validation';

const routes = new Hono();

const listQuerySchema = z.object({
  ...commonSchemas.clampedPaginationFields,
  vehicleId: z.string().min(1).optional(),
  purpose: z.enum(TRIP_PURPOSES).optional(),
});

// z.coerce.boolean treats any non-empty string as true, so parse the enum instead.
const deleteQuerySchema = z.object({
  keepOdometer: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
});

const summaryQuerySchema = z.object({
  vehicleId: z.string().min(1).optional(),
  rate: z.coerce.number().min(0).optional(),
});

routes.use('*', requireAuth);
routes.use('*', changeTracker);

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

  // Logged, not thrown: a 500 after the insert would invite a duplicate-create retry.
  try {
    await odometerRepository.createFromTrip({
      vehicleId: data.vehicleId,
      userId: user.id,
      odometer: data.endOdometer,
      recordedAt: data.tripDate,
    });
    await reminderTriggerService.recheckMileageReminders(user.id, data.vehicleId);
  } catch (error) {
    logger.error('Trip odometer sync or mileage reminder recheck failed (trip already persisted)', {
      tripId: trip.id,
      vehicleId: data.vehicleId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return c.json({ success: true, data: trip, message: 'Trip created' }, 201);
});

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

// Register before /:id, or the literal 'summary' segment is captured as a trip id.
routes.get('/summary', zValidator('query', summaryQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, rate } = c.req.valid('query');

  if (vehicleId) {
    await validateVehicleOwnership(vehicleId, user.id);
  }
  const trips = vehicleId
    ? await tripRepository.findByVehicle(vehicleId, user.id)
    : await tripRepository.findByUserId(user.id);

  let effectiveRate = rate;
  if (effectiveRate === undefined) {
    const prefs = await preferencesRepository.getOrCreate(user.id);
    effectiveRate = prefs.businessMileageRate ?? 0;
  }

  const summary = buildTripSummary(trips, effectiveRate);
  return c.json({ success: true, data: summary });
});

routes.get('/vehicle/:vehicleId', zValidator('param', commonSchemas.vehicleIdParam), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('param');

  await validateVehicleOwnership(vehicleId, user.id);

  const data = await tripRepository.findByVehicle(vehicleId, user.id);
  return c.json({ success: true, data });
});

routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const trip = await validateTripOwnership(id, user.id);
  return c.json({ success: true, data: trip });
});

// The schema refine sees both odometers only when the body sends both, so check the merged pair here.
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateTripSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    const existing = await validateTripOwnership(id, user.id);

    const start = data.startOdometer ?? existing.startOdometer;
    const end = data.endOdometer ?? existing.endOdometer;
    if (end < start) {
      throw new ValidationError('endOdometer must be greater than or equal to startOdometer');
    }

    const updated = await tripRepository.update(id, data);

    const endChanged = data.endOdometer !== undefined && data.endOdometer !== existing.endOdometer;
    const dateChanged =
      data.tripDate !== undefined && data.tripDate.getTime() !== existing.tripDate.getTime();
    if (endChanged || dateChanged) {
      try {
        const othersAtOld = await tripRepository.countOthersAtOdometerKey({
          excludeTripId: id,
          vehicleId: existing.vehicleId,
          userId: user.id,
          endOdometer: existing.endOdometer,
          tripDate: existing.tripDate,
        });
        if (othersAtOld === 0) {
          await odometerRepository.deleteLinkedTripEntry({
            vehicleId: existing.vehicleId,
            userId: user.id,
            odometer: existing.endOdometer,
            recordedAt: existing.tripDate,
          });
        }
        await odometerRepository.createFromTrip({
          vehicleId: existing.vehicleId,
          userId: user.id,
          odometer: end,
          recordedAt: data.tripDate ?? existing.tripDate,
        });
        await reminderTriggerService.recheckMileageReminders(user.id, existing.vehicleId);
      } catch (error) {
        logger.error('Trip-edit linked-odometer re-sync failed (trip already updated)', {
          tripId: id,
          vehicleId: existing.vehicleId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return c.json({ success: true, data: updated, message: 'Trip updated' });
  }
);

routes.delete(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('query', deleteQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { keepOdometer } = c.req.valid('query');

    const existing = await tripRepository.findByIdAndUserId(id, user.id);
    if (!existing) {
      throw new NotFoundError('Trip');
    }

    const deleted = await tripRepository.deleteByIdAndUserId(id, user.id);
    if (!deleted) {
      throw new NotFoundError('Trip');
    }

    if (keepOdometer === false) {
      try {
        const others = await tripRepository.countOthersAtOdometerKey({
          excludeTripId: id,
          vehicleId: existing.vehicleId,
          userId: user.id,
          endOdometer: existing.endOdometer,
          tripDate: existing.tripDate,
        });
        if (others === 0) {
          await odometerRepository.deleteLinkedTripEntry({
            vehicleId: existing.vehicleId,
            userId: user.id,
            odometer: existing.endOdometer,
            recordedAt: existing.tripDate,
          });
          await reminderTriggerService.recheckMileageReminders(user.id, existing.vehicleId);
        }
      } catch (error) {
        logger.error('Trip-delete linked-odometer cleanup failed (trip already deleted)', {
          tripId: id,
          vehicleId: existing.vehicleId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return c.json({ success: true, message: 'Trip deleted' });
  }
);

export { routes };
