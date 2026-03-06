import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import { requireAuth } from '../../middleware';
import { vehicleRepository } from '../vehicles/repository';
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

// GET /api/v1/analytics/summary
routes.get('/summary', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate } = c.req.valid('query');
  const data = await analyticsRepository.getSummary(user.id, { start: startDate, end: endDate });
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/quick-stats
routes.get('/quick-stats', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate } = c.req.valid('query');
  const data = await analyticsRepository.getQuickStats(user.id, { start: startDate, end: endDate });
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/fuel-stats
routes.get('/fuel-stats', zValidator('query', dateRangeVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, vehicleId } = c.req.valid('query');

  if (vehicleId) {
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
    if (!vehicle) throw new NotFoundError('Vehicle');
  }

  const data = await analyticsRepository.getFuelStats(
    user.id,
    { start: startDate, end: endDate },
    vehicleId
  );
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/cross-vehicle
routes.get('/cross-vehicle', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate } = c.req.valid('query');
  const data = await analyticsRepository.getCrossVehicle(user.id, {
    start: startDate,
    end: endDate,
  });
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/financing
routes.get('/financing', async (c) => {
  const user = c.get('user');
  const data = await analyticsRepository.getFinancing(user.id);
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/insurance
routes.get('/insurance', async (c) => {
  const user = c.get('user');
  const data = await analyticsRepository.getInsurance(user.id);
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/fuel-advanced
routes.get('/fuel-advanced', zValidator('query', dateRangeVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, vehicleId } = c.req.valid('query');

  if (vehicleId) {
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
    if (!vehicle) throw new NotFoundError('Vehicle');
  }

  const data = await analyticsRepository.getFuelAdvanced(
    user.id,
    { start: startDate, end: endDate },
    vehicleId
  );
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/vehicle-health
routes.get('/vehicle-health', zValidator('query', vehicleIdQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('query');
  const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');
  const data = await analyticsRepository.getVehicleHealth(user.id, vehicleId);
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/vehicle-tco
routes.get('/vehicle-tco', zValidator('query', yearVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, year } = c.req.valid('query');
  const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');
  const data = await analyticsRepository.getVehicleTCO(user.id, vehicleId, year);
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/vehicle-expenses
routes.get(
  '/vehicle-expenses',
  zValidator('query', dateRangeRequiredVehicleQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId, startDate, endDate } = c.req.valid('query');
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
    if (!vehicle) throw new NotFoundError('Vehicle');
    const data = await analyticsRepository.getVehicleExpenses(user.id, vehicleId, {
      start: startDate,
      end: endDate,
    });
    return c.json({ success: true, data });
  }
);

// GET /api/v1/analytics/year-end
routes.get('/year-end', zValidator('query', yearQuerySchema), async (c) => {
  const user = c.get('user');
  const { year } = c.req.valid('query');
  const currentYear = year ?? new Date().getFullYear();
  const data = await analyticsRepository.getYearEnd(user.id, currentYear);
  return c.json({ success: true, data });
});

// GET /api/v1/analytics/fuel-efficiency
routes.get('/fuel-efficiency', zValidator('query', fuelEfficiencyQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('query');

  // If vehicleId provided, verify user owns the vehicle
  if (vehicleId) {
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle');
    }
  }

  const fuelEfficiencyTrend = await analyticsRepository.getFuelEfficiencyTrend(user.id, vehicleId);

  return c.json({ success: true, data: { fuelEfficiencyTrend } });
});

export { routes };
