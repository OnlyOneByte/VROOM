import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import { requireAuth } from '../../middleware';
import { requireVehicleRead, resolveVehicleOwnerId } from '../../utils/sharing';
import {
  analyticsSummaryToApi,
  crossVehicleToApi,
  financingToApi,
  fuelAdvancedToApi,
  fuelStatsToApi,
  insuranceToApi,
  quickStatsToApi,
  vehicleExpensesToApi,
  vehicleTcoToApi,
  yearEndToApi,
} from './api-transform';
import { analyticsRepository } from './repository';

const routes = new Hono();

const fuelEfficiencyQuerySchema = z.object({
  vehicleId: z.string().optional(),
});

export const yearQuerySchema = z.object({
  year: z.coerce.number().int().positive().optional(),
});

export const vehicleIdQuerySchema = z.object({
  vehicleId: z.string(),
});

const dateRangeQuerySchema = z.object({
  startDate: z.coerce.number().int().positive(),
  endDate: z.coerce.number().int().positive(),
});

const dateRangeVehicleQuerySchema = z.object({
  startDate: z.coerce.number().int().positive(),
  endDate: z.coerce.number().int().positive(),
  vehicleId: z.string().optional(),
});

const dateRangeRequiredVehicleQuerySchema = z.object({
  startDate: z.coerce.number().int().positive(),
  endDate: z.coerce.number().int().positive(),
  vehicleId: z.string(),
});

export const yearVehicleQuerySchema = z.object({
  year: z.coerce.number().int().positive().optional(),
  vehicleId: z.string(),
});

// Apply auth middleware to all analytics routes
routes.use('*', requireAuth);

/**
 * vehicle-sharing T8a: resolve the userId an analytics query for `vehicleId` must scope by. Gates via
 * requireVehicleRead (owner | accepted viewer/editor | 404 — existence-hiding for a stranger), then
 * returns the vehicle OWNER's id: per-vehicle analytics scope expenses by (vehicleId, userId), and a
 * shared vehicle's rows are OWNER-stamped (T5b-2), so an invitee querying their own id would see an
 * empty chart. The vehicleId+ownerId pin means only THAT vehicle's rows surface (no leak of the owner's
 * other vehicles). For an owner this resolves to themselves (unchanged). The cross-fleet analytics
 * (summary/quick-stats/cross-vehicle/financing/insurance/year-end — no vehicleId) stay acting-user-scoped.
 */
async function resolveVehicleScope(vehicleId: string, actingUserId: string): Promise<string> {
  await requireVehicleRead(vehicleId, actingUserId);
  const ownerId = await resolveVehicleOwnerId(vehicleId);
  if (!ownerId) throw new NotFoundError('Vehicle');
  return ownerId;
}

// GET /api/v1/analytics/summary
routes.get('/summary', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate } = c.req.valid('query');
  const data = await analyticsRepository.getSummary(user.id, { start: startDate, end: endDate });
  return c.json({ success: true, data: analyticsSummaryToApi(data) });
});

// GET /api/v1/analytics/quick-stats
routes.get('/quick-stats', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate } = c.req.valid('query');
  const data = await analyticsRepository.getQuickStats(user.id, { start: startDate, end: endDate });
  return c.json({ success: true, data: quickStatsToApi(data) });
});

// GET /api/v1/analytics/fuel-stats
routes.get('/fuel-stats', zValidator('query', dateRangeVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, vehicleId } = c.req.valid('query');

  // T8a: a per-vehicle fuel-stats query widens to shared READ, scoped to the vehicle OWNER's books;
  // the cross-fleet form (no vehicleId) stays acting-user-scoped.
  const scopeId = vehicleId ? await resolveVehicleScope(vehicleId, user.id) : user.id;

  const data = await analyticsRepository.getFuelStats(
    scopeId,
    { start: startDate, end: endDate },
    vehicleId
  );
  return c.json({ success: true, data: fuelStatsToApi(data) });
});

