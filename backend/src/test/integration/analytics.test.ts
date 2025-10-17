import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { expenses, sessions, users, vehicles } from '../../db/schema';
import { errorHandler } from '../../lib/middleware/error-handler';
import { analytics as analyticsRoutes } from '../../routes/analytics';
import { getTestLucia } from '../lucia-test.js';
import {
  clearTestData,
  type getTestDatabase,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup.js';
import { assertSuccessResponse, getDb, getTypedResponse } from '../utils/test-helpers.js';

// Test app setup
const testApp = new Hono();
testApp.onError(errorHandler);
testApp.route('/api/analytics', analyticsRoutes);

describe('Analytics API Integration Tests', () => {
  let _db: ReturnType<typeof getTestDatabase>;
  let testUserId: string;
  let testSessionId: string;
  let sessionCookie: string;
  let testVehicleId: string;

  beforeAll(() => {
    _db = setupTestDatabase();
  });

  beforeEach(async () => {
    clearTestData();
    await getDb().delete(vehicles);
    await getDb().delete(sessions);
    await getDb().delete(users).where(eq(users.email, 'test-analytics@example.com'));

    // Create a test user
    testUserId = createId();
    await getDb().insert(users).values({
      id: testUserId,
      email: 'test-analytics@example.com',
      displayName: 'Test Analytics User',
      provider: 'google',
      providerId: 'google_analytics_test_123',
    });

    // Create a test session using test Lucia
    const lucia = getTestLucia();
    const session = await lucia.createSession(testUserId, {});
    testSessionId = session.id;
    sessionCookie = lucia.createSessionCookie(testSessionId).serialize();

    // Create a test vehicle
    const vehicle = await getDb()
      .insert(vehicles)
      .values({
        id: createId(),
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        initialMileage: 25000,
      })
      .returning();

    testVehicleId = vehicle[0].id;
  });

  afterAll(() => {
    teardownTestDatabase();
  });

  describe('Vehicle Analytics - Fuel Efficiency', () => {
    test('should calculate fuel efficiency metrics', async () => {
      // Create fuel expenses with mileage data
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            tags: JSON.stringify(['fuel']),
            category: 'fuel',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-15'),
            gallons: 12.5,
            mileage: 25000,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            tags: JSON.stringify(['fuel']),
            category: 'fuel',
            amount: 48.75,
            currency: 'USD',
            date: new Date('2024-01-30'),
            gallons: 13.0,
            mileage: 25350, // 350 miles driven, 13 gallons = ~26.9 MPG
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            tags: JSON.stringify(['fuel']),
            category: 'fuel',
            amount: 52.25,
            currency: 'USD',
            date: new Date('2024-02-15'),
            gallons: 14.2,
            mileage: 25720, // 370 miles driven, 14.2 gallons = ~26.1 MPG
          },
        ]);

      const req = new Request(`http://localhost:3001/api/analytics/vehicle/${testVehicleId}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        vehicle: { id: string; name: string };
        fuelEfficiency: {
          averageMPG: number;
          totalGallons: number;
          totalMiles: number;
          trend: Array<{ date: Date; mpg: number }>;
        };
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.vehicle.id).toBe(testVehicleId);
      expect(data.data.fuelEfficiency.averageMPG).toBeGreaterThan(0);
      expect(data.data.fuelEfficiency.totalGallons).toBeGreaterThan(0);
      expect(data.data.fuelEfficiency.trend.length).toBeGreaterThan(0);
    });

    test('should handle vehicle with no fuel expenses', async () => {
      const req = new Request(`http://localhost:3001/api/analytics/vehicle/${testVehicleId}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        fuelEfficiency: {
          averageMPG: number;
          totalGallons: number;
          totalMiles: number;
          trend: unknown[];
        };
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.fuelEfficiency.averageMPG).toBe(0);
      expect(data.data.fuelEfficiency.totalGallons).toBe(0);
      expect(data.data.fuelEfficiency.trend).toHaveLength(0);
    });

    test('should calculate accurate MPG for sequential fuel entries', async () => {
      // Create sequential fuel expenses with realistic data
      const fuelEntries = [
        { date: '2024-01-01', gallons: 12.0, mileage: 25000, amount: 42.0 }, // Starting point
        { date: '2024-01-08', gallons: 11.5, mileage: 25320, amount: 40.25 }, // 320 miles, 11.5 gallons = 27.8 MPG
        { date: '2024-01-15', gallons: 12.2, mileage: 25650, amount: 43.5 }, // 330 miles, 12.2 gallons = 27.0 MPG
        { date: '2024-01-22', gallons: 13.1, mileage: 25950, amount: 46.85 }, // 300 miles, 13.1 gallons = 22.9 MPG
      ];

      for (const entry of fuelEntries) {
        await getDb()
          .insert(expenses)
          .values({
            id: createId(),
            vehicleId: testVehicleId,
            tags: JSON.stringify(['fuel']),
            category: 'fuel',
            amount: entry.amount,
            currency: 'USD',
            date: new Date(entry.date),
            gallons: entry.gallons,
            mileage: entry.mileage,
          });
      }

      const req = new Request(`http://localhost:3001/api/analytics/vehicle/${testVehicleId}`, {
        headers: { Cookie: sessionCookie },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        fuelEfficiency: {
          averageMPG: number;
          totalGallons: number;
          totalMiles: number;
          trend: Array<{ mpg: number }>;
        };
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.fuelEfficiency.totalGallons).toBeCloseTo(48.8, 1);
      expect(data.data.fuelEfficiency.totalMiles).toBe(950); // 25950 - 25000
      expect(data.data.fuelEfficiency.averageMPG).toBeCloseTo(19.47, 1);
      expect(data.data.fuelEfficiency.trend).toHaveLength(3); // 3 calculated MPG readings
    });
  });

  describe('Vehicle Analytics - Cost Per Mile', () => {
    test('should calculate cost per mile metrics', async () => {
      // Create various expenses
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            tags: JSON.stringify(['fuel']),
            category: 'fuel',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-15'),
            mileage: 25000,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'maintenance',
            category: 'maintenance',
            amount: 89.99,
            currency: 'USD',
            date: new Date('2024-01-20'),
            mileage: 25100,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'insurance',
            category: 'financial',
            amount: 150.0,
            currency: 'USD',
            date: new Date('2024-01-25'),
            mileage: 25200,
          },
        ]);

      const req = new Request(`http://localhost:3001/api/analytics/vehicle/${testVehicleId}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        costPerMile: {
          costPerMile: number;
          totalCost: number;
          totalMiles: number;
        };
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.costPerMile.costPerMile).toBeGreaterThan(0);
      expect(data.data.costPerMile.totalMiles).toBe(200); // 25200 - 25000
      expect(data.data.costPerMile.totalCost).toBeCloseTo(285.49, 2);
    });

    test('should calculate comprehensive cost per mile breakdown', async () => {
      // Create expenses across all categories
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'fuel',
            amount: 150.0,
            currency: 'USD',
            date: new Date('2024-01-01'),
            mileage: 25000,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'tolls',
            category: 'fuel',
            amount: 25.0,
            currency: 'USD',
            date: new Date('2024-01-05'),
            mileage: 25100,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'maintenance',
            category: 'maintenance',
            amount: 200.0,
            currency: 'USD',
            date: new Date('2024-01-10'),
            mileage: 25200,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'oil-change',
            category: 'maintenance',
            amount: 65.0,
            currency: 'USD',
            date: new Date('2024-01-15'),
            mileage: 25300,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'insurance',
            category: 'financial',
            amount: 200.0,
            currency: 'USD',
            date: new Date('2024-01-20'),
            mileage: 25400,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'registration',
            category: 'regulatory',
            amount: 125.0,
            currency: 'USD',
            date: new Date('2024-01-25'),
            mileage: 25500,
          },
        ]);

      const req = new Request(`http://localhost:3001/api/analytics/vehicle/${testVehicleId}`, {
        headers: { Cookie: sessionCookie },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        costPerMile: {
          costPerMile: number;
          totalCost: number;
          totalMiles: number;
        };
        categoryBreakdown: {
          fuel: { amount: number; count: number };
          maintenance: { amount: number; count: number };
          financial: { amount: number; count: number };
          regulatory: { amount: number; count: number };
        };
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.costPerMile.costPerMile).toBeCloseTo(1.53, 2);
      expect(data.data.costPerMile.totalMiles).toBe(500);
      expect(data.data.costPerMile.totalCost).toBe(765.0);

      // Check category breakdown
      expect(data.data.categoryBreakdown.fuel).toBeDefined();
      expect(data.data.categoryBreakdown.fuel.amount).toBe(175.0);
      expect(data.data.categoryBreakdown.maintenance).toBeDefined();
      expect(data.data.categoryBreakdown.maintenance.amount).toBe(265.0);
    });

    test('should generate monthly cost trends', async () => {
      // Create expenses across multiple months
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'fuel',
            amount: 150.0,
            currency: 'USD',
            date: new Date('2024-01-15'),
            mileage: 25000,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'maintenance',
            category: 'maintenance',
            amount: 200.0,
            currency: 'USD',
            date: new Date('2024-01-20'),
            mileage: 25200,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'fuel',
            amount: 160.0,
            currency: 'USD',
            date: new Date('2024-02-15'),
            mileage: 25400,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'insurance',
            category: 'financial',
            amount: 200.0,
            currency: 'USD',
            date: new Date('2024-02-20'),
            mileage: 25600,
          },
        ]);

      const req = new Request(`http://localhost:3001/api/analytics/vehicle/${testVehicleId}`, {
        headers: { Cookie: sessionCookie },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        monthlyTrends: Array<{ period: string; amount: number }>;
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.monthlyTrends).toHaveLength(2); // January and February

      // Check January data
      const januaryData = data.data.monthlyTrends.find((trend) => trend.period === '2024-01');
      expect(januaryData).toBeDefined();
      expect(januaryData?.amount).toBe(350.0);

      // Check February data
      const februaryData = data.data.monthlyTrends.find((trend) => trend.period === '2024-02');
      expect(februaryData).toBeDefined();
      expect(februaryData?.amount).toBe(360.0);
    });
  });

  describe('Dashboard Analytics', () => {
    test('should get comprehensive dashboard data', async () => {
      // Create some expenses
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'fuel',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-15'),
            gallons: 12.5,
            mileage: 25000,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'maintenance',
            category: 'maintenance',
            amount: 89.99,
            currency: 'USD',
            date: new Date('2024-01-20'),
          },
        ]);

      const req = new Request('http://localhost:3001/api/analytics/dashboard', {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        vehicles: Array<{ id: string; name: string }>;
        totalExpenses: number;
        monthlyTrends: Array<{ period: string; amount: number }>;
        categoryBreakdown: Record<string, { amount: number; count: number }>;
        fuelEfficiency: {
          averageMPG: number;
          totalGallons: number;
        };
        costPerMile: {
          totalCostPerMile: number;
          totalCost: number;
        };
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.vehicles).toHaveLength(1);
      expect(data.data.totalExpenses).toBeCloseTo(135.49, 2);
      expect(data.data.categoryBreakdown).toBeDefined();
    });

    test('should handle dashboard with no data', async () => {
      const req = new Request('http://localhost:3001/api/analytics/dashboard', {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        totalExpenses: number;
        monthlyTrends: unknown[];
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.totalExpenses).toBe(0);
      expect(data.data.monthlyTrends).toHaveLength(0);
    });
  });

  describe('Trend Analytics', () => {
    test('should calculate trend data', async () => {
      // Create expenses with fuel data
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'fuel',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-15'),
            gallons: 12.5,
            mileage: 25000,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'maintenance',
            category: 'maintenance',
            amount: 89.99,
            currency: 'USD',
            date: new Date('2024-01-20'),
          },
        ]);

      const req = new Request('http://localhost:3001/api/analytics/trends', {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        costTrends: Array<{ period: string; amount: number }>;
        milesTrends: Array<{ period: string; miles: number }>;
        costPerMileTrends: Array<{ period: string; costPerMile: number }>;
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.costTrends).toBeDefined();
      expect(data.data.milesTrends).toBeDefined();
      expect(data.data.costPerMileTrends).toBeDefined();
    });
  });
});
