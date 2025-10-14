import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { lucia } from '../../lib/auth/lucia';
import { databaseService } from '../../lib/database';
import { users, sessions, vehicles, vehicleLoans, loanPayments } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { vehicles as vehicleRoutes } from '../../routes/vehicles';
import { loans as loanRoutes } from '../../routes/loans';
import { errorHandler } from '../../lib/middleware/error-handler';

// Test app setup
const testApp = new Hono();
testApp.onError(errorHandler);
testApp.route('/api/vehicles', vehicleRoutes);
testApp.route('/api/loans', loanRoutes);

describe('Vehicle Management API Integration Tests', () => {
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
    await db.delete(loanPayments);
    await db.delete(vehicleLoans);
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
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(loanPayments);
    await db.delete(vehicleLoans);
    await db.delete(vehicles);
    await db.delete(sessions);
    await db.delete(users).where(eq(users.email, 'test@example.com'));
  });

  describe('Vehicle CRUD Operations', () => {
    test('should create a new vehicle', async () => {
      const vehicleData = {
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        licensePlate: 'TEST123',
        nickname: 'Test Car',
        initialMileage: 25000,
        purchasePrice: 22000,
        purchaseDate: '2020-03-15T00:00:00.000Z',
      };

      const req = new Request('http://localhost:3001/api/vehicles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(vehicleData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.make).toBe('Toyota');
      expect(data.data.model).toBe('Camry');
      expect(data.data.year).toBe(2020);
      expect(data.data.userId).toBe(testUserId);
      expect(data.message).toContain('created successfully');

      testVehicleId = data.data.id;
    });

    test('should reject vehicle creation with invalid data', async () => {
      const invalidVehicleData = {
        make: '', // Empty make should fail validation
        model: 'Camry',
        year: 1800, // Year too old should fail validation
      };

      const req = new Request('http://localhost:3001/api/vehicles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(invalidVehicleData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(400);
    });

    test('should reject duplicate license plate', async () => {
      // Create first vehicle
      const vehicleData1 = {
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        licensePlate: 'DUPLICATE123',
      };

      const req1 = new Request('http://localhost:3001/api/vehicles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(vehicleData1),
      });

      const res1 = await testApp.fetch(req1);
      expect(res1.status).toBe(201);

      // Try to create second vehicle with same license plate
      const vehicleData2 = {
        make: 'Honda',
        model: 'Civic',
        year: 2021,
        licensePlate: 'DUPLICATE123',
      };

      const req2 = new Request('http://localhost:3001/api/vehicles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(vehicleData2),
      });

      const res2 = await testApp.fetch(req2);
      expect(res2.status).toBe(409);

      const data = await res2.json();
      expect(data.message).toContain('license plate already exists');
    });

    test('should list user vehicles', async () => {
      // Create test vehicles
      const vehicle1 = await db.insert(vehicles).values({
        id: createId(),
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      }).returning();

      const vehicle2 = await db.insert(vehicles).values({
        id: createId(),
        userId: testUserId,
        make: 'Honda',
        model: 'Civic',
        year: 2021,
      }).returning();

      const req = new Request('http://localhost:3001/api/vehicles', {
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
      expect(data.data[0].userId).toBe(testUserId);
      expect(data.data[1].userId).toBe(testUserId);
    });

    test('should get specific vehicle', async () => {
      // Create test vehicle
      const vehicle = await db.insert(vehicles).values({
        id: createId(),
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        licensePlate: 'GET123',
      }).returning();

      testVehicleId = vehicle[0].id;

      const req = new Request(`http://localhost:3001/api/vehicles/${testVehicleId}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(testVehicleId);
      expect(data.data.make).toBe('Toyota');
      expect(data.data.licensePlate).toBe('GET123');
    });

    test('should return 404 for non-existent vehicle', async () => {
      const nonExistentId = createId();

      const req = new Request(`http://localhost:3001/api/vehicles/${nonExistentId}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.message).toContain('not found');
    });

    test('should update vehicle', async () => {
      // Create test vehicle
      const vehicle = await db.insert(vehicles).values({
        id: createId(),
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      }).returning();

      testVehicleId = vehicle[0].id;

      const updateData = {
        nickname: 'Updated Nickname',
        initialMileage: 30000,
      };

      const req = new Request(`http://localhost:3001/api/vehicles/${testVehicleId}`, {
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
      expect(data.data.nickname).toBe('Updated Nickname');
      expect(data.data.initialMileage).toBe(30000);
      expect(data.message).toContain('updated successfully');
    });

    test('should delete vehicle', async () => {
      // Create test vehicle
      const vehicle = await db.insert(vehicles).values({
        id: createId(),
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      }).returning();

      testVehicleId = vehicle[0].id;

      const req = new Request(`http://localhost:3001/api/vehicles/${testVehicleId}`, {
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

      // Verify vehicle is deleted
      const checkReq = new Request(`http://localhost:3001/api/vehicles/${testVehicleId}`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const checkRes = await testApp.fetch(checkReq);
      expect(checkRes.status).toBe(404);
    });

    test('should require authentication for all vehicle operations', async () => {
      const requests = [
        new Request('http://localhost:3001/api/vehicles'),
        new Request('http://localhost:3001/api/vehicles', { method: 'POST' }),
        new Request('http://localhost:3001/api/vehicles/test-id'),
        new Request('http://localhost:3001/api/vehicles/test-id', { method: 'PUT' }),
        new Request('http://localhost:3001/api/vehicles/test-id', { method: 'DELETE' }),
      ];

      for (const req of requests) {
        const res = await testApp.fetch(req);
        expect(res.status).toBe(401);
      }
    });
  });

  describe('Loan Management Operations', () => {
    beforeEach(async () => {
      // Create test vehicle for loan tests
      const vehicle = await db.insert(vehicles).values({
        id: createId(),
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      }).returning();

      testVehicleId = vehicle[0].id;
    });

    test('should create loan for vehicle', async () => {
      const loanData = {
        lender: 'Test Bank',
        originalAmount: 20000,
        apr: 4.5,
        termMonths: 60,
        startDate: '2020-03-15T00:00:00.000Z',
        paymentAmount: 372.86,
        paymentFrequency: 'monthly',
        paymentDayOfMonth: 15,
      };

      const req = new Request(`http://localhost:3001/api/loans/vehicles/${testVehicleId}/loan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(loanData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.lender).toBe('Test Bank');
      expect(data.data.originalAmount).toBe(20000);
      expect(data.data.currentBalance).toBe(20000);
      expect(data.data.isActive).toBe(true);
      expect(data.message).toContain('created successfully');
    });

    test('should reject loan with invalid terms', async () => {
      const invalidLoanData = {
        lender: 'Test Bank',
        originalAmount: -1000, // Negative amount should fail
        apr: 4.5,
        termMonths: 60,
        startDate: '2020-03-15T00:00:00.000Z',
        paymentAmount: 372.86,
      };

      const req = new Request(`http://localhost:3001/api/loans/vehicles/${testVehicleId}/loan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(invalidLoanData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(400);
    });

    test('should get loan for vehicle', async () => {
      // Create test loan
      const loan = await db.insert(vehicleLoans).values({
        id: createId(),
        vehicleId: testVehicleId,
        lender: 'Test Bank',
        originalAmount: 20000,
        currentBalance: 15000,
        apr: 4.5,
        termMonths: 60,
        startDate: new Date('2020-03-15'),
        paymentAmount: 372.86,
        paymentFrequency: 'monthly',
        paymentDayOfMonth: 15,
      }).returning();

      const req = new Request(`http://localhost:3001/api/loans/vehicles/${testVehicleId}/loan`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(loan[0].id);
      expect(data.data.lender).toBe('Test Bank');
      expect(data.data.currentBalance).toBe(15000);
    });

    test('should generate amortization schedule', async () => {
      // Create test loan
      const loan = await db.insert(vehicleLoans).values({
        id: createId(),
        vehicleId: testVehicleId,
        lender: 'Test Bank',
        originalAmount: 20000,
        currentBalance: 20000,
        apr: 4.5,
        termMonths: 60,
        startDate: new Date('2020-03-15'),
        paymentAmount: 372.86,
        paymentFrequency: 'monthly',
      }).returning();

      const req = new Request(`http://localhost:3001/api/loans/${loan[0].id}/schedule`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.analysis).toBeDefined();
      expect(data.data.schedule).toBeDefined();
      expect(data.data.schedule).toHaveLength(60);
      expect(data.data.analysis.monthlyPayment).toBeCloseTo(372.86, 2);
      expect(data.data.analysis.totalInterest).toBeGreaterThan(0);
    });

    test('should record loan payment', async () => {
      // Create test loan
      const loan = await db.insert(vehicleLoans).values({
        id: createId(),
        vehicleId: testVehicleId,
        lender: 'Test Bank',
        originalAmount: 20000,
        currentBalance: 20000,
        apr: 4.5,
        termMonths: 60,
        startDate: new Date('2020-03-15'),
        paymentAmount: 372.86,
        paymentFrequency: 'monthly',
      }).returning();

      const paymentData = {
        paymentAmount: 372.86,
        paymentDate: '2020-04-15T00:00:00.000Z',
        paymentType: 'standard',
      };

      const req = new Request(`http://localhost:3001/api/loans/${loan[0].id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(paymentData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.payment).toBeDefined();
      expect(data.data.payment.paymentAmount).toBe(372.86);
      expect(data.data.payment.paymentNumber).toBe(1);
      expect(data.data.loan.currentBalance).toBeLessThan(20000);
      expect(data.message).toContain('recorded successfully');
    });

    test('should get payment history', async () => {
      // Create test loan
      const loan = await db.insert(vehicleLoans).values({
        id: createId(),
        vehicleId: testVehicleId,
        lender: 'Test Bank',
        originalAmount: 20000,
        currentBalance: 19000,
        apr: 4.5,
        termMonths: 60,
        startDate: new Date('2020-03-15'),
        paymentAmount: 372.86,
        paymentFrequency: 'monthly',
      }).returning();

      // Create test payment
      await db.insert(loanPayments).values({
        id: createId(),
        loanId: loan[0].id,
        paymentDate: new Date('2020-04-15'),
        paymentAmount: 372.86,
        principalAmount: 297.86,
        interestAmount: 75.00,
        remainingBalance: 19702.14,
        paymentNumber: 1,
        paymentType: 'standard',
      });

      const req = new Request(`http://localhost:3001/api/loans/${loan[0].id}/payments`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.payments).toHaveLength(1);
      expect(data.data.paymentCount).toBe(1);
      expect(data.data.payments[0].paymentAmount).toBe(372.86);
    });

    test('should mark loan as paid off', async () => {
      // Create test loan
      const loan = await db.insert(vehicleLoans).values({
        id: createId(),
        vehicleId: testVehicleId,
        lender: 'Test Bank',
        originalAmount: 20000,
        currentBalance: 1000,
        apr: 4.5,
        termMonths: 60,
        startDate: new Date('2020-03-15'),
        paymentAmount: 372.86,
        paymentFrequency: 'monthly',
        isActive: true,
      }).returning();

      const req = new Request(`http://localhost:3001/api/loans/${loan[0].id}`, {
        method: 'DELETE',
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('paid off successfully');
    });

    test('should prevent access to other users\' loans', async () => {
      // Create another user and vehicle
      const otherUserId = createId();
      
      // Clean up any existing user with this email first
      await db.delete(users).where(eq(users.email, 'other@example.com'));
      
      await db.insert(users).values({
        id: otherUserId,
        email: 'other@example.com',
        displayName: 'Other User',
        provider: 'google',
        providerId: 'google_other_123',
      });

      const otherVehicle = await db.insert(vehicles).values({
        id: createId(),
        userId: otherUserId,
        make: 'Honda',
        model: 'Civic',
        year: 2021,
      }).returning();

      const otherLoan = await db.insert(vehicleLoans).values({
        id: createId(),
        vehicleId: otherVehicle[0].id,
        lender: 'Other Bank',
        originalAmount: 15000,
        currentBalance: 15000,
        apr: 5.0,
        termMonths: 48,
        startDate: new Date('2021-01-01'),
        paymentAmount: 345.44,
        paymentFrequency: 'monthly',
      }).returning();

      // Try to access other user's loan
      const req = new Request(`http://localhost:3001/api/loans/${otherLoan[0].id}/schedule`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(404);
    });
  });

  describe('Data Validation and Error Handling', () => {
    test('should validate vehicle year range', async () => {
      const futureYear = new Date().getFullYear() + 2;
      const vehicleData = {
        make: 'Toyota',
        model: 'Camry',
        year: futureYear,
      };

      const req = new Request('http://localhost:3001/api/vehicles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(vehicleData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(400);
    });

    test('should validate loan APR range', async () => {
      // Create test vehicle
      const vehicle = await db.insert(vehicles).values({
        id: createId(),
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      }).returning();

      const loanData = {
        lender: 'Test Bank',
        originalAmount: 20000,
        apr: 100, // Invalid APR > 50%
        termMonths: 60,
        startDate: '2020-03-15T00:00:00.000Z',
        paymentAmount: 372.86,
      };

      const req = new Request(`http://localhost:3001/api/loans/vehicles/${vehicle[0].id}/loan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify(loanData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(400);
    });

    test('should handle malformed JSON', async () => {
      const req = new Request('http://localhost:3001/api/vehicles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: 'invalid json',
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(400);
    });
  });
});