// GET /api/v1/analytics/cross-vehicle
routes.get('/cross-vehicle', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate } = c.req.valid('query');
  const data = await analyticsRepository.getCrossVehicle(user.id, {
    start: startDate,
    end: endDate,
  });
  return c.json({ success: true, data: crossVehicleToApi(data) });
});

// GET /api/v1/analytics/financing
routes.get('/financing', async (c) => {
  const user = c.get('user');
  const data = await analyticsRepository.getFinancing(user.id);
  return c.json({ success: true, data: financingToApi(data) });
});

// GET /api/v1/analytics/insurance
routes.get('/insurance', async (c) => {
  const user = c.get('user');
  const data = await analyticsRepository.getInsurance(user.id);
  return c.json({ success: true, data: insuranceToApi(data) });
});

// GET /api/v1/analytics/fuel-advanced
routes.get('/fuel-advanced', zValidator('query', dateRangeVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, vehicleId } = c.req.valid('query');

  // T8a: per-vehicle → shared READ scoped to the OWNER; cross-fleet (no vehicleId) → acting-user.
  const scopeId = vehicleId ? await resolveVehicleScope(vehicleId, user.id) : user.id;

  const data = await analyticsRepository.getFuelAdvanced(
    scopeId,
    { start: startDate, end: endDate },
    vehicleId
  );
  return c.json({ success: true, data: fuelAdvancedToApi(data) });
});

// GET /api/v1/analytics/vehicle-health
routes.get('/vehicle-health', zValidator('query', vehicleIdQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('query');
  // T8a: vehicle-health widens to shared READ, scoped to the vehicle OWNER's books.
  const scopeId = await resolveVehicleScope(vehicleId, user.id);
  const data = await analyticsRepository.getVehicleHealth(scopeId, vehicleId);
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/vehicle-tco
routes.get('/vehicle-tco', zValidator('query', yearVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, year } = c.req.valid('query');
  // T8a: vehicle-TCO widens to shared READ, scoped to the vehicle OWNER's books.
  const scopeId = await resolveVehicleScope(vehicleId, user.id);
  const data = await analyticsRepository.getVehicleTCO(scopeId, vehicleId, year);
  return c.json({ success: true, data: vehicleTcoToApi(data) });
});

// GET /api/v1/analytics/vehicle-expenses
routes.get(
  '/vehicle-expenses',
  zValidator('query', dateRangeRequiredVehicleQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId, startDate, endDate } = c.req.valid('query');
    // T8a: vehicle-expenses widens to shared READ, scoped to the vehicle OWNER's books.
    const scopeId = await resolveVehicleScope(vehicleId, user.id);
    const data = await analyticsRepository.getVehicleExpenses(scopeId, vehicleId, {
      start: startDate,
      end: endDate,
    });
    return c.json({ success: true, data: vehicleExpensesToApi(data) });
  }
);

// GET /api/v1/analytics/year-end
routes.get('/year-end', zValidator('query', yearQuerySchema), async (c) => {
  const user = c.get('user');
  const { year } = c.req.valid('query');
  const currentYear = year ?? new Date().getFullYear();
  const data = await analyticsRepository.getYearEnd(user.id, currentYear);
  return c.json({ success: true, data: yearEndToApi(data) });
});

// GET /api/v1/analytics/fuel-efficiency
routes.get('/fuel-efficiency', zValidator('query', fuelEfficiencyQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('query');

  // T8a: a per-vehicle fuel-efficiency trend widens to shared READ scoped to the OWNER; the fleet form
  // (no vehicleId) stays acting-user-scoped.
  const scopeId = vehicleId ? await resolveVehicleScope(vehicleId, user.id) : user.id;

  const fuelEfficiencyTrend = await analyticsRepository.getFuelEfficiencyTrend(scopeId, vehicleId);

  return c.json({ success: true, data: { fuelEfficiencyTrend } });
});

export { routes };
