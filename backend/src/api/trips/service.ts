import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import { type Trip, trips } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../errors';
import { logger } from '../../utils/logger';
import { requireVehicleAccess } from '../../utils/vehicle-access';
import { assertOdometerInOrder } from '../expenses/repository';
import { odometerRepository, readingCheck } from '../odometer/repository';
import { deletePhotosForEntities } from '../photos/photo-service';
import { reminderTriggerService } from '../reminders/trigger-service';
import { tripRepository } from './repository';
import type { createTripSchema, updateTripSchema } from './validation';

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = Omit<z.infer<typeof updateTripSchema>, 'timeZone'>;

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

// Logged, not thrown: a 500 after the write would invite a duplicate retry.
async function afterOdometerChange(
  userId: string,
  trip: { tripId: string; vehicleId: string },
  removedEntryIds: string[],
  action: 'create' | 'edit' | 'delete'
): Promise<void> {
  try {
    if (removedEntryIds.length > 0) {
      await deleteEntryPhotosWithRetry(removedEntryIds, userId, trip);
    }
    await reminderTriggerService.recheckMileageReminders(userId, trip.vehicleId);
  } catch (error) {
    logger.error(`Trip ${action}: mileage reminder recheck failed after the change was committed`, {
      ...trip,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createTrip(
  userId: string,
  data: CreateTripInput,
  createdBy: string | null = null,
  db: AppDatabase = getDb()
): Promise<Trip> {
  await requireVehicleAccess(data.vehicleId, userId, 'owner');
  const check = await readingCheck(data.vehicleId, data.endOdometer, data.tripDate, data.timeZone);
  const trip = db.transaction((tx) => {
    assertOdometerInOrder(tx, check);
    const created = tx
      .insert(trips)
      .values({
        vehicleId: data.vehicleId,
        userId,
        startOdometer: data.startOdometer,
        endOdometer: data.endOdometer,
        purpose: data.purpose,
        tripDate: data.tripDate,
        startLocation: data.startLocation ?? null,
        endLocation: data.endLocation ?? null,
        note: data.note ?? null,
        createdBy,
      })
      .returning()
      .get();
    odometerRepository.createFromTrip(
      {
        tripId: created.id,
        vehicleId: data.vehicleId,
        userId,
        odometer: data.endOdometer,
        recordedAt: data.tripDate,
        timeZone: data.timeZone,
        createdBy,
      },
      tx
    );
    return created;
  });

  await afterOdometerChange(userId, { tripId: trip.id, vehicleId: trip.vehicleId }, [], 'create');
  return trip;
}

export async function updateTrip(
  userId: string,
  existing: Trip,
  data: UpdateTripInput,
  timeZone: string | undefined,
  db: AppDatabase = getDb()
): Promise<Trip> {
  // The schema refine sees both odometers only when the body sends both, so check the merged pair here.
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
  const { id, vehicleId } = existing;
  const check = resync ? await readingCheck(vehicleId, end, tripDate, timeZone) : null;
  const { updated, removedEntryIds } = db.transaction((tx) => {
    const row = tx
      .update(trips)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(trips.id, id), eq(trips.userId, userId)))
      .returning()
      .get();
    if (!row) throw new NotFoundError('Trip');
    if (!resync) return { updated: row, removedEntryIds: [] };
    const otherAtOld = tripRepository.findOtherAtOdometerKey(
      {
        excludeTripId: id,
        vehicleId,
        userId,
        endOdometer: existing.endOdometer,
        tripDate: existing.tripDate,
        timeZone,
      },
      tx
    );
    const oldKey = {
      tripId: id,
      vehicleId,
      userId,
      odometer: existing.endOdometer,
      recordedAt: existing.tripDate,
      timeZone,
    };
    const movedId = otherAtOld
      ? null
      : odometerRepository.moveLinkedTripEntry(oldKey, { odometer: end, recordedAt: tripDate }, tx);
    if (movedId) {
      assertOdometerInOrder(tx, check && { ...check, excludeId: movedId });
      return { updated: row, removedEntryIds: [] };
    }
    let removed: string[] = [];
    if (otherAtOld) odometerRepository.handOverLinkedTripEntry(oldKey, otherAtOld, tx);
    else removed = odometerRepository.deleteLinkedTripEntry(oldKey, tx);
    assertOdometerInOrder(tx, check);
    odometerRepository.createFromTrip(
      {
        tripId: id,
        vehicleId,
        userId,
        odometer: end,
        recordedAt: tripDate,
        timeZone,
        createdBy: existing.createdBy,
      },
      tx
    );
    return { updated: row, removedEntryIds: removed };
  });

  if (resync) await afterOdometerChange(userId, { tripId: id, vehicleId }, removedEntryIds, 'edit');
  return updated;
}

export async function deleteTrip(
  userId: string,
  existing: Trip,
  options: { keepOdometer: boolean; timeZone: string | undefined },
  db: AppDatabase = getDb()
): Promise<void> {
  const { id, vehicleId } = existing;
  const key = {
    tripId: id,
    vehicleId,
    userId,
    odometer: existing.endOdometer,
    recordedAt: existing.tripDate,
    timeZone: options.timeZone,
  };

  const { removedEntryIds, handedOver } = db.transaction((tx) => {
    const row = tx
      .delete(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, userId)))
      .returning({ id: trips.id })
      .get();
    if (!row) throw new NotFoundError('Trip');
    const other = tripRepository.findOtherAtOdometerKey(
      {
        excludeTripId: id,
        vehicleId,
        userId,
        endOdometer: existing.endOdometer,
        tripDate: existing.tripDate,
        timeZone: options.timeZone,
      },
      tx
    );
    if (other) {
      odometerRepository.handOverLinkedTripEntry(key, other, tx);
      return { removedEntryIds: [], handedOver: true };
    }
    return {
      removedEntryIds: options.keepOdometer
        ? []
        : odometerRepository.deleteLinkedTripEntry(key, tx),
      handedOver: false,
    };
  });

  if (!handedOver && !options.keepOdometer) {
    await afterOdometerChange(userId, { tripId: id, vehicleId }, removedEntryIds, 'delete');
  }
}
