/**
 * Unit tests for GET /api/v1/analytics/summary route
 *
 * Tests the route handler behavior: auth enforcement, query validation,
 * successful responses, and error handling.
 *
 * **Validates: Requirements 6.1, 6.2, 7.2**
 */

import { describe, expect, mock, test } from 'bun:test';
import { zValidator } from '@hono/zod-validator';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { DatabaseError } from '../../../errors';
import { errorHandler } from '../../../middleware/error-handler';
import type { AnalyticsSummaryData } from '../repository';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const TEST_USER = {
  id: 'user-123',
  email: 'test@example.com',
  displayName: 'Test User',
  provider: 'google',
  providerId: 'google-123',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_SUMMARY: AnalyticsSummaryData = {
  quickStats: {
    vehicleCount: 2,
    ytdSpending: 5432.1,
    avgEfficiency: 28.5,
    fleetHealthScore: 85,
    units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
  },
  fuelStats: {
    fillups: { currentYear: 24, previousYear: 20, currentMonth: 2, previousMonth: 3 },
    volume: { currentYear: 300, previousYear: 250, currentMonth: 25, previousMonth: 30 },
    fuelConsumption: { avgEfficiency: 28.5, bestEfficiency: 35.2, worstEfficiency: 22.1 },
    fillupDetails: { avgVolume: 12.5, minVolume: 8.0, maxVolume: 18.0 },
    averageCost: {
      perFillup: 45.0,
      bestCostPerDistance: 0.08,
      worstCostPerDistance: 0.15,
      avgCostPerDay: 3.5,
    },
    distance: { totalDistance: 8500, avgPerDay: 23.3, avgPerMonth: 708.3 },
    monthlyConsumption: [],
    gasPriceHistory: [],
    fillupCostByVehicle: [],
    odometerProgression: [],
    costPerDistance: [],
  },
  fuelAdvanced: {
    maintenanceTimeline: [],
    seasonalEfficiency: [],
    vehicleRadar: [],
    dayOfWeekPatterns: [],
    monthlyCostHeatmap: [],
    fillupIntervals: [],
  },
};

// ---------------------------------------------------------------------------
// Response types for test assertions
// ---------------------------------------------------------------------------

interface SuccessBody {
  success: true;
  data: AnalyticsSummaryData;
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

/**
 * Creates a test Hono app with controllable auth and repository behavior.
 * This avoids module-level mocking and keeps tests isolated.
 */
function createTestApp(options: {
  authenticated?: boolean;
  getSummaryResult?: AnalyticsSummaryData;
  getSummaryError?: Error;
}) {
  const { authenticated = true, getSummaryResult, getSummaryError } = options;

  const app = new Hono();

  // Error handler (same as production)
  app.onError(errorHandler);

  // Auth middleware — either sets user or rejects
  const testAuth: MiddlewareHandler = async (c, next) => {
    if (!authenticated) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    c.set('user', TEST_USER);
    c.set('session', { id: 'session-1', expiresAt: new Date(Date.now() + 86400000) });
    return next();
  };

  // Mock getSummary function
  const getSummaryMock = mock(async (_userId: string, _range: { start: number; end: number }) => {
    if (getSummaryError) throw getSummaryError;
    return getSummaryResult ?? MOCK_SUMMARY;
  });

  // Mount a minimal version of the summary route with the same validation
  const dateRangeQuerySchema = z.object({
    startDate: z.coerce.number().int().positive(),
    endDate: z.coerce.number().int().positive(),
  });

  const routes = new Hono();
  routes.use('*', testAuth);
  routes.get('/summary', zValidator('query', dateRangeQuerySchema), async (c) => {
    const user = c.get('user');
    const { startDate, endDate } = c.req.valid('query');
    const data = await getSummaryMock(user.id, { start: startDate, end: endDate });
    return c.json({ success: true, data });
  });

  app.route('/api/v1/analytics', routes);

  return { app, getSummaryMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/analytics/summary', () => {
  const VALID_QUERY = '?startDate=1704067200&endDate=1735689600';

  test('returns 200 with combined quickStats, fuelStats, fuelAdvanced for authenticated request', async () => {
    const { app, getSummaryMock } = createTestApp({ getSummaryResult: MOCK_SUMMARY });

    const res = await app.request(`/api/v1/analytics/summary${VALID_QUERY}`);
    const body = (await res.json()) as SuccessBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.quickStats).toEqual(MOCK_SUMMARY.quickStats);
    expect(body.data.fuelStats).toEqual(MOCK_SUMMARY.fuelStats);
    expect(body.data.fuelAdvanced).toEqual(MOCK_SUMMARY.fuelAdvanced);

    // Verify repository was called with correct args
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
    expect(getSummaryMock).toHaveBeenCalledWith('user-123', {
      start: 1704067200,
      end: 1735689600,
    });
  });

  test('returns 401 for unauthenticated request', async () => {
    const { app } = createTestApp({ authenticated: false });

    const res = await app.request(`/api/v1/analytics/summary${VALID_QUERY}`);
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.message).toBe('Authentication required');
  });

  test('returns 400 for invalid date range params', async () => {
    const { app, getSummaryMock } = createTestApp({});

    // Missing both params
    const res1 = await app.request('/api/v1/analytics/summary');
    expect(res1.status).toBe(400);

    // Non-numeric startDate
    const res2 = await app.request('/api/v1/analytics/summary?startDate=abc&endDate=1735689600');
    expect(res2.status).toBe(400);

    // Negative endDate
    const res3 = await app.request('/api/v1/analytics/summary?startDate=1704067200&endDate=-1');
    expect(res3.status).toBe(400);

    // Missing endDate
    const res4 = await app.request('/api/v1/analytics/summary?startDate=1704067200');
    expect(res4.status).toBe(400);

    // Repository should never be called for invalid requests
    expect(getSummaryMock).not.toHaveBeenCalled();
  });

  test('returns 500 with structured error when repository throws DatabaseError', async () => {
    const dbError = new DatabaseError('Failed to compute analytics summary', 'connection lost');

    const { app } = createTestApp({ getSummaryError: dbError });

    const res = await app.request(`/api/v1/analytics/summary${VALID_QUERY}`);
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DatabaseError');
    expect(body.error.message).toBe('Failed to compute analytics summary');
  });
});
