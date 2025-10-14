import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { lucia } from '../../lib/auth/lucia';
import { databaseService } from '../../lib/database';
import { users, sessions, vehicles, insurancePolicies } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { insurance as insuranceRoutes } from '../../routes/insurance';
import { errorHandler } from '../../lib/middleware/error-handler';

// Test app setup
const testApp = new Hono();
testApp.onError(errorHandler);
testApp.route('/api/insurance', insuranceRoutes);

describe('Insurance Policy Management API Integration Tests', () => {
  const db = databaseService.getDatabase();
  let testUserId: string;
  let testSessionId: string;
  let sessionCookie: string;
  let testVehicleId: string;

  beforeAll(async () => {
    // Ensure database is initialized
    await databaseService.healthCheck();
  });

  beforeEach(async () => {
    // Clean up test data
    await db.delete(insurancePolicies);
    await db.delete(vehicles);
    await db.delete(sessions);
    await db.delete(users).where(eq(users.email, 'test@example.com'));

    // Create a test user
    testUserId = createId();
    await db.insert(users).values({
      id: testUserId,
      email: 'test@example.com',
      displayName: 'Test User',
      provider: 'google',
      providerId: 'google_test_123',
    });

    // Create a test session
    const session = await lucia.createSession(testUserId, {});
    testSessionId = session.id;
    sessionCookie = lucia.createSessionCookie(testSessionId).serialize();

    // Create a test vehicle
    const vehicle = await db.insert(vehicles).values({
      id: createId(),
      userId: testUserId,
      make: 'Toyota',
      model: 'Camry',
      year: 2020,
    }).returning();

    testVehicleId = vehicle[0].id;
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(insurancePolicies);
    await db.delete(vehicles);
    await db.delete(sessions);
    await db.delete(users).where(eq(users.email, 'test@example.com'));
  });  
describe('Insurance Policy CRUD Operations', () => {
    test('should create a new insurance policy', async () => {
      const policyData = {
        company: 'State Farm',
        policyNumber: 'SF123456789',
        totalCost: 1200.00,
        termLengthMonths: 6,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-06-30T23:59:59.999Z',
      };

      const req = new Request(`http://localhost:3001/api/insurance/vehicles/${testVehicleId}/policies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(policyData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.company).toBe('State Farm');
      expect(data.data.totalCost).toBe(1200.00);
      expect(data.data.termLengthMonths).toBe(6);
      expect(data.data.monthlyCost).toBe(200.00); // 1200 / 6
      expect(data.data.vehicleId).toBe(testVehicleId);
      expect(data.data.isActive).toBe(true);
      expect(data.message).toContain('created successfully');
    });

    test('should reject policy with invalid date range', async () => {
      const invalidPolicyData = {
        company: 'State Farm',
        totalCost: 1200.00,
        termLengthMonths: 6,
        startDate: '2024-06-30T00:00:00.000Z',
        endDate: '2024-01-01T00:00:00.000Z', // End date before start date
      };

      const req = new Request(`http://localhost:3001/api/insurance/vehicles/${testVehicleId}/policies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(invalidPolicyData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.message).toContain('End date must be after start date');
    });

    test('should list vehicle insurance policies', async () => {
      // Create test policies
      const policy1 = await db.insert(insurancePolicies).values({
        id: createId(),
        vehicleId: testVehicleId,
        company: 'State Farm',
        totalCost: 1200.00,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 200.00,
        isActive: true,
      }).returning();

      const policy2 = await db.insert(insurancePolicies).values({
        id: createId(),
        vehicleId: testVehicleId,
        company: 'Geico',
        totalCost: 1000.00,
        termLengthMonths: 12,
        startDate: new Date('2024-07-01'),
        endDate: new Date('2025-06-30'),
        monthlyCost: 83.33,
        isActive: true,
      }).returning();

      const req = new Request(`http://localhost:3001/api/insurance/vehicles/${testVehicleId}/policies`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.count).toBe(2);
      expect(data.data[0].daysUntilExpiration).toBeDefined();
      expect(data.data[0].expirationAlert).toBeDefined();
    });

    test('should get specific insurance policy', async () => {
      // Create test policy
      const policy = await db.insert(insurancePolicies).values({
        id: createId(),
        vehicleId: testVehicleId,
        company: 'State Farm',
        policyNumber: 'SF123456789',
        totalCost: 1200.00,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 200.00,
        isActive: true,
      }).returning();

      const req = new Request(`http://localhost:3001/api/insurance/${policy[0].id}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(policy[0].id);
      expect(data.data.company).toBe('State Farm');
      expect(data.data.policyNumber).toBe('SF123456789');
    });    
test('should update insurance policy', async () => {
      // Create test policy
      const policy = await db.insert(insurancePolicies).values({
        id: createId(),
        vehicleId: testVehicleId,
        company: 'State Farm',
        totalCost: 1200.00,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 200.00,
        isActive: true,
      }).returning();

      const updateData = {
        totalCost: 1100.00,
        company: 'State Farm Updated',
      };

      const req = new Request(`http://localhost:3001/api/insurance/${policy[0].id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(updateData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.totalCost).toBe(1100.00);
      expect(data.data.company).toBe('State Farm Updated');
      expect(data.data.monthlyCost).toBeCloseTo(183.33, 2); // 1100 / 6
      expect(data.message).toContain('updated successfully');
    });

    test('should delete insurance policy', async () => {
      // Create test policy
      const policy = await db.insert(insurancePolicies).values({
        id: createId(),
        vehicleId: testVehicleId,
        company: 'State Farm',
        totalCost: 1200.00,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 200.00,
        isActive: true,
      }).returning();

      const req = new Request(`http://localhost:3001/api/insurance/${policy[0].id}`, {
        method: 'DELETE',
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('deleted successfully');

      // Verify policy is deleted
      const checkReq = new Request(`http://localhost:3001/api/insurance/${policy[0].id}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const checkRes = await testApp.fetch(checkReq);
      expect(checkRes.status).toBe(404);
    });

    test('should return 404 for non-existent policy', async () => {
      const nonExistentId = createId();

      const req = new Request(`http://localhost:3001/api/insurance/${nonExistentId}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.message).toContain('not found');
    });
  });

  describe('Monthly Cost Breakdown and Alerts', () => {
    test('should calculate monthly cost breakdown', async () => {
      // Create test policy
      const policy = await db.insert(insurancePolicies).values({
        id: createId(),
        vehicleId: testVehicleId,
        company: 'State Farm',
        totalCost: 1200.00,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 200.00,
        isActive: true,
      }).returning();

      const req = new Request(`http://localhost:3001/api/insurance/${policy[0].id}/monthly-breakdown`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.policyId).toBe(policy[0].id);
      expect(data.data.company).toBe('State Farm');
      expect(data.data.totalCost).toBe(1200.00);
      expect(data.data.monthlyCost).toBe(200.00);
      expect(data.data.breakdown).toHaveLength(6);
      expect(data.data.breakdown[0].month).toBe(1);
      expect(data.data.breakdown[0].cost).toBe(200.00);
      expect(data.data.breakdown[0].monthName).toContain('January');
    });

    test('should detect expiring policies', async () => {
      // Create policy expiring soon
      const expiringDate = new Date();
      expiringDate.setDate(expiringDate.getDate() + 15); // Expires in 15 days

      const policy = await db.insert(insurancePolicies).values({
        id: createId(),
        vehicleId: testVehicleId,
        company: 'State Farm',
        totalCost: 1200.00,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: expiringDate,
        monthlyCost: 200.00,
        isActive: true,
      }).returning();

      const req = new Request(`http://localhost:3001/api/insurance/expiring-soon?days=30`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe(policy[0].id);
      expect(data.daysAhead).toBe(30);
    });

    test('should show expiration alerts in policy list', async () => {
      // Create policy expiring in 5 days (high alert)
      const expiringDate = new Date();
      expiringDate.setDate(expiringDate.getDate() + 5);

      await db.insert(insurancePolicies).values({
        id: createId(),
        vehicleId: testVehicleId,
        company: 'State Farm',
        totalCost: 1200.00,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: expiringDate,
        monthlyCost: 200.00,
        isActive: true,
      });

      const req = new Request(`http://localhost:3001/api/insurance/vehicles/${testVehicleId}/policies`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].daysUntilExpiration).toBe(5);
      expect(data.data[0].expirationAlert).toBeDefined();
      expect(data.data[0].expirationAlert.type).toBe('expiration_warning');
      expect(data.data[0].expirationAlert.severity).toBe('high');
    });
  });
});