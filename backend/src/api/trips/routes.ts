import { Hono } from 'hono';
import { z } from 'zod';
import { changeTracker, requireAuth } from '../../middleware';
import { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences } from '../../types';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import { buildTripSummary } from '../../utils/trip-summary';
import { convertDistance } from '../../utils/unit-conversions';
import { commonSchemas, validateTripOwnership, zValidator } from '../../utils/validation';
import { requireVehicleAccess } from '../../utils/vehicle-access';
import { preferencesRepository } from '../settings/repository';
import { tripRepository } from './repository';
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

routes.post('/', zValidator('json', createTripSchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  const trip = await createTrip(user.id, data);

  return c.json({ success: true, data: trip, message: 'Trip created' }, 201);
});

routes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const user = c.get('user');
  const query = c.req.valid('query');
  const { limit, offset } = clampPagination(query);

  if (query.vehicleId) {
    await requireVehicleAccess(query.vehicleId, user.id, 'owner');
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
    await requireVehicleAccess(vehicleId, user.id, 'owner');
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

  await requireVehicleAccess(vehicleId, user.id, 'owner');

  const data = await tripRepository.findByVehicle(vehicleId, user.id);
  return c.json({ success: true, data });
});

routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const trip = await validateTripOwnership(id, user.id);
  return c.json({ success: true, data: trip });
});

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateTripSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { timeZone, ...data } = c.req.valid('json');

    const existing = await validateTripOwnership(id, user.id);

    const updated = await updateTrip(user.id, existing, data, timeZone);
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

    const existing = await validateTripOwnership(id, user.id);

    await deleteTrip(user.id, existing, { keepOdometer, timeZone });
    return c.json({ success: true, message: 'Trip deleted' });
  }
);

export { routes };
