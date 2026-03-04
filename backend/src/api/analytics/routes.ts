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

// Apply auth middleware to all analytics routes
routes.use('*', requireAuth);

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
