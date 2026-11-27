import { Hono } from 'hono';
import { z } from 'zod';
import { appContext, repos } from '../../app-context';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, vehicleParam } from '../../permissions/authorize';
import { requestResolver } from '../../permissions/grants';
import { zValidator } from '../../utils/validation';
import { requireVehicleAccess, seesFinancials } from '../../utils/vehicle-access';
import {
  applyBackfill,
  type BackfillRequest,
  planBackfill,
  recentBackfills,
  summarize,
  undoBackfill,
} from './backfill';
import {
  addGuestDriver,
  DRIVER_COLORS,
  findDriver,
  listDrivers,
  ownDriverId,
  setCarShare,
  updateDriver,
} from './repository';
import {
  balancesView,
  computeBalances,
  readRules,
  rulesFor,
  rulesSchema,
  writeRules,
} from './split';
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

async function requireCarShare(vehicleId: string): Promise<void> {
  const vehicle = await repos().vehicles.findById(vehicleId);
  if (!vehicle?.carShareEnabled) throw new NotFoundError('Car sharing');
}

export const driverRoutes = new Hono();
driverRoutes.use('*', requireAuth);
driverRoutes.use('*', changeTracker);

driverRoutes.get(
  '/',
  zValidator('param', vehicleIdParam),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    await requireCarShare(vehicleId);
    return c.json({ success: true, data: await listDrivers(appContext().asyncDb, vehicleId) });
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
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');
    const { db, asyncDb } = appContext();
    const owner = await repos().vehicles.findById(vehicleId);
    if (!owner?.carShareEnabled) throw new NotFoundError('Car sharing');
    const to = query.to ? Date.parse(query.to) : Date.now();
    const from = query.from ? Date.parse(query.from) : to - 30 * DAY;
    const resolver = requestResolver(c, db);
    const vehicle = { kind: 'vehicle' as const, vehicleId };
    const scale = await repos().preferences.moneyScale(owner.userId);
    return c.json({
      success: true,
      data: await driverStats(asyncDb, vehicleId, {
        period: { from, to },
        withEstimates: query.estimates === 'true',
        viewerUserId: c.get('user').id,
        everyone: resolver.can('vehicle.driver_stats.read', vehicle).allow,
        includeCarCosts: resolver.can('vehicle.expense.read', vehicle).allow,
        scale,
      }),
    });
  }
);

driverRoutes.get(
  '/rules',
  zValidator('param', vehicleIdParam),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    await requireCarShare(vehicleId);
    const { db, asyncDb } = appContext();
    const everyone = requestResolver(c, db).can('vehicle.driver_stats.read', {
      kind: 'vehicle',
      vehicleId,
    }).allow;
    const own = await ownDriverId(asyncDb, vehicleId, c.get('user').id);
    const rules = await readRules(asyncDb, vehicleId);
    return c.json({ success: true, data: rulesFor(rules, everyone, own) });
  }
);

driverRoutes.put(
  '/rules',
  zValidator('param', vehicleIdParam),
  zValidator('json', rulesSchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    await requireCarShare(vehicleId);
    const { asyncDb } = appContext();
    const rules = c.req.valid('json');
    const active = new Set(
      (await listDrivers(asyncDb, vehicleId)).filter((d) => !d.archived).map((d) => d.id)
    );
    for (const rule of [rules.running, rules.ownership]) {
      if (rule.kind === 'fixed' && Object.keys(rule.shares).some((id) => !active.has(id))) {
        throw new ValidationError('Fixed shares can only name active drivers of this vehicle');
      }
    }
    await writeRules(asyncDb, vehicleId, rules);
    return c.json({ success: true, data: rules });
  }
);

driverRoutes.get(
  '/balances',
  zValidator('param', vehicleIdParam),
  zValidator('query', statsQuery),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');
    const { db, asyncDb } = appContext();
    await requireCarShare(vehicleId);
    const resolver = requestResolver(c, db);
    const vehicle = { kind: 'vehicle' as const, vehicleId };
    if (!resolver.can('vehicle.expense.read', vehicle).allow) {
      throw new ForbiddenError("You don't have permission to see this vehicle's costs");
    }
    const userId = c.get('user').id;
    const access = await requireVehicleAccess(vehicleId, userId, 'read');
    const to = query.to ? Date.parse(query.to) : Date.now();
    const from = query.from ? Date.parse(query.from) : to - 30 * DAY;
    const result = await computeBalances(asyncDb, vehicleId, {
      period: { from, to },
      hideFinancials: !seesFinancials(access),
    });
    return c.json({
      success: true,
      data: balancesView(result, {
        everyone: resolver.can('vehicle.driver_stats.read', vehicle).allow,
        ownDriver: await ownDriverId(asyncDb, vehicleId, userId),
        scale: await repos().preferences.moneyScale(access.ownerId),
      }),
    });
  }
);

