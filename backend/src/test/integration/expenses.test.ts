import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { expenses, sessions, users, vehicles } from '../../db/schema';
import { errorHandler } from '../../lib/middleware/error-handler';
import { expenses as expenseRoutes } from '../../routes/expenses';
import type { ExpenseResponse } from '../../types/api';
import type {
  CostPerMileApiResponse,
  ExpenseCategoriesApiResponse,
  ExpenseListApiResponse,
  ExpenseListApiResponseWithMeta,
  FuelEfficiencyApiResponse,
} from '../../types/api-responses';
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
testApp.route('/api/expenses', expenseRoutes);

describe('Expense Management API Integration Tests', () => {
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
    await getDb().delete(users).where(eq(users.email, 'test@example.com'));

    // Create a test user
    testUserId = createId();
    await getDb().insert(users).values({
      id: testUserId,
      email: 'test@example.com',
      displayName: 'Test User',
      provider: 'google',
      providerId: 'google_test_123',
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
        initialMileage: 25000, // Set initial mileage for cost per mile calculations
      })
      .returning();

    testVehicleId = vehicle[0].id;
  });

  afterAll(() => {
    teardownTestDatabase();
  });
  describe('Expense CRUD Operations', () => {
    test('should create a new expense', async () => {
      const expenseData = {
        type: 'fuel',
        category: 'operating',
        amount: 45.5,
        currency: 'USD',
        date: '2024-01-15T10:30:00.000Z',
        mileage: 25000,
        gallons: 12.5,
        description: 'Gas station fill-up',
      };

      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/expenses`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify(expenseData),
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await getTypedResponse<ExpenseResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data).toBeDefined();
        expect(data.data.type).toBe('fuel');
        expect(data.data.category).toBe('operating');
        expect(data.data.amount).toBe(45.5);
        expect(data.data.vehicleId).toBe(testVehicleId);
      }
      expect(data.message).toContain('created successfully');
    });

    test('should reject fuel expense without gallons and mileage', async () => {
      const invalidExpenseData = {
        type: 'fuel', // ExpenseCategory value (confusingly called "type")
        category: 'operating', // ExpenseType value (confusingly called "category")
        amount: 45.5,
        date: '2024-01-15T10:30:00.000Z',
        // Missing gallons and mileage for fuel expense
      };

      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/expenses`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify(invalidExpenseData),
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(400);

      const data = (await res.json()) as { message: string };
      expect(data.message).toContain('gallons and mileage data');
    });

    test('should create non-fuel expense without gallons', async () => {
      const expenseData = {
        type: 'maintenance',
        category: 'maintenance',
        amount: 89.99,
        date: '2024-01-15T10:30:00.000Z',
        description: 'Oil change',
      };

      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/expenses`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify(expenseData),
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await getTypedResponse<ExpenseResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data.type).toBe('maintenance');
        expect(data.data.gallons).toBeNull();
      }
    });
    test('should list vehicle expenses', async () => {
      // Create test expenses
      const _expense1 = await getDb()
        .insert(expenses)
        .values({
          id: createId(),
          vehicleId: testVehicleId,
          type: 'fuel',
          category: 'operating',
          amount: 45.5,
          currency: 'USD',
          date: new Date('2024-01-15'),
          gallons: 12.5,
          mileage: 25000,
        })
        .returning();

      const _expense2 = await getDb()
        .insert(expenses)
        .values({
          id: createId(),
          vehicleId: testVehicleId,
          type: 'maintenance',
          category: 'maintenance',
          amount: 89.99,
          currency: 'USD',
          date: new Date('2024-01-10'),
          description: 'Oil change',
        })
        .returning();

      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/expenses`,
        {
          headers: {
            Cookie: sessionCookie,
          },
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = (await getTypedResponse<ExpenseListApiResponse>(
        res
      )) as ExpenseListApiResponseWithMeta;
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data).toHaveLength(2);
        expect(data.count).toBe(2);
        // Should be ordered by date descending (newest first)
        expect(data.data[0].date).toBe('2024-01-15T00:00:00.000Z');
        expect(data.data[1].date).toBe('2024-01-10T00:00:00.000Z');
      }
    });

    test('should filter expenses by type', async () => {
      // Create test expenses
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-15'),
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'maintenance',
            category: 'maintenance',
            amount: 89.99,
            currency: 'USD',
            date: new Date('2024-01-10'),
          },
        ]);

      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/expenses?type=fuel`,
        {
          headers: {
            Cookie: sessionCookie,
          },
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = (await getTypedResponse<ExpenseListApiResponse>(
        res
      )) as ExpenseListApiResponseWithMeta;
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data).toHaveLength(1);
        expect(data.data[0].type).toBe('fuel');
        expect(data.filters.type).toBe('fuel');
      }
    });
    test('should filter expenses by date range', async () => {
      // Create test expenses
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-15'),
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'maintenance',
            category: 'maintenance',
            amount: 89.99,
            currency: 'USD',
            date: new Date('2024-02-10'),
          },
        ]);

      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/expenses?startDate=2024-01-01T00:00:00.000Z&endDate=2024-01-31T23:59:59.999Z`,
        {
          headers: {
            Cookie: sessionCookie,
          },
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<ExpenseListApiResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data).toHaveLength(1);
        expect(data.data[0].date).toBe('2024-01-15T00:00:00.000Z');
      }
    });

    test('should get specific expense', async () => {
      // Create test expense
      const expense = await getDb()
        .insert(expenses)
        .values({
          id: createId(),
          vehicleId: testVehicleId,
          type: 'fuel',
          category: 'operating',
          amount: 45.5,
          currency: 'USD',
          date: new Date('2024-01-15'),
          gallons: 12.5,
          mileage: 25000,
          description: 'Test fuel expense',
        })
        .returning();

      const req = new Request(`http://localhost:3001/api/expenses/${expense[0].id}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<ExpenseResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data.id).toBe(expense[0].id);
        expect(data.data.type).toBe('fuel');
        expect(data.data.amount).toBe(45.5);
        expect(data.data.description).toBe('Test fuel expense');
      }
    });

    test('should return 404 for non-existent expense', async () => {
      const nonExistentId = createId();

      const req = new Request(`http://localhost:3001/api/expenses/${nonExistentId}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(404);

      const data = (await res.json()) as { message: string };
      expect(data.message).toContain('not found');
    });
    test('should update expense', async () => {
      // Create test expense
      const expense = await getDb()
        .insert(expenses)
        .values({
          id: createId(),
          vehicleId: testVehicleId,
          type: 'maintenance',
          category: 'maintenance',
          amount: 89.99,
          currency: 'USD',
          date: new Date('2024-01-15'),
          description: 'Oil change',
        })
        .returning();

      const updateData = {
        amount: 95.99,
        description: 'Oil change with filter replacement',
      };

      const req = new Request(`http://localhost:3001/api/expenses/${expense[0].id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(updateData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<{
        amount: number;
        description: string;
      }>(res);
      assertSuccessResponse(data);
      expect(data.data.amount).toBe(95.99);
      expect(data.data.description).toBe('Oil change with filter replacement');
      expect(data.message).toContain('updated successfully');
    });

    test('should delete expense', async () => {
      // Create test expense
      const expense = await getDb()
        .insert(expenses)
        .values({
          id: createId(),
          vehicleId: testVehicleId,
          type: 'maintenance',
          category: 'maintenance',
          amount: 89.99,
          currency: 'USD',
          date: new Date('2024-01-15'),
        })
        .returning();

      const req = new Request(`http://localhost:3001/api/expenses/${expense[0].id}`, {
        method: 'DELETE',
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<unknown>(res);
      expect(data.success).toBe(true);
      expect(data.message).toContain('deleted successfully');

      // Verify expense is deleted
      const checkReq = new Request(`http://localhost:3001/api/expenses/${expense[0].id}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const checkRes = await testApp.fetch(checkReq);
      expect(checkRes.status).toBe(404);
    });

    test('should get expense categories', async () => {
      const req = new Request('http://localhost:3001/api/expenses/categories', {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<ExpenseCategoriesApiResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data.types).toContain('fuel');
        expect(data.data.types).toContain('maintenance');
        expect(data.data.categories).toContain('operating');
        expect(data.data.categories).toContain('maintenance');
        expect(data.data.categoryMapping).toBeDefined();
        expect(data.data.categoryMapping.operating).toContain('fuel');
      }
    });
  });

  describe('Fuel Efficiency Tracking', () => {
    test('should calculate fuel efficiency metrics', async () => {
      // Create fuel expenses with mileage data
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-15'),
            gallons: 12.5,
            mileage: 25000,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
            amount: 48.75,
            currency: 'USD',
            date: new Date('2024-01-30'),
            gallons: 13.0,
            mileage: 25350, // 350 miles driven, 13 gallons = ~26.9 MPG
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
            amount: 52.25,
            currency: 'USD',
            date: new Date('2024-02-15'),
            gallons: 14.2,
            mileage: 25720, // 370 miles driven, 14.2 gallons = ~26.1 MPG
          },
        ]);

      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/fuel-efficiency`,
        {
          headers: {
            Cookie: sessionCookie,
          },
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<FuelEfficiencyApiResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data.vehicleId).toBe(testVehicleId);
        expect(data.data.totalFuelExpenses).toBe(3);
        expect(data.data.totalGallons).toBeGreaterThan(0);
        expect(data.data.averageMPG).toBeGreaterThan(0);
        expect(data.data.averageCostPerGallon).toBeGreaterThan(0);
        expect(data.data.averageCostPerMile).toBeGreaterThan(0);
        expect(data.data.efficiencyTrend).toHaveLength(2); // Should have 2 calculated MPG readings
      }
    });

    test('should calculate cost per mile metrics', async () => {
      // Create various expenses
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
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

      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/cost-per-mile`,
        {
          headers: {
            Cookie: sessionCookie,
          },
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<CostPerMileApiResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data.totalCostPerMile).toBeGreaterThan(0);
        expect(data.data.categoryBreakdown).toBeDefined();
        expect(data.data.categoryBreakdown.operating).toBeDefined();
        expect(data.data.categoryBreakdown.maintenance).toBeDefined();
        expect(data.data.categoryBreakdown.financial).toBeDefined();
        expect(data.data.monthlyTrends).toBeDefined();
        expect(data.data.currentMileage).toBe(25200);
        expect(data.data.totalMiles).toBe(200); // 25200 - 25000
      }
    });

    test('should handle vehicle with no fuel expenses', async () => {
      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/fuel-efficiency`,
        {
          headers: {
            Cookie: sessionCookie,
          },
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<FuelEfficiencyApiResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data.totalFuelExpenses).toBe(0);
        expect(data.data.averageMPG).toBe(0);
        expect(data.data.totalGallons).toBe(0);
        expect(data.data.efficiencyTrend).toHaveLength(0);
        expect(data.data.alerts).toHaveLength(0);
      }
    });

    test('should detect efficiency alerts for significant MPG drops', async () => {
      // Create fuel expenses with declining efficiency
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-01'),
            gallons: 12.0,
            mileage: 25000,
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
            amount: 48.75,
            currency: 'USD',
            date: new Date('2024-01-15'),
            gallons: 12.5,
            mileage: 25360, // 360 miles, 12.5 gallons = 28.8 MPG (good)
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
            amount: 52.25,
            currency: 'USD',
            date: new Date('2024-01-30'),
            gallons: 15.0,
            mileage: 25660, // 300 miles, 15 gallons = 20 MPG (significant drop)
          },
        ]);

      const req = new Request(
        `http://localhost:3001/api/expenses/vehicles/${testVehicleId}/fuel-efficiency`,
        {
          headers: {
            Cookie: sessionCookie,
          },
        }
      );

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<FuelEfficiencyApiResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data.alerts).toHaveLength(1);
        expect(data.data.alerts[0].type).toBe('efficiency_drop');
        expect(data.data.alerts[0].severity).toBeDefined();
        expect(data.data.alerts[0].currentMPG).toBeLessThan(data.data.alerts[0].averageMPG ?? 0);
      }
    });
  });
});
