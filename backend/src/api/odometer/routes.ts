import { Hono } from 'hono';
import { z } from 'zod';
import { repos } from '../../app-context';
import type { AsyncHandle } from '../../db/async-sqlite';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import {
  authorize,
  type ResourceOf,
  vehicleEntry,
  vehicleParam,
} from '../../permissions/authorize';
import { requestResolver } from '../../permissions/grants';
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
import { attributedDriver, memberView } from '../drivers/attribution';
import { assertOdometerInOrder } from '../expenses/repository';
import type { OdometerCheck } from '../expenses/validation';
import { deleteWithPhotos } from '../photos/photo-service';
import { reminderTriggerService } from '../reminders/trigger-service';
import { readingCheck } from './repository';

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

const createBodySchema = odometerCreateSchema.extend({
  timeZone: timeZoneSchema,
  driverId: z.string().min(1).max(64).nullish(),
});

const updateSchema = createBodySchema.partial();

function inOrder(check: OdometerCheck | null) {
  return (tx: AsyncHandle) => assertOdometerInOrder(tx, check);
}

const fromEntry: ResourceOf = async (c) => {
  const entry = await repos().odometer.findById(c.req.param('id') ?? '');
  if (!entry) throw new NotFoundError('Odometer entry');
  return vehicleEntry(entry.vehicleId, entry.userId, entry.createdBy);
};

const listQuerySchema = z.object({
  ...commonSchemas.clampedPaginationFields,
});

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.get(
  '/:vehicleId',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('query', listQuerySchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');

    const { ownerId } = await requireVehicleAccess(vehicleId, user.id, 'read');

    const { limit, offset } = clampPagination(query);

    const { data, totalCount } = await repos().odometer.findByVehicleIdPaginated(
      vehicleId,
      ownerId,
      limit,
      offset
    );

    const rows = data.map((entry) => memberView(c, vehicleId, entry));
    return c.json(buildPaginatedResponse(rows, totalCount, limit, offset));
  }
);

routes.get(
  '/:vehicleId/history',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('query', listQuerySchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');

    const access = await requireVehicleAccess(vehicleId, user.id, 'read');

    const { limit, offset } = clampPagination(query);

    const { data, totalCount } = await repos().odometer.getHistory(vehicleId, access.ownerId, {
      limit,
      offset,
      hideFinancials: !seesFinancials(access),
      includeExpenses: requestResolver(c).can('vehicle.expense.read', {
        kind: 'vehicle',
        vehicleId,
      }).allow,
    });

    const rows = data.map((row) => memberView(c, vehicleId, row));
    return c.json(buildPaginatedResponse(rows, totalCount, limit, offset));
  }
);

routes.get(
  '/entry/:id',
  zValidator('param', commonSchemas.idParam),
  authorize(fromEntry),
  async (c) => {
    const { id } = c.req.valid('param');

    const entry = await repos().odometer.findById(id);
    if (!entry) throw new NotFoundError('Odometer entry');

    return c.json({ success: true, data: memberView(c, entry.vehicleId, entry) });
  }
);

routes.post(
  '/:vehicleId',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('json', createBodySchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const data = c.req.valid('json');

    const { ownerId } = await requireVehicleAccess(vehicleId, user.id, 'read');
    const driverId = await attributedDriver(c, vehicleId, data.driverId);

    const entry = await repos().odometer.createChecked(
      {
        vehicleId,
        userId: ownerId,
        odometer: data.odometer,
        recordedAt: data.recordedAt,
        note: data.note ?? null,
        driverId,
        createdBy: ownerId === user.id ? null : user.id,
      },
      inOrder(await readingCheck(vehicleId, data.odometer, data.recordedAt, data.timeZone))
    );

    await reminderTriggerService.recheckMileageReminders(ownerId, vehicleId);

    return c.json(
      {
        success: true,
        data: memberView(c, vehicleId, entry),
        message: 'Odometer reading created',
      },
      201
    );
  }
);

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateSchema),
  authorize(fromEntry),
  async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    const existing = await repos().odometer.findById(id);
    if (!existing) throw new NotFoundError('Odometer entry');

    const { timeZone, driverId: requested, ...rest } = data;
    const driverId = await attributedDriver(c, existing.vehicleId, requested, existing.driverId);
    const changes = driverId === undefined ? rest : { ...rest, driverId };
    const odometer = changes.odometer ?? existing.odometer;
    const recordedAt = changes.recordedAt ?? existing.recordedAt;
    const dayOf = (at: Date) => zonedDayWindow(at, timeZone ?? 'UTC').dayStart.getTime();
    const moved =
      odometer !== existing.odometer || dayOf(recordedAt) !== dayOf(existing.recordedAt);
    const updated = await repos().odometer.updateChecked(
      id,
      changes,
      inOrder(
        moved ? await readingCheck(existing.vehicleId, odometer, recordedAt, timeZone, id) : null
      )
    );

    await reminderTriggerService.recheckMileageReminders(existing.userId, updated.vehicleId);

    return c.json({
      success: true,
      data: memberView(c, updated.vehicleId, updated),
      message: 'Odometer reading updated',
    });
  }
);

routes.delete(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  authorize(fromEntry),
  async (c) => {
    const { id } = c.req.valid('param');

    const existing = await repos().odometer.findById(id);
    if (!existing) throw new NotFoundError('Odometer entry');

    await deleteWithPhotos(
      existing.userId,
      async () => [{ entityType: 'odometer_entry', entityIds: [id] }],
      () => repos().odometer.delete(id)
    );

    return c.json({ success: true, message: 'Odometer reading deleted' });
  }
);

export { routes };
