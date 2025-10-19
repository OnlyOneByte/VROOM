import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';
import { AnalyticsService } from '../lib/services/analytics/analytics-service';

const analytics = new Hono();

// Validation schemas
const _analyticsParamsSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required').optional(),
});

const analyticsQuerySchema = z.object({
  startDate: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  endDate: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  groupBy: z.enum(['day', 'week', 'month', 'year']).default('month'),
});

// Apply authentication to all routes
analytics.use('*', requireAuth);

// GET /api/analytics/dashboard - Get comprehensive dashboard data
analytics.get('/dashboard', zValidator('query', analyticsQuerySchema), async (c) => {
  try {
    const user = c.get('user');
    const query = c.req.valid('query');

    const expenseRepository = repositoryFactory.getExpenseRepository();
    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const analyticsService = new AnalyticsService(expenseRepository, vehicleRepository);

    const data = await analyticsService.getDashboardAnalytics(user.id, query);

    return c.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch dashboard analytics' });
  }
});

// GET /api/analytics/vehicle/:vehicleId - Get analytics for specific vehicle
analytics.get(
  '/vehicle/:vehicleId',
  zValidator('param', z.object({ vehicleId: z.string() })),
  zValidator('query', analyticsQuerySchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { vehicleId } = c.req.valid('param');
      const query = c.req.valid('query');

      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const expenseRepository = repositoryFactory.getExpenseRepository();

      // Verify vehicle exists and belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }

      const analyticsService = new AnalyticsService(expenseRepository, vehicleRepository);
      const data = await analyticsService.getVehicleAnalytics(vehicleId, vehicle, query);

      return c.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Error fetching vehicle analytics:', error);

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to fetch vehicle analytics' });
    }
  }
);

// GET /api/analytics/trends - Get trend data for charts
analytics.get('/trends', zValidator('query', analyticsQuerySchema), async (c) => {
  try {
    const user = c.get('user');
    const query = c.req.valid('query');

    const expenseRepository = repositoryFactory.getExpenseRepository();
    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const analyticsService = new AnalyticsService(expenseRepository, vehicleRepository);

    const data = await analyticsService.getTrendData(user.id, query);

    return c.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching trend data:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch trend data' });
  }
});

export { analytics };
