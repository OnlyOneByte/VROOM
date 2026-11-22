import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { trips } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences } from '../../types';
import { logger } from '../../utils/logger';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import { buildTripSummary } from '../../utils/trip-summary';
import { convertDistance } from '../../utils/unit-conversions';
import {
  commonSchemas,
  validateTripOwnership,
  validateVehicleOwnership,
  zValidator,
} from '../../utils/validation';
import { assertOdometerInOrder } from '../expenses/repository';
import { odometerRepository, readingCheck } from '../odometer/repository';
import { deletePhotosForEntities } from '../photos/photo-service';
import { reminderTriggerService } from '../reminders/trigger-service';
import { preferencesRepository } from '../settings/repository';
import { tripRepository } from './repository';
import {
  createTripSchema,
  TRIP_PURPOSES,
  tripTimeZoneSchema,
  updateTripSchema,
} from './validation';

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
  timeZone: tripTimeZoneSchema,
});

const PHOTO_CLEANUP_ATTEMPTS = 3;

async function deleteEntryPhotosWithRetry(
  entryIds: string[],
  userId: string,
  context: { tripId: string; vehicleId: string }
): Promise<void> {
  for (let attempt = 1; attempt <= PHOTO_CLEANUP_ATTEMPTS; attempt++) {
    try {
      await deletePhotosForEntities('odometer_entry', entryIds, userId);
      return;
    } catch (error) {
      if (attempt === PHOTO_CLEANUP_ATTEMPTS) {
        logger.warn('Photos left on a deleted odometer entry: trip photo cleanup gave up', {
          ...context,
          odometerEntryIds: entryIds,
          attempts: attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      await Bun.sleep(50 * attempt);
    }
  }
}

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

  const check = await readingCheck(data.vehicleId, data.endOdometer, data.tripDate, data.timeZone);
  const trip = getDb().transaction((tx) => {
    assertOdometerInOrder(tx, check);
    const created = tx
      .insert(trips)
      .values({
        vehicleId: data.vehicleId,
        userId: user.id,
        startOdometer: data.startOdometer,
        endOdometer: data.endOdometer,
        purpose: data.purpose,
        tripDate: data.tripDate,
        startLocation: data.startLocation ?? null,
        endLocation: data.endLocation ?? null,
        note: data.note ?? null,
      })
      .returning()
      .get();
    odometerRepository.createFromTrip(
      {
        vehicleId: data.vehicleId,
        userId: user.id,
        odometer: data.endOdometer,
        recordedAt: data.tripDate,
        timeZone: data.timeZone,
      },
      tx
    );
    return created;
  });

  // Logged, not thrown: a 500 after the insert would invite a duplicate-create retry.
  try {
    await reminderTriggerService.recheckMileageReminders(user.id, data.vehicleId);
  } catch (error) {
    logger.error('Trip mileage reminder recheck failed (trip already persisted)', {
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

  if (query.vehicleId) {
    await validateVehicleOwnership(query.vehicleId, user.id);
  }
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

  const prefs = await preferencesRepository.getOrCreate(user.id);
  const userUnit = (parseUnitPreferences(prefs.unitPreferences) ?? DEFAULT_UNIT_PREFERENCES)
    .distanceUnit;
  const vehicleUnits = await tripRepository.findVehicleDistanceUnits(user.id);

  const summary = buildTripSummary(
    trips,
    rate ?? prefs.businessMileageRate ?? 0,
    (distance, tripVehicleId) =>
      convertDistance(distance, vehicleUnits.get(tripVehicleId) ?? userUnit, userUnit)
  );
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
    const { timeZone, ...data } = c.req.valid('json');

    const existing = await validateTripOwnership(id, user.id);

    const start = data.startOdometer ?? existing.startOdometer;
    const end = data.endOdometer ?? existing.endOdometer;
    if (end < start) {
      throw new ValidationError('endOdometer must be greater than or equal to startOdometer');
    }

    const endChanged = data.endOdometer !== undefined && data.endOdometer !== existing.endOdometer;
    const dateChanged =
      data.tripDate !== undefined && data.tripDate.getTime() !== existing.tripDate.getTime();
    const resync = endChanged || dateChanged;
    const tripDate = data.tripDate ?? existing.tripDate;
    const check = resync ? await readingCheck(existing.vehicleId, end, tripDate, timeZone) : null;
    const othersAtOld = resync
      ? await tripRepository.countOthersAtOdometerKey({
          excludeTripId: id,
          vehicleId: existing.vehicleId,
          userId: user.id,
          endOdometer: existing.endOdometer,
          tripDate: existing.tripDate,
          timeZone,
        })
      : 0;

    const { updated, removedEntryIds } = getDb().transaction((tx) => {
      const row = tx
        .update(trips)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(trips.id, id))
        .returning()
        .get();
      if (!row) throw new NotFoundError('Trip');
      if (!resync) return { updated: row, removedEntryIds: [] };
      const removed =
        othersAtOld === 0
          ? odometerRepository.deleteLinkedTripEntry(
              {
                vehicleId: existing.vehicleId,
                userId: user.id,
                odometer: existing.endOdometer,
                recordedAt: existing.tripDate,
                timeZone,
              },
              tx
            )
          : [];
      assertOdometerInOrder(tx, check);
      odometerRepository.createFromTrip(
        {
          vehicleId: existing.vehicleId,
          userId: user.id,
          odometer: end,
          recordedAt: tripDate,
          timeZone,
        },
        tx
      );
      return { updated: row, removedEntryIds: removed };
    });

    if (resync) {
      try {
        await deleteEntryPhotosWithRetry(removedEntryIds, user.id, {
          tripId: id,
          vehicleId: existing.vehicleId,
        });
        await reminderTriggerService.recheckMileageReminders(user.id, existing.vehicleId);
      } catch (error) {
        logger.error('Trip-edit mileage reminder recheck failed (trip already updated)', {
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
    const { keepOdometer, timeZone } = c.req.valid('query');

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
          timeZone,
        });
        if (others === 0) {
          const removedEntryIds = odometerRepository.deleteLinkedTripEntry({
            vehicleId: existing.vehicleId,
            userId: user.id,
            odometer: existing.endOdometer,
            recordedAt: existing.tripDate,
            timeZone,
          });
          await deleteEntryPhotosWithRetry(removedEntryIds, user.id, {
            tripId: id,
            vehicleId: existing.vehicleId,
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
