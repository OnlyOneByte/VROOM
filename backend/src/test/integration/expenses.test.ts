import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { expenses, sessions, users, vehicles } from '../../db/schema';
import { errorHandler } from '../../lib/middleware/error-handler';
import { expenses as expenseRoutes } from '../../routes/expenses';
import type { ExpenseResponse } from '../../types/api';
import type {
  ExpenseCategoriesApiResponse,
  ExpenseListApiResponse,
  ExpenseListApiResponseWithMeta,
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
        vehicleId: testVehicleId,
        tags: ['fuel'],
        category: 'fuel',
        amount: 45.5,
        currency: 'USD',
        date: '2024-01-15T10:30:00.000Z',
        mileage: 25000,
        gallons: 12.5,
        description: 'Gas station fill-up',
      };

      const req = new Request(`http://localhost:3001/api/expenses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(expenseData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await getTypedResponse<ExpenseResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data).toBeDefined();
        expect(data.data.tags).toContain('fuel');
        expect(data.data.category).toBe('fuel');
        expect(data.data.amount).toBe(45.5);
        expect(data.data.vehicleId).toBe(testVehicleId);
      }
      expect(data.message).toContain('created successfully');
    });

    test('should reject fuel expense without gallons and mileage', async () => {
      const invalidExpenseData = {
        vehicleId: testVehicleId,
        tags: ['fuel'],
        category: 'fuel',
        amount: 45.5,
        date: '2024-01-15T10:30:00.000Z',
        // Missing gallons and mileage for fuel expense
      };

      const req = new Request(`http://localhost:3001/api/expenses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(invalidExpenseData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(400);

      const data = (await res.json()) as { message: string };
      expect(data.message).toContain('gallons and mileage data');
    });

    test('should create non-fuel expense without gallons', async () => {
      const expenseData = {
        vehicleId: testVehicleId,
        tags: ['maintenance'],
        category: 'maintenance',
        amount: 89.99,
        date: '2024-01-15T10:30:00.000Z',
        description: 'Oil change',
      };

      const req = new Request(`http://localhost:3001/api/expenses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(expenseData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await getTypedResponse<ExpenseResponse>(res);
      expect(data.success).toBe(true);
      if (data.success && data.data) {
        expect(data.data.tags).toContain('maintenance');
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
          tags: JSON.stringify(['fuel']),
          category: 'fuel',
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
          tags: JSON.stringify(['oil-change']),
          category: 'maintenance',
          amount: 89.99,
          currency: 'USD',
          date: new Date('2024-01-10'),
          description: 'Oil change',
        })
        .returning();

      const req = new Request(`http://localhost:3001/api/expenses?vehicleId=${testVehicleId}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

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
            tags: JSON.stringify(['fuel']),
            category: 'fuel',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-15'),
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            tags: JSON.stringify(['maintenance']),
            category: 'maintenance',
            amount: 89.99,
            currency: 'USD',
            date: new Date('2024-01-15'),
          },
        ]);

      const req = new Request(
        `http://localhost:3001/api/expenses?vehicleId=${testVehicleId}&tags=fuel`,
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
        expect(data.data[0].tags).toContain('fuel');
        expect(data.filters.tags).toContain('fuel');
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
            tags: JSON.stringify(['fuel']),
            category: 'fuel',
            amount: 45.5,
            currency: 'USD',
            date: new Date('2024-01-15'),
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            tags: JSON.stringify(['maintenance']),
            category: 'maintenance',
            amount: 89.99,
            currency: 'USD',
            date: new Date('2024-02-10'),
          },
        ]);

      const req = new Request(
        `http://localhost:3001/api/expenses?vehicleId=${testVehicleId}&startDate=2024-01-01T00:00:00.000Z&endDate=2024-01-31T23:59:59.999Z`,
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
          tags: JSON.stringify(['fuel']),
          category: 'fuel',
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
        expect(data.data.category).toBe('fuel');
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
          tags: JSON.stringify(['oil-change']),
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
          tags: JSON.stringify(['maintenance']),
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
        expect(Array.isArray(data.data)).toBe(true);
        expect(data.data.length).toBe(6);

        const categoryValues = data.data.map((c) => c.value);
        expect(categoryValues).toContain('fuel');
        expect(categoryValues).toContain('maintenance');
        expect(categoryValues).toContain('financial');
        expect(categoryValues).toContain('regulatory');
        expect(categoryValues).toContain('enhancement');
        expect(categoryValues).toContain('misc');

        // Verify structure
        expect(data.data[0]).toHaveProperty('value');
        expect(data.data[0]).toHaveProperty('label');
        expect(data.data[0]).toHaveProperty('description');
      }
    });
  });
});