driverRoutes.post(
  '/',
  zValidator('param', vehicleIdParam),
  zValidator('json', guestSchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    await requireCarShare(vehicleId);
    const { asyncDb } = appContext();
    const id = await addGuestDriver(asyncDb, vehicleId, c.req.valid('json'), c.get('user').id);
    const created = (await listDrivers(asyncDb, vehicleId)).find((d) => d.id === id);
    return c.json({ success: true, data: created }, 201);
  }
);

const backfillSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('logged') }),
  z
    .strictObject({
      mode: z.literal('range'),
      driverId: z.string().min(1).max(64),
      from: z.iso.datetime({ offset: true }),
      to: z.iso.datetime({ offset: true }),
    })
    .refine((q) => Date.parse(q.from) <= Date.parse(q.to), {
      message: 'The range must start before it ends',
      path: ['from'],
    }),
]);

async function backfillRequest(
  vehicleId: string,
  body: z.infer<typeof backfillSchema>
): Promise<BackfillRequest> {
  if (body.mode === 'logged') return body;
  const driver = await findDriver(appContext().asyncDb, vehicleId, body.driverId);
  if (!driver || driver.archivedAt !== null) {
    throw new ValidationError("That driver doesn't drive this vehicle");
  }
  return { ...body, from: Date.parse(body.from), to: Date.parse(body.to) };
}

async function hidesFinancials(vehicleId: string, userId: string): Promise<boolean> {
  return !seesFinancials(await requireVehicleAccess(vehicleId, userId, 'read'));
}

driverRoutes.get(
  '/backfill',
  zValidator('param', vehicleIdParam),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    await requireCarShare(vehicleId);
    return c.json({ success: true, data: await recentBackfills(appContext().asyncDb, vehicleId) });
  }
);

driverRoutes.post(
  '/backfill/preview',
  zValidator('param', vehicleIdParam),
  zValidator('json', backfillSchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    await requireCarShare(vehicleId);
    const { asyncDb } = appContext();
    const hide = await hidesFinancials(vehicleId, c.get('user').id);
    const request = await backfillRequest(vehicleId, c.req.valid('json'));
    const planned = await planBackfill(asyncDb, vehicleId, request, hide);
    return c.json({ success: true, data: await summarize(asyncDb, vehicleId, planned) });
  }
);

driverRoutes.post(
  '/backfill',
  zValidator('param', vehicleIdParam),
  zValidator('json', backfillSchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    await requireCarShare(vehicleId);
    const { db, asyncDb } = appContext();
    const body = c.req.valid('json');
    const userId = c.get('user').id;
    const hide = await hidesFinancials(vehicleId, userId);
    const request = await backfillRequest(vehicleId, body);
    const planned = await planBackfill(asyncDb, vehicleId, request, hide);
    const { batchId, entries } = applyBackfill(db, vehicleId, body.mode, planned, userId, hide);
    const data = { batchId, ...(await summarize(asyncDb, vehicleId, entries)) };
    return c.json({ success: true, data }, batchId ? 201 : 200);
  }
);

driverRoutes.post(
  '/backfill/:batchId/undo',
  zValidator('param', vehicleIdParam.extend({ batchId: z.string().min(1).max(64) })),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId, batchId } = c.req.valid('param');
    await requireCarShare(vehicleId);
    const hide = await hidesFinancials(vehicleId, c.get('user').id);
    const reverted = undoBackfill(appContext().db, vehicleId, batchId, hide);
    return c.json({ success: true, data: { reverted } });
  }
);

driverRoutes.patch(
  '/:driverId',
  zValidator('param', driverParam),
  zValidator('json', updateSchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId, driverId } = c.req.valid('param');
    await requireCarShare(vehicleId);
    const { asyncDb } = appContext();
    const driver = await findDriver(asyncDb, vehicleId, driverId);
    if (!driver) throw new NotFoundError('Driver');
    const { name: newName, color: newColor, archived } = c.req.valid('json');
    if (driver.userId && (newName !== undefined || archived !== undefined)) {
      throw new ValidationError(
        "A member's name and access follow their account and share, so only the colour can change"
      );
    }
    await updateDriver(asyncDb, driverId, {
      ...(newName !== undefined && { name: newName }),
      ...(newColor !== undefined && { color: newColor }),
      ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
    });
    const updated = (await listDrivers(asyncDb, vehicleId)).find((d) => d.id === driverId);
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
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    const { db, asyncDb } = appContext();
    setCarShare(db, vehicleId, enabled);
    return c.json({
      success: true,
      data: { enabled, drivers: enabled ? await listDrivers(asyncDb, vehicleId) : [] },
    });
  }
);
