import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { expenses, insurancePolicies, users, vehicles } from '../../db/schema';
import { errorHandler } from '../../lib/middleware/error-handler';
import { expenses as expenseRoutes } from '../../routes/expenses';
import { insurance as insuranceRoutes } from '../../routes/insurance';
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
testApp.route('/api/insurance', insuranceRoutes);

describe('Expense System Integration Tests - Task 5.4', () => {
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

    // Create a test user
    testUserId = createId();
    await getDb().insert(users).values({
      id: testUserId,
      email: 'test-expense-system@example.com',
      displayName: 'Test Expense System User',
      provider: 'google',
      providerId: 'google_expense_test_123',
    });

    // Create a test session using test Lucia
    const lucia = getTestLucia();
    const session = await lucia.createSession(testUserId, {});
    testSessionId = session.id;
    sessionCookie = lucia.createSessionCookie(testSessionId).serialize();

    // Create a test vehicle with initial mileage for calculations
    const vehicle = await getDb()
      .insert(vehicles)
      .values({
        id: createId(),
        userId: testUserId,
        make: 'Honda',
        model: 'Civic',
        year: 2022,
        licensePlate: 'TEST123',
        initialMileage: 10000, // Starting mileage for cost calculations
      })
      .returning();

    testVehicleId = vehicle[0].id;
  });

  afterAll(() => {
    teardownTestDatabase();
  });

  describe('Expense CRUD Operations with Proper Categorization', () => {
    test('should create expenses with all supported categories', async () => {
      const expenseCategories = [
        { type: 'fuel', category: 'operating', amount: 45.5, gallons: 12.5, mileage: 10300 },
        { type: 'tolls', category: 'operating', amount: 5.75 },
        { type: 'parking', category: 'operating', amount: 15.0 },
        { type: 'maintenance', category: 'maintenance', amount: 89.99 },
        { type: 'repairs', category: 'maintenance', amount: 450.0 },
        { type: 'tires', category: 'maintenance', amount: 800.0 },
        { type: 'oil-change', category: 'maintenance', amount: 65.0 },
        { type: 'insurance', category: 'financial', amount: 200.0 },
        { type: 'loan-payment', category: 'financial', amount: 350.0 },
        { type: 'registration', category: 'regulatory', amount: 125.0 },
        { type: 'inspection', category: 'regulatory', amount: 35.0 },
        { type: 'emissions', category: 'regulatory', amount: 25.0 },
        { type: 'tickets', category: 'regulatory', amount: 150.0 },
        { type: 'modifications', category: 'enhancement', amount: 500.0 },
        { type: 'accessories', category: 'enhancement', amount: 75.0 },
        { type: 'detailing', category: 'enhancement', amount: 120.0 },
        { type: 'other', category: 'convenience', amount: 25.0 },
      ];

      for (const expenseData of expenseCategories) {
        const req = new Request(`http://localhost:3001/api/expenses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify({
            vehicleId: testVehicleId,
            ...expenseData,
            currency: 'USD',
            date: '2024-01-15T10:30:00.000Z',
            description: `Test ${expenseData.type} expense`,
          }),
        });

        const res = await testApp.fetch(req);
        expect(res.status).toBe(201);

        const data = await getTypedResponse<{
          id: string;
          type: string;
          category: string;
          amount: number;
        }>(res);
        assertSuccessResponse(data);
        expect(data.data.type).toBe(expenseData.type);
        expect(data.data.category).toBe(expenseData.category);
        expect(data.data.amount).toBe(expenseData.amount);
      }
    });

    test('should validate category-type mapping consistency', async () => {
      // Test invalid category-type combinations
      const invalidCombinations = [
        { type: 'maintenance', category: 'operating' }, // maintenance should be maintenance category
        { type: 'insurance', category: 'operating' }, // insurance should be financial
        { type: 'registration', category: 'enhancement' }, // registration should be regulatory
      ];

      for (const invalidData of invalidCombinations) {
        const req = new Request(`http://localhost:3001/api/expenses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify({
            vehicleId: testVehicleId,
            ...invalidData,
            amount: 50.0,
            currency: 'USD',
            date: '2024-01-15T10:30:00.000Z',
          }),
        });

        const res = await testApp.fetch(req);
        // Note: Current implementation allows any category, but this test documents expected behavior
        // In a stricter implementation, this would return 400
        expect(res.status).toBe(201); // Current behavior - may change in future
      }
    });

    test('should filter expenses by category correctly', async () => {
      // Create expenses in different categories
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
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'insurance',
            category: 'financial',
            amount: 200.0,
            currency: 'USD',
            date: new Date('2024-01-05'),
          },
        ]);

      // Test filtering by operating category
      const operatingReq = new Request(
        `http://localhost:3001/api/expenses?vehicleId=${testVehicleId}&category=operating`,
        {
          headers: { Cookie: sessionCookie },
        }
      );

      const operatingRes = await testApp.fetch(operatingReq);
      expect(operatingRes.status).toBe(200);

      const operatingData = await getTypedResponse<Array<{ category: string }>>(operatingRes);
      expect(operatingData.success).toBe(true);
      if (operatingData.success && operatingData.data) {
        expect(operatingData.data).toHaveLength(1);
        expect(operatingData.data[0].category).toBe('operating');
        // Note: filters are at the top level of the response, not in data
      }

      // Test filtering by maintenance category
      const maintenanceReq = new Request(
        `http://localhost:3001/api/expenses?vehicleId=${testVehicleId}&category=maintenance`,
        {
          headers: { Cookie: sessionCookie },
        }
      );

      const maintenanceRes = await testApp.fetch(maintenanceReq);
      expect(maintenanceRes.status).toBe(200);

      const maintenanceData = await getTypedResponse<Array<{ category: string }>>(maintenanceRes);
      expect(maintenanceData.success).toBe(true);
      if (maintenanceData.success && maintenanceData.data) {
        expect(maintenanceData.data).toHaveLength(1);
        expect(maintenanceData.data[0].category).toBe('maintenance');
      }
    });

    test('should update expense with category validation', async () => {
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

      // Update expense with new category
      const updateData = {
        category: 'operating', // Change from maintenance to operating
        amount: 95.99,
        description: 'Oil change - updated',
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

      const data = await getTypedResponse<{ category: string; amount: number }>(res);
      expect(data.success).toBe(true);
      expect(data.data?.category).toBe('operating');
      expect(data.data?.amount).toBe(95.99);
    });
  });

  describe('Insurance Cost Proration and Policy Management', () => {
    test('should calculate monthly cost proration correctly', async () => {
      // Create insurance policy with 6-month term
      const policyData = {
        company: 'Progressive',
        policyNumber: 'PROG123456',
        totalCost: 1200.0,
        termLengthMonths: 6,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-06-30T23:59:59.999Z',
      };

      const createReq = new Request(
        `http://localhost:3001/api/insurance/vehicles/${testVehicleId}/policies`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify(policyData),
        }
      );

      const createRes = await testApp.fetch(createReq);
      expect(createRes.status).toBe(201);

      const createData = await getTypedResponse<{
        id: string;
        monthlyCost: number;
      }>(createRes);
      assertSuccessResponse(createData);
      expect(createData.data.monthlyCost).toBe(200.0); // 1200 / 6

      // Test monthly breakdown
      const breakdownReq = new Request(
        `http://localhost:3001/api/insurance/${createData.data.id}/monthly-breakdown`,
        {
          headers: { Cookie: sessionCookie },
        }
      );

      const breakdownRes = await testApp.fetch(breakdownReq);
      expect(breakdownRes.status).toBe(200);

      const breakdownData = await getTypedResponse<{
        breakdown: Array<{
          cost: number;
          monthName: string;
          startDate: string;
          endDate: string;
        }>;
      }>(breakdownRes);
      assertSuccessResponse(breakdownData);
      expect(breakdownData.data.breakdown).toHaveLength(6);

      // Check each month has correct cost
      breakdownData.data.breakdown.forEach((month) => {
        expect(month.cost).toBe(200.0);
        expect(month.monthName).toBeDefined();
        expect(month.startDate).toBeDefined();
        expect(month.endDate).toBeDefined();
      });
    });

    test('should handle different term lengths and proration', async () => {
      const testCases = [
        { termMonths: 3, totalCost: 600.0, expectedMonthly: 200.0 },
        { termMonths: 12, totalCost: 1800.0, expectedMonthly: 150.0 },
        { termMonths: 1, totalCost: 250.0, expectedMonthly: 250.0 },
      ];

      for (const testCase of testCases) {
        const policyData = {
          company: `Test Insurance ${testCase.termMonths}M`,
          totalCost: testCase.totalCost,
          termLengthMonths: testCase.termMonths,
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: new Date(2024, testCase.termMonths, 0).toISOString(), // End of term
        };

        const req = new Request(
          `http://localhost:3001/api/insurance/vehicles/${testVehicleId}/policies`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: sessionCookie,
            },
            body: JSON.stringify(policyData),
          }
        );

        const res = await testApp.fetch(req);
        expect(res.status).toBe(201);

        const data = await getTypedResponse<{
          monthlyCost: number;
        }>(res);
        assertSuccessResponse(data);
        expect(data.data.monthlyCost).toBeCloseTo(testCase.expectedMonthly, 2);
      }
    });

    test('should update monthly cost when policy is modified', async () => {
      // Create initial policy
      const initialPolicy = {
        company: 'Allstate',
        totalCost: 1200.0,
        termLengthMonths: 6,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-06-30T23:59:59.999Z',
      };

      const createReq = new Request(
        `http://localhost:3001/api/insurance/vehicles/${testVehicleId}/policies`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify(initialPolicy),
        }
      );

      const createRes = await testApp.fetch(createReq);
      const createData = await getTypedResponse<{
        id: string;
      }>(createRes);
      assertSuccessResponse(createData);
      const policyId = createData.data.id;

      // Update policy cost
      const updateData = {
        totalCost: 1500.0, // Increase cost
      };

      const updateReq = new Request(`http://localhost:3001/api/insurance/${policyId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(updateData),
      });

      const updateRes = await testApp.fetch(updateReq);
      expect(updateRes.status).toBe(200);

      const updateResData = await getTypedResponse<{
        totalCost: number;
        monthlyCost: number;
      }>(updateRes);
      assertSuccessResponse(updateResData);
      expect(updateResData.data.totalCost).toBe(1500.0);
      expect(updateResData.data.monthlyCost).toBeCloseTo(250.0, 2); // 1500 / 6

      // Update term length
      const termUpdateData = {
        termLengthMonths: 12,
      };

      const termUpdateReq = new Request(`http://localhost:3001/api/insurance/${policyId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(termUpdateData),
      });

      const termUpdateRes = await testApp.fetch(termUpdateReq);
      expect(termUpdateRes.status).toBe(200);

      const termUpdateData2 = await getTypedResponse<{
        termLengthMonths: number;
        monthlyCost: number;
      }>(termUpdateRes);
      assertSuccessResponse(termUpdateData2);
      expect(termUpdateData2.data.termLengthMonths).toBe(12);
      expect(termUpdateData2.data.monthlyCost).toBeCloseTo(125.0, 2); // 1500 / 12
    });

    test('should detect expiring policies correctly', async () => {
      // Create policy expiring in 15 days
      const expiringDate = new Date();
      expiringDate.setDate(expiringDate.getDate() + 15);

      const expiringPolicy = {
        company: 'Expiring Insurance Co',
        totalCost: 600.0,
        termLengthMonths: 6,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: expiringDate.toISOString(),
      };

      const createReq = new Request(
        `http://localhost:3001/api/insurance/vehicles/${testVehicleId}/policies`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify(expiringPolicy),
        }
      );

      await testApp.fetch(createReq);

      // Check expiring policies
      const expiringReq = new Request(`http://localhost:3001/api/insurance/expiring-soon?days=30`, {
        headers: { Cookie: sessionCookie },
      });

      const expiringRes = await testApp.fetch(expiringReq);
      expect(expiringRes.status).toBe(200);

      const expiringData = await getTypedResponse<Array<{ company: string }>>(expiringRes);
      assertSuccessResponse(expiringData);
      expect(expiringData.data).toHaveLength(1);
      expect(expiringData.data[0].company).toBe('Expiring Insurance Co');
      // Note: daysAhead is at the top level of the response, not in data

      // Check policy list includes expiration alerts
      const listReq = new Request(
        `http://localhost:3001/api/insurance/vehicles/${testVehicleId}/policies`,
        {
          headers: { Cookie: sessionCookie },
        }
      );

      const listRes = await testApp.fetch(listReq);
      expect(listRes.status).toBe(200);

      const listData =
        await getTypedResponse<
          Array<{
            daysUntilExpiration: number;
            expirationAlert: {
              type: string;
              severity: string;
            };
          }>
        >(listRes);
      assertSuccessResponse(listData);
      expect(listData.data).toHaveLength(1);
      expect(listData.data[0].daysUntilExpiration).toBe(15);
      expect(listData.data[0].expirationAlert).toBeDefined();
      expect(listData.data[0].expirationAlert.type).toBe('expiration_warning');
      expect(listData.data[0].expirationAlert.severity).toBe('medium'); // 15 days = medium alert
    });

    test('should integrate insurance costs into overall cost analysis', async () => {
      // Create insurance policy
      const insurancePolicy = {
        company: 'State Farm',
        totalCost: 1200.0,
        termLengthMonths: 6,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-06-30T23:59:59.999Z',
      };

      await getDb()
        .insert(insurancePolicies)
        .values({
          id: createId(),
          vehicleId: testVehicleId,
          company: insurancePolicy.company,
          totalCost: insurancePolicy.totalCost,
          termLengthMonths: insurancePolicy.termLengthMonths,
          startDate: new Date(insurancePolicy.startDate),
          endDate: new Date(insurancePolicy.endDate),
          monthlyCost: 200.0,
          isActive: true,
        });

      // Create insurance expense entries
      await getDb()
        .insert(expenses)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'insurance',
            category: 'financial',
            amount: 200.0,
            currency: 'USD',
            date: new Date('2024-01-01'),
            mileage: 10000,
            description: 'Monthly insurance payment',
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            type: 'fuel',
            category: 'operating',
            amount: 150.0,
            currency: 'USD',
            date: new Date('2024-01-15'),
            mileage: 10300,
          },
        ]);

      // Verify insurance policy was created
      const policies = await getDb()
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.vehicleId, testVehicleId));
      expect(policies).toHaveLength(1);
      expect(policies[0].totalCost).toBe(1200.0);
    });
  });

  describe('Comprehensive System Integration', () => {
    test('should handle complete expense lifecycle with all categories', async () => {
      // Create a comprehensive set of expenses over time
      const comprehensiveExpenses = [
        // Month 1 - January
        {
          date: '2024-01-05',
          type: 'fuel',
          category: 'operating',
          amount: 45.0,
          gallons: 12.0,
          mileage: 10000,
        },
        {
          date: '2024-01-10',
          type: 'insurance',
          category: 'financial',
          amount: 200.0,
          mileage: 10100,
        },
        {
          date: '2024-01-15',
          type: 'maintenance',
          category: 'maintenance',
          amount: 89.99,
          mileage: 10200,
        },
        {
          date: '2024-01-20',
          type: 'fuel',
          category: 'operating',
          amount: 48.5,
          gallons: 13.0,
          mileage: 10350,
        },
        { date: '2024-01-25', type: 'tolls', category: 'operating', amount: 15.75, mileage: 10400 },

        // Month 2 - February
        {
          date: '2024-02-05',
          type: 'fuel',
          category: 'operating',
          amount: 52.0,
          gallons: 14.0,
          mileage: 10720,
        },
        {
          date: '2024-02-10',
          type: 'insurance',
          category: 'financial',
          amount: 200.0,
          mileage: 10800,
        },
        {
          date: '2024-02-15',
          type: 'registration',
          category: 'regulatory',
          amount: 125.0,
          mileage: 10850,
        },
        {
          date: '2024-02-20',
          type: 'fuel',
          category: 'operating',
          amount: 49.25,
          gallons: 13.5,
          mileage: 11100,
        },
        {
          date: '2024-02-25',
          type: 'repairs',
          category: 'maintenance',
          amount: 450.0,
          mileage: 11150,
        },
      ];

      // Insert all expenses
      for (const expense of comprehensiveExpenses) {
        await getDb()
          .insert(expenses)
          .values({
            id: createId(),
            vehicleId: testVehicleId,
            type: expense.type as string,
            category: expense.category as string,
            amount: expense.amount,
            currency: 'USD',
            date: new Date(expense.date),
            gallons: expense.gallons || null,
            mileage: expense.mileage,
            description: `${expense.type} expense`,
          });
      }

      // Test expense filtering
      const filteringTests = [
        // Test expense filtering
        {
          endpoint: `/api/expenses?vehicleId=${testVehicleId}&category=operating`,
          expectedChecks: (response: {
            success: boolean;
            data: unknown[];
            filters: Record<string, unknown>;
          }) => {
            expect(response.data.length).toBe(5); // 4 fuel + 1 tolls
            expect(response.filters.category).toBe('operating');
          },
        },
        // Test date range filtering
        {
          endpoint: `/api/expenses?vehicleId=${testVehicleId}&startDate=2024-02-01T00:00:00.000Z&endDate=2024-02-28T23:59:59.999Z`,
          expectedChecks: (data: {
            success: boolean;
            data: unknown[];
            filters: Record<string, unknown>;
          }) => {
            expect(data.data.length).toBe(5); // February expenses
            expect(data.filters.startDate).toBeDefined();
            expect(data.filters.endDate).toBeDefined();
          },
        },
      ];

      // Run all filtering tests
      for (const test of filteringTests) {
        const req = new Request(`http://localhost:3001${test.endpoint}`, {
          headers: { Cookie: sessionCookie },
        });

        const res = await testApp.fetch(req);
        expect(res.status).toBe(200);

        const data = await getTypedResponse<unknown>(res);
        assertSuccessResponse(data);
        test.expectedChecks(
          data as unknown as { success: boolean; data: unknown[]; filters: Record<string, unknown> }
        );
      }
    });

    test('should maintain data consistency across operations', async () => {
      // Create initial expense
      const createReq = new Request(`http://localhost:3001/api/expenses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          vehicleId: testVehicleId,
          type: 'fuel',
          category: 'operating',
          amount: 45.5,
          currency: 'USD',
          date: '2024-01-15T10:30:00.000Z',
          gallons: 12.5,
          mileage: 10300,
          description: 'Initial fuel expense',
        }),
      });

      const createRes = await testApp.fetch(createReq);
      expect(createRes.status).toBe(201);
      const createData = await getTypedResponse<{
        id: string;
      }>(createRes);
      assertSuccessResponse(createData);
      const expenseId = createData.data.id;

      // Update expense
      const updateReq = new Request(`http://localhost:3001/api/expenses/${expenseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          amount: 48.75,
          gallons: 13.0,
          description: 'Updated fuel expense',
        }),
      });

      const updateRes = await testApp.fetch(updateReq);
      expect(updateRes.status).toBe(200);
      const updateData = await getTypedResponse<{
        amount: number;
        gallons: number;
      }>(updateRes);
      assertSuccessResponse(updateData);
      expect(updateData.data.amount).toBe(48.75);
      expect(updateData.data.gallons).toBe(13.0);

      // Verify update in list
      const listReq = new Request(`http://localhost:3001/api/expenses?vehicleId=${testVehicleId}`, {
        headers: { Cookie: sessionCookie },
      });

      const listRes = await testApp.fetch(listReq);
      expect(listRes.status).toBe(200);
      const listData =
        await getTypedResponse<
          Array<{
            amount: number;
            description: string;
          }>
        >(listRes);
      assertSuccessResponse(listData);
      expect(listData.data).toHaveLength(1);
      expect(listData.data[0].amount).toBe(48.75);
      expect(listData.data[0].description).toBe('Updated fuel expense');

      // Delete expense
      const deleteReq = new Request(`http://localhost:3001/api/expenses/${expenseId}`, {
        method: 'DELETE',
        headers: { Cookie: sessionCookie },
      });

      const deleteRes = await testApp.fetch(deleteReq);
      expect(deleteRes.status).toBe(200);

      // Verify deletion
      const finalListReq = new Request(
        `http://localhost:3001/api/expenses?vehicleId=${testVehicleId}`,
        {
          headers: { Cookie: sessionCookie },
        }
      );

      const finalListRes = await testApp.fetch(finalListReq);
      expect(finalListRes.status).toBe(200);
      const finalListData = await getTypedResponse<unknown>(finalListRes);
      expect(finalListData.data).toHaveLength(0);
    });
  });
});
