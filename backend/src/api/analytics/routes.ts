import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../../middleware';
import { requireVehicleOwnerScope } from '../../utils/sharing';
import { zValidator } from '../../utils/validation';
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

const yearQuerySchema = z.object({
  year: z.coerce.number().int().positive().optional(),
});

const vehicleIdQuerySchema = z.object({
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

const yearVehicleQuerySchema = z.object({
  year: z.coerce.number().int().positive().optional(),
  vehicleId: z.string(),
});

routes.use('*', requireAuth);

routes.get('/summary', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate } = c.req.valid('query');
  const data = await analyticsRepository.getSummary(user.id, { start: startDate, end: endDate });
  return c.json({ success: true, data: analyticsSummaryToApi(data) });
});

routes.get('/quick-stats', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate } = c.req.valid('query');
  const data = await analyticsRepository.getQuickStats(user.id, { start: startDate, end: endDate });
  return c.json({ success: true, data: quickStatsToApi(data) });
});

routes.get('/fuel-stats', zValidator('query', dateRangeVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, vehicleId } = c.req.valid('query');

  const scopeId = vehicleId ? await requireVehicleOwnerScope(vehicleId, user.id, 'read') : user.id;

  const data = await analyticsRepository.getFuelStats(
    scopeId,
    { start: startDate, end: endDate },
    vehicleId
  );
  return c.json({ success: true, data: fuelStatsToApi(data) });
});

routes.get('/cross-vehicle', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate } = c.req.valid('query');
  const data = await analyticsRepository.getCrossVehicle(user.id, {
    start: startDate,
    end: endDate,
  });
  return c.json({ success: true, data: crossVehicleToApi(data) });
});

routes.get('/financing', async (c) => {
  const user = c.get('user');
  const data = await analyticsRepository.getFinancing(user.id);
  return c.json({ success: true, data: financingToApi(data) });
});

routes.get('/insurance', async (c) => {
  const user = c.get('user');
  const data = await analyticsRepository.getInsurance(user.id);
  return c.json({ success: true, data: insuranceToApi(data) });
});

routes.get('/fuel-advanced', zValidator('query', dateRangeVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, vehicleId } = c.req.valid('query');

  const scopeId = vehicleId ? await requireVehicleOwnerScope(vehicleId, user.id, 'read') : user.id;

  const data = await analyticsRepository.getFuelAdvanced(
    scopeId,
    { start: startDate, end: endDate },
    vehicleId
  );
  return c.json({ success: true, data: fuelAdvancedToApi(data) });
});

routes.get('/vehicle-health', zValidator('query', vehicleIdQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('query');
  const scopeId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');
  const data = await analyticsRepository.getVehicleHealth(scopeId, vehicleId);
  return c.json({ success: true, data });
});

routes.get('/vehicle-tco', zValidator('query', yearVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, year } = c.req.valid('query');
  const scopeId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');
  const data = await analyticsRepository.getVehicleTCO(scopeId, vehicleId, year);
  return c.json({ success: true, data: vehicleTcoToApi(data) });
});

routes.get(
  '/vehicle-expenses',
  zValidator('query', dateRangeRequiredVehicleQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId, startDate, endDate } = c.req.valid('query');
    const scopeId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');
    const data = await analyticsRepository.getVehicleExpenses(scopeId, vehicleId, {
      start: startDate,
      end: endDate,
    });
    return c.json({ success: true, data: vehicleExpensesToApi(data) });
  }
);

routes.get('/year-end', zValidator('query', yearQuerySchema), async (c) => {
  const user = c.get('user');
  const { year } = c.req.valid('query');
  const currentYear = year ?? new Date().getFullYear();
  const data = await analyticsRepository.getYearEnd(user.id, currentYear);
  return c.json({ success: true, data: yearEndToApi(data) });
});

routes.get('/fuel-efficiency', zValidator('query', fuelEfficiencyQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('query');

  const scopeId = vehicleId ? await requireVehicleOwnerScope(vehicleId, user.id, 'read') : user.id;

  const fuelEfficiencyTrend = await analyticsRepository.getFuelEfficiencyTrend(scopeId, vehicleId);

  return c.json({ success: true, data: { fuelEfficiencyTrend } });
});

export { routes };
