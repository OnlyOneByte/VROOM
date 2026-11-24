import { Hono } from 'hono';
import { z } from 'zod';
import type { DrizzleTransaction } from '../../db/types';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import { isValidTimeZone, zonedDayWindow } from '../../utils/time-zone';
import {
  commonSchemas,
  dateInput,
  MAX_ODOMETER_READING,
  noonAnchoredDateIsNotInTheFuture,
  ODOMETER_TOO_HIGH_MESSAGE,
  WHOLE_DISTANCE_MESSAGE,
  zValidator,
} from '../../utils/validation';
import { requireVehicleAccess, seesFinancials } from '../../utils/vehicle-access';
import { assertOdometerInOrder } from '../expenses/repository';
import type { OdometerCheck } from '../expenses/validation';
import { deleteAllPhotosForEntity } from '../photos/photo-service';
import { reminderTriggerService } from '../reminders/trigger-service';
import { odometerRepository, readingCheck } from './repository';

const routes = new Hono();

export const odometerCreateSchema = z.object({
  odometer: z
    .number()
    .int(WHOLE_DISTANCE_MESSAGE)
    .min(0, 'Odometer cannot be negative')
    .max(MAX_ODOMETER_READING, ODOMETER_TOO_HIGH_MESSAGE),
  recordedAt: dateInput.refine(noonAnchoredDateIsNotInTheFuture, {
    message: 'Date cannot be in the future',
  }),
  note: z.string().max(500).optional(),
});

const timeZoneSchema = z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional();

const createBodySchema = odometerCreateSchema.extend({ timeZone: timeZoneSchema });

const updateSchema = createBodySchema.partial();

function inOrder(check: OdometerCheck | null) {
  return (tx: DrizzleTransaction) => assertOdometerInOrder(tx, check);
}

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

    const { ownerId } = await requireVehicleAccess(vehicleId, user.id, 'read');

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

    const access = await requireVehicleAccess(vehicleId, user.id, 'read');

    const { limit, offset } = clampPagination(query);

    const { data, totalCount } = await odometerRepository.getHistory(vehicleId, access.ownerId, {
      limit,
      offset,
      hideFinancials: !seesFinancials(access),
    });

    return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
  }
);

routes.get('/entry/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const entry = await odometerRepository.findById(id);
  if (!entry) throw new NotFoundError('Odometer entry');
  await requireVehicleAccess(entry.vehicleId, user.id, 'read');

  return c.json({ success: true, data: entry });
});

routes.post(
  '/:vehicleId',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('json', createBodySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const data = c.req.valid('json');

    const { ownerId } = await requireVehicleAccess(vehicleId, user.id, 'write');

    const entry = await odometerRepository.createChecked(
      {
        vehicleId,
        userId: ownerId,
        odometer: data.odometer,
        recordedAt: data.recordedAt,
        note: data.note ?? null,
      },
      inOrder(await readingCheck(vehicleId, data.odometer, data.recordedAt, data.timeZone))
    );

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
    await requireVehicleAccess(existing.vehicleId, user.id, 'write');

    const { timeZone, ...changes } = data;
    const odometer = changes.odometer ?? existing.odometer;
    const recordedAt = changes.recordedAt ?? existing.recordedAt;
    const dayOf = (at: Date) => zonedDayWindow(at, timeZone ?? 'UTC').dayStart.getTime();
    const moved =
      odometer !== existing.odometer || dayOf(recordedAt) !== dayOf(existing.recordedAt);
    const updated = await odometerRepository.updateChecked(
      id,
      changes,
      inOrder(
        moved ? await readingCheck(existing.vehicleId, odometer, recordedAt, timeZone, id) : null
      )
    );

    await reminderTriggerService.recheckMileageReminders(existing.userId, updated.vehicleId);

    return c.json({ success: true, data: updated, message: 'Odometer reading updated' });
  }
);

routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const existing = await odometerRepository.findById(id);
  if (!existing) throw new NotFoundError('Odometer entry');
  await requireVehicleAccess(existing.vehicleId, user.id, 'write');

  await deleteAllPhotosForEntity('odometer_entry', id, existing.userId);
  await odometerRepository.delete(id);

  return c.json({ success: true, message: 'Odometer reading deleted' });
});

export { routes };
