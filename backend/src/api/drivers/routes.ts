import { Hono } from 'hono';
import { z } from 'zod';
import { appContext } from '../../app-context';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, vehicleParam } from '../../permissions/authorize';
import { requestResolver } from '../../permissions/grants';
import { zValidator } from '../../utils/validation';
import {
  addGuestDriver,
  carShareEnabled,
  DRIVER_COLORS,
  findDriver,
  listDrivers,
  setCarShare,
  updateDriver,
} from './repository';
import { driverStats } from './stats';

const vehicleIdParam = z.object({ vehicleId: z.string().min(1).max(64) });
const driverParam = vehicleIdParam.extend({ driverId: z.string().min(1).max(64) });
const name = z.string().trim().min(1, 'A driver needs a name').max(50);
const color = z.enum(DRIVER_COLORS);

const guestSchema = z.strictObject({ name, color: color.optional() });
const updateSchema = z.strictObject({
  name: name.optional(),
  color: color.optional(),
  archived: z.boolean().optional(),
});

function requireCarShare(vehicleId: string): void {
  if (!carShareEnabled(appContext().db, vehicleId)) throw new NotFoundError('Car sharing');
}

export const driverRoutes = new Hono();
driverRoutes.use('*', requireAuth);
driverRoutes.use('*', changeTracker);

driverRoutes.get(
  '/',
  zValidator('param', vehicleIdParam),
  authorize(vehicleParam('vehicleId')),
  (c) => {
    const { vehicleId } = c.req.valid('param');
    requireCarShare(vehicleId);
    return c.json({ success: true, data: listDrivers(appContext().db, vehicleId) });
  }
);

const DAY = 24 * 60 * 60 * 1000;
const statsQuery = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    estimates: z.enum(['true', 'false']).default('true'),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), {
    message: 'The period must start before it ends',
    path: ['from'],
  });

driverRoutes.get(
  '/stats',
  zValidator('param', vehicleIdParam),
  zValidator('query', statsQuery),
  authorize(vehicleParam('vehicleId')),
  (c) => {
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');
    const { db } = appContext();
    if (!carShareEnabled(db, vehicleId)) throw new NotFoundError('Car sharing');
    const to = query.to ? Date.parse(query.to) : Date.now();
    const from = query.from ? Date.parse(query.from) : to - 30 * DAY;
    const resolver = requestResolver(c, db);
    const vehicle = { kind: 'vehicle' as const, vehicleId };
    return c.json({
      success: true,
      data: driverStats(db, vehicleId, {
        period: { from, to },
        withEstimates: query.estimates === 'true',
        viewerUserId: c.get('user').id,
        everyone: resolver.can('vehicle.driver_stats.read', vehicle).allow,
        includeCarCosts: resolver.can('vehicle.expense.read', vehicle).allow,
      }),
    });
  }
);

driverRoutes.post(
  '/',
  zValidator('param', vehicleIdParam),
  zValidator('json', guestSchema),
  authorize(vehicleParam('vehicleId')),
  (c) => {
    const { vehicleId } = c.req.valid('param');
    requireCarShare(vehicleId);
    const id = addGuestDriver(appContext().db, vehicleId, c.req.valid('json'), c.get('user').id);
    const created = listDrivers(appContext().db, vehicleId).find((d) => d.id === id);
    return c.json({ success: true, data: created }, 201);
  }
);

driverRoutes.patch(
  '/:driverId',
  zValidator('param', driverParam),
  zValidator('json', updateSchema),
  authorize(vehicleParam('vehicleId')),
  (c) => {
    const { vehicleId, driverId } = c.req.valid('param');
    requireCarShare(vehicleId);
    const driver = findDriver(appContext().db, vehicleId, driverId);
    if (!driver) throw new NotFoundError('Driver');
    const { name: newName, color: newColor, archived } = c.req.valid('json');
    if (driver.userId && (newName !== undefined || archived !== undefined)) {
      throw new ValidationError(
        "A member's name and access follow their account and share, so only the colour can change"
      );
    }
    updateDriver(appContext().db, driverId, {
      ...(newName !== undefined && { name: newName }),
      ...(newColor !== undefined && { color: newColor }),
      ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
    });
    const updated = listDrivers(appContext().db, vehicleId).find((d) => d.id === driverId);
    return c.json({ success: true, data: updated });
  }
);

export const carShareRoutes = new Hono();
carShareRoutes.use('*', requireAuth);
carShareRoutes.use('*', changeTracker);

carShareRoutes.put(
  '/',
  zValidator('param', vehicleIdParam),
  zValidator('json', z.strictObject({ enabled: z.boolean() })),
  authorize(vehicleParam('vehicleId')),
  (c) => {
    const { vehicleId } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    setCarShare(appContext().db, vehicleId, enabled);
    return c.json({
      success: true,
      data: { enabled, drivers: enabled ? listDrivers(appContext().db, vehicleId) : [] },
    });
  }
);
