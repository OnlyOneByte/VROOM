import { Hono } from 'hono';
import { z } from 'zod';
import { repos } from '../../app-context';
import type { Trip } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import {
  authorize,
  type ResourceOf,
  vehicleEntry,
  vehicleOrOwnAccount,
} from '../../permissions/authorize';
import { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences } from '../../types';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import { readJsonBody } from '../../utils/request-body';
import { buildTripSummary } from '../../utils/trip-summary';
import { convertDistance } from '../../utils/unit-conversions';
import { commonSchemas, zValidator } from '../../utils/validation';
import { readableVehicles, requireVehicleAccess } from '../../utils/vehicle-access';
import { attributedDriver, memberView } from '../drivers/attribution';
import { createTrip, deleteTrip, updateTrip } from './service';
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

const summaryQuerySchema = z.object({
  vehicleId: z.string().min(1).optional(),
  rate: z.coerce.number().min(0).optional(),
});

routes.use('*', requireAuth);
routes.use('*', changeTracker);

const fromBodyVehicle: ResourceOf = async (c) => ({
  kind: 'vehicle',
  vehicleId: (await readJsonBody<{ vehicleId: string }>(c)).vehicleId,
});

const fromQueryVehicle: ResourceOf = (c) => vehicleOrOwnAccount(c.req.query('vehicleId'), c);

const fromTrip: ResourceOf = async (c) => {
  const trip = await repos().trips.findById(c.req.param('id') ?? '');
  if (!trip) throw new NotFoundError('Trip');
  return vehicleEntry(trip.vehicleId, trip.userId, trip.createdBy);
};

async function tripReadableVehicles(userId: string) {
  return (await readableVehicles(userId)).filter((v) => v.seesTrips);
}

function withoutDriver(trip: Trip): Trip {
  const { driverId: _driverId, ...rest } = trip;
  return rest as Trip;
}

async function ownerOf(vehicleId: string | undefined, userId: string): Promise<string> {
  return vehicleId ? (await requireVehicleAccess(vehicleId, userId, 'read')).ownerId : userId;
}

async function tripOf(id: string): Promise<Trip> {
  const trip = await repos().trips.findById(id);
  if (!trip) throw new NotFoundError('Trip');
  return trip;
}

routes.post('/', zValidator('json', createTripSchema), authorize(fromBodyVehicle), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  const ownerId = await ownerOf(data.vehicleId, user.id);
  const driverId = await attributedDriver(c, data.vehicleId, data.driverId);
  const trip = await createTrip(
    ownerId,
    { ...data, driverId },
    ownerId === user.id ? null : user.id
  );

  return c.json(
    { success: true, data: memberView(c, trip.vehicleId, trip), message: 'Trip created' },
    201
  );
});

routes.get('/', zValidator('query', listQuerySchema), authorize(fromQueryVehicle), async (c) => {
  const user = c.get('user');
  const query = c.req.valid('query');
  const { limit, offset } = clampPagination(query);

  if (!query.vehicleId) {
    const readable = await tripReadableVehicles(user.id);
    const { data, totalCount } = await repos().trips.findReadablePaginated(
      readable,
      limit,
      offset,
      query.purpose
    );
    const seesDrivers = new Set(readable.filter((v) => v.seesDrivers).map((v) => v.vehicleId));
    const rows = data.map((trip) => (seesDrivers.has(trip.vehicleId) ? trip : withoutDriver(trip)));
    return c.json(buildPaginatedResponse(rows, totalCount, limit, offset));
  }

  const ownerId = await ownerOf(query.vehicleId, user.id);
  const { data, totalCount } = await repos().trips.findByUserIdPaginated(ownerId, limit, offset, {
    vehicleId: query.vehicleId,
    purpose: query.purpose,
  });
  const rows = data.map((trip) => memberView(c, trip.vehicleId, trip));
  return c.json(buildPaginatedResponse(rows, totalCount, limit, offset));
});

routes.get(
  '/summary',
  zValidator('query', summaryQuerySchema),
  authorize(fromQueryVehicle),
  async (c) => {
    const user = c.get('user');
    const { vehicleId, rate } = c.req.valid('query');

    const ownerId = await ownerOf(vehicleId, user.id);
    const readable = vehicleId ? null : await tripReadableVehicles(user.id);
    const trips = readable
      ? await repos().trips.findReadable(readable)
      : await repos().trips.findByVehicle(vehicleId ?? '', ownerId);

    const prefs = await repos().preferences.getOrCreate(user.id);
    const userUnit = (parseUnitPreferences(prefs.unitPreferences) ?? DEFAULT_UNIT_PREFERENCES)
      .distanceUnit;
    const vehicleUnits = await repos().trips.findVehicleDistanceUnits(
      ownerId,
      readable ? readable.map((v) => v.vehicleId) : undefined
    );

    const summary = buildTripSummary(
      trips,
      rate ?? prefs.businessMileageRate ?? 0,
      (distance, tripVehicleId) =>
        convertDistance(distance, vehicleUnits.get(tripVehicleId) ?? userUnit, userUnit)
    );
    return c.json({ success: true, data: summary });
  }
);

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateTripSchema),
  authorize(fromTrip),
  async (c) => {
    const { id } = c.req.valid('param');
    const { timeZone, ...data } = c.req.valid('json');

    const existing = await tripOf(id);
    const { driverId: requested, ...changes } = data;
    const driverId = await attributedDriver(c, existing.vehicleId, requested, existing.driverId);

    const updated = await updateTrip(
      existing.userId,
      existing,
      driverId === undefined ? changes : { ...changes, driverId },
      timeZone
    );
    return c.json({
      success: true,
      data: memberView(c, updated.vehicleId, updated),
      message: 'Trip updated',
    });
  }
);

routes.delete(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('query', deleteQuerySchema),
  authorize(fromTrip),
  async (c) => {
    const { id } = c.req.valid('param');
    const { keepOdometer, timeZone } = c.req.valid('query');

    const existing = await tripOf(id);

    await deleteTrip(existing.userId, existing, { keepOdometer, timeZone });
    return c.json({ success: true, message: 'Trip deleted' });
  }
);

export { routes };
