import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Vehicle, VehicleShare } from '../../db/schema';
import { sessions, users, vehicleShares, vehicles } from '../../db/schema';
import { errorHandler } from '../../lib/middleware/error-handler';
import { sharing as sharingRoutes } from '../../routes/sharing';
import { vehicles as vehicleRoutes } from '../../routes/vehicles';
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
testApp.route('/api/sharing', sharingRoutes);
testApp.route('/api/vehicles', vehicleRoutes);

describe('Vehicle Sharing System Integration Tests', () => {
  let _db: ReturnType<typeof getTestDatabase>;
  let ownerUserId: string;
  let ownerSessionId: string;
  let ownerSessionCookie: string;
  let sharedUserId: string;
  let sharedUserSessionId: string;
  let sharedUserSessionCookie: string;
  let testVehicleId: string;

  beforeAll(() => {
    _db = setupTestDatabase();
  });

  beforeEach(async () => {
    clearTestData();
    // Clean up test data
    await getDb().delete(vehicleShares);
    await getDb().delete(vehicles);
    await getDb().delete(sessions);
    await getDb().delete(users).where(eq(users.email, 'owner@example.com'));
    await getDb().delete(users).where(eq(users.email, 'shared@example.com'));

    // Create owner user
    ownerUserId = createId();
    await getDb().insert(users).values({
      id: ownerUserId,
      email: 'owner@example.com',
      displayName: 'Owner User',
      provider: 'google',
      providerId: 'google_owner_123',
    });

    // Create shared user
    sharedUserId = createId();
    await getDb().insert(users).values({
      id: sharedUserId,
      email: 'shared@example.com',
      displayName: 'Shared User',
      provider: 'google',
      providerId: 'google_shared_123',
    });

    // Create sessions for both users
    const lucia = getTestLucia();
    const ownerSession = await lucia.createSession(ownerUserId, {});
    ownerSessionId = ownerSession.id;
    ownerSessionCookie = lucia.createSessionCookie(ownerSessionId).serialize();

    const sharedUserSession = await lucia.createSession(sharedUserId, {});
    sharedUserSessionId = sharedUserSession.id;
    sharedUserSessionCookie = lucia.createSessionCookie(sharedUserSessionId).serialize();

    // Create a test vehicle for the owner
    const vehicle = await getDb()
      .insert(vehicles)
      .values({
        id: createId(),
        userId: ownerUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        licensePlate: 'SHARE123',
      })
      .returning();

    testVehicleId = vehicle[0].id;
  });

  afterAll(() => {
    teardownTestDatabase();
  });

  describe('Share Invitation Creation', () => {
    test('should create a share invitation', async () => {
      const shareData = {
        vehicleId: testVehicleId,
        sharedWithEmail: 'shared@example.com',
        permission: 'view',
      };

      const req = new Request('http://localhost:3001/api/sharing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerSessionCookie,
        },
        body: JSON.stringify(shareData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await getTypedResponse<VehicleShare>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data.vehicleId).toBe(testVehicleId);
        expect(data.data.ownerId).toBe(ownerUserId);
        expect(data.data.sharedWithUserId).toBe(sharedUserId);
        expect(data.data.permission).toBe('view');
        expect(data.data.status).toBe('pending');
      }
      expect(data.message).toContain('invitation sent');
    });

    test('should create a share invitation with edit permission', async () => {
      const shareData = {
        vehicleId: testVehicleId,
        sharedWithEmail: 'shared@example.com',
        permission: 'edit',
      };

      const req = new Request('http://localhost:3001/api/sharing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerSessionCookie,
        },
        body: JSON.stringify(shareData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(201);

      const data = await getTypedResponse<VehicleShare>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data.permission).toBe('edit');
      }
    });

    test('should reject sharing with non-existent user', async () => {
      const shareData = {
        vehicleId: testVehicleId,
        sharedWithEmail: 'nonexistent@example.com',
        permission: 'view',
      };

      const req = new Request('http://localhost:3001/api/sharing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerSessionCookie,
        },
        body: JSON.stringify(shareData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(404);

      const data = await getTypedResponse<null>(res);
      expect(data.message).toContain('User with this email');
    });

    test('should reject sharing with self', async () => {
      const shareData = {
        vehicleId: testVehicleId,
        sharedWithEmail: 'owner@example.com',
        permission: 'view',
      };

      const req = new Request('http://localhost:3001/api/sharing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerSessionCookie,
        },
        body: JSON.stringify(shareData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(409);

      const data = await getTypedResponse<null>(res);
      expect(data.message).toContain('Cannot share vehicle with yourself');
    });

    test('should reject sharing non-owned vehicle', async () => {
      const shareData = {
        vehicleId: testVehicleId,
        sharedWithEmail: 'owner@example.com',
        permission: 'view',
      };

      const req = new Request('http://localhost:3001/api/sharing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sharedUserSessionCookie, // Using shared user's session
        },
        body: JSON.stringify(shareData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(404);
    });

    test('should reject duplicate pending invitation', async () => {
      // Create first invitation
      const shareData = {
        vehicleId: testVehicleId,
        sharedWithEmail: 'shared@example.com',
        permission: 'view',
      };

      const req1 = new Request('http://localhost:3001/api/sharing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerSessionCookie,
        },
        body: JSON.stringify(shareData),
      });

      const res1 = await testApp.fetch(req1);
      expect(res1.status).toBe(201);

      // Try to create duplicate invitation
      const req2 = new Request('http://localhost:3001/api/sharing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerSessionCookie,
        },
        body: JSON.stringify(shareData),
      });

      const res2 = await testApp.fetch(req2);
      expect(res2.status).toBe(409);

      const data = await getTypedResponse<null>(res2);
      expect(data.message).toContain('pending invitation already exists');
    });

    test('should validate permission values', async () => {
      const shareData = {
        vehicleId: testVehicleId,
        sharedWithEmail: 'shared@example.com',
        permission: 'invalid',
      };

      const req = new Request('http://localhost:3001/api/sharing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerSessionCookie,
        },
        body: JSON.stringify(shareData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(400);
    });
  });

  describe('Share Invitation Management', () => {
    let shareId: string;

    beforeEach(async () => {
      // Create a pending share invitation
      const share = await getDb()
        .insert(vehicleShares)
        .values({
          id: createId(),
          vehicleId: testVehicleId,
          ownerId: ownerUserId,
          sharedWithUserId: sharedUserId,
          permission: 'view',
          status: 'pending',
        })
        .returning();

      shareId = share[0].id;
    });

    test('should get pending invitations', async () => {
      const req = new Request('http://localhost:3001/api/sharing/invitations', {
        headers: {
          Cookie: sharedUserSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<VehicleShare[]>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data).toHaveLength(1);
        expect(data.data[0].id).toBe(shareId);
        expect(data.data[0].status).toBe('pending');
      }
    });

    test('should accept share invitation', async () => {
      const req = new Request(`http://localhost:3001/api/sharing/${shareId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sharedUserSessionCookie,
        },
        body: JSON.stringify({ status: 'accepted' }),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<VehicleShare>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data.status).toBe('accepted');
      }
      expect(data.message).toContain('accepted');
    });

    test('should decline share invitation', async () => {
      const req = new Request(`http://localhost:3001/api/sharing/${shareId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sharedUserSessionCookie,
        },
        body: JSON.stringify({ status: 'declined' }),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<VehicleShare>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data.status).toBe('declined');
      }
      expect(data.message).toContain('declined');
    });

    test('should reject responding to already accepted invitation', async () => {
      // First accept the invitation
      await getDb()
        .update(vehicleShares)
        .set({ status: 'accepted' })
        .where(eq(vehicleShares.id, shareId));

      // Try to respond again
      const req = new Request(`http://localhost:3001/api/sharing/${shareId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sharedUserSessionCookie,
        },
        body: JSON.stringify({ status: 'accepted' }),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(409);

      const data = await getTypedResponse<null>(res);
      expect(data.message).toContain('already been accepted');
    });

    test('should reject non-recipient responding to invitation', async () => {
      const req = new Request(`http://localhost:3001/api/sharing/${shareId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerSessionCookie, // Owner trying to respond
        },
        body: JSON.stringify({ status: 'accepted' }),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(403);

      const data = await getTypedResponse<null>(res);
      expect(data.message).toContain('only respond to invitations sent to you');
    });
  });

  describe('Share Listing and Retrieval', () => {
    let anotherUserId: string;

    beforeEach(async () => {
      // Create another user for testing
      anotherUserId = createId();
      await getDb().insert(users).values({
        id: anotherUserId,
        email: 'another@example.com',
        displayName: 'Another User',
        provider: 'google',
        providerId: 'google_another_123',
      });

      // Create multiple shares with different statuses
      await getDb()
        .insert(vehicleShares)
        .values([
          {
            id: createId(),
            vehicleId: testVehicleId,
            ownerId: ownerUserId,
            sharedWithUserId: sharedUserId,
            permission: 'view',
            status: 'accepted',
          },
          {
            id: createId(),
            vehicleId: testVehicleId,
            ownerId: ownerUserId,
            sharedWithUserId: anotherUserId,
            permission: 'edit',
            status: 'pending',
          },
        ]);
    });

    test('should get shares sent by owner', async () => {
      const req = new Request('http://localhost:3001/api/sharing/sent', {
        headers: {
          Cookie: ownerSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<VehicleShare[]>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data).toHaveLength(2);
      }
    });

    test('should get vehicles shared with user', async () => {
      const req = new Request('http://localhost:3001/api/sharing/received', {
        headers: {
          Cookie: sharedUserSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<VehicleShare[]>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data).toHaveLength(1); // Only accepted shares
        expect(data.data[0].status).toBe('accepted');
      }
    });

    test('should get shares for specific vehicle', async () => {
      const req = new Request(`http://localhost:3001/api/sharing/vehicle/${testVehicleId}`, {
        headers: {
          Cookie: ownerSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<VehicleShare[]>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data).toHaveLength(2);
      }
    });

    test('should reject non-owner viewing vehicle shares', async () => {
      const req = new Request(`http://localhost:3001/api/sharing/vehicle/${testVehicleId}`, {
        headers: {
          Cookie: sharedUserSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(403);
    });
  });

  describe('Share Deletion', () => {
    let shareId: string;

    beforeEach(async () => {
      const share = await getDb()
        .insert(vehicleShares)
        .values({
          id: createId(),
          vehicleId: testVehicleId,
          ownerId: ownerUserId,
          sharedWithUserId: sharedUserId,
          permission: 'view',
          status: 'accepted',
        })
        .returning();

      shareId = share[0].id;
    });

    test('should allow owner to delete share', async () => {
      const req = new Request(`http://localhost:3001/api/sharing/${shareId}`, {
        method: 'DELETE',
        headers: {
          Cookie: ownerSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<null>(res);
      assertSuccessResponse(data);
      expect(data.message).toContain('removed successfully');

      // Verify share is deleted
      const shares = await getDb()
        .select()
        .from(vehicleShares)
        .where(eq(vehicleShares.id, shareId));
      expect(shares).toHaveLength(0);
    });

    test('should allow shared user to delete share', async () => {
      const req = new Request(`http://localhost:3001/api/sharing/${shareId}`, {
        method: 'DELETE',
        headers: {
          Cookie: sharedUserSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<null>(res);
      assertSuccessResponse(data);
      expect(data.message).toContain('removed successfully');
    });

    test('should reject unauthorized user deleting share', async () => {
      // Create another user
      const otherUserId = createId();
      await getDb().insert(users).values({
        id: otherUserId,
        email: 'other@example.com',
        displayName: 'Other User',
        provider: 'google',
        providerId: 'google_other_123',
      });

      const lucia = getTestLucia();
      const otherSession = await lucia.createSession(otherUserId, {});
      const otherSessionCookie = lucia.createSessionCookie(otherSession.id).serialize();

      const req = new Request(`http://localhost:3001/api/sharing/${shareId}`, {
        method: 'DELETE',
        headers: {
          Cookie: otherSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(403);
    });
  });

  describe('Shared Vehicle Access', () => {
    beforeEach(async () => {
      // Create an accepted share
      await getDb().insert(vehicleShares).values({
        id: createId(),
        vehicleId: testVehicleId,
        ownerId: ownerUserId,
        sharedWithUserId: sharedUserId,
        permission: 'view',
        status: 'accepted',
      });
    });

    test('should allow shared user to view vehicle', async () => {
      const req = new Request(`http://localhost:3001/api/vehicles/${testVehicleId}`, {
        headers: {
          Cookie: sharedUserSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<Vehicle>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data.id).toBe(testVehicleId);
      }
    });

    test('should list shared vehicles for user', async () => {
      const req = new Request('http://localhost:3001/api/vehicles', {
        headers: {
          Cookie: sharedUserSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<Vehicle[]>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data).toHaveLength(1);
        expect(data.data[0].id).toBe(testVehicleId);
      }
    });

    test('should not allow view-only user to edit vehicle', async () => {
      const updateData = {
        nickname: 'Updated Nickname',
      };

      const req = new Request(`http://localhost:3001/api/vehicles/${testVehicleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sharedUserSessionCookie,
        },
        body: JSON.stringify(updateData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(403); // Forbidden - user has view-only access

      const data = await getTypedResponse<null>(res);
      expect(data.message).toContain('do not have permission to edit');
    });

    test('should allow edit permission user to modify vehicle', async () => {
      // Update share to edit permission
      await getDb()
        .update(vehicleShares)
        .set({ permission: 'edit' })
        .where(
          eq(vehicleShares.vehicleId, testVehicleId) &&
            eq(vehicleShares.sharedWithUserId, sharedUserId)
        );

      const updateData = {
        nickname: 'Updated by Shared User',
      };

      const req = new Request(`http://localhost:3001/api/vehicles/${testVehicleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sharedUserSessionCookie,
        },
        body: JSON.stringify(updateData),
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(200);

      const data = await getTypedResponse<Vehicle>(res);
      assertSuccessResponse(data);
      expect(data.data).toBeDefined();
      if (data.data) {
        expect(data.data.nickname).toBe('Updated by Shared User');
      }
    });

    test('should not allow shared user to delete vehicle', async () => {
      // Even with edit permission, shared users should not be able to delete
      await getDb()
        .update(vehicleShares)
        .set({ permission: 'edit' })
        .where(
          eq(vehicleShares.vehicleId, testVehicleId) &&
            eq(vehicleShares.sharedWithUserId, sharedUserId)
        );

      const req = new Request(`http://localhost:3001/api/vehicles/${testVehicleId}`, {
        method: 'DELETE',
        headers: {
          Cookie: sharedUserSessionCookie,
        },
      });

      const res = await testApp.fetch(req);
      expect(res.status).toBe(404); // Vehicle not found (only owner can delete)
    });
  });

  describe('Authentication and Authorization', () => {
    test('should require authentication for all sharing operations', async () => {
      const requests = [
        new Request('http://localhost:3001/api/sharing', { method: 'POST' }),
        new Request('http://localhost:3001/api/sharing/invitations'),
        new Request('http://localhost:3001/api/sharing/sent'),
        new Request('http://localhost:3001/api/sharing/received'),
        new Request('http://localhost:3001/api/sharing/test-id/status', { method: 'PUT' }),
        new Request('http://localhost:3001/api/sharing/test-id', { method: 'DELETE' }),
      ];

      for (const req of requests) {
        const res = await testApp.fetch(req);
        expect(res.status).toBe(401);
      }
    });
  });
});
