import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { Hono } from 'hono';
import { sessions, users } from '../../db/schema';
import { requireAuth } from '../../lib/middleware/auth';
import { errorHandler } from '../../lib/middleware/error-handler';
import { auth } from '../../routes/auth';
import type { AuthResponse, LogoutResponse } from '../../types/api';
import { getTestLucia } from '../lucia-test.js';
import {
  clearTestData,
  type getTestDatabase,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup.js';
import { getDb, getDirectResponse } from '../utils/test-helpers.js';

// Test app setup
const testApp = new Hono();
testApp.onError(errorHandler);
testApp.route('/auth', auth);
testApp.get('/protected', requireAuth, (c) => {
  const user = c.get('user');
  return c.json({ user: { id: user.id, email: user.email } });
});

describe('Authentication Integration Tests', () => {
  let _db: ReturnType<typeof getTestDatabase>;
  let testUserId: string;
  let testSessionId: string;

  beforeAll(() => {
    _db = setupTestDatabase();
  });

  beforeEach(() => {
    clearTestData();
  });

  afterAll(() => {
    teardownTestDatabase();
  });

  describe('OAuth Flow Tests', () => {
    test('should initiate Google OAuth flow', async () => {
      const req = new Request('http://localhost:3001/auth/login/google');
      const res = await testApp.fetch(req);

      expect(res.status).toBe(302);

      const location = res.headers.get('Location');
      expect(location).toBeTruthy();
      expect(location).toContain('accounts.google.com');
      expect(location).toContain('oauth2');
      expect(location).toContain('response_type=code');

      // Check that cookies are set (at least one should be present)
      const setCookieHeaders = res.headers.getSetCookie();
      expect(setCookieHeaders.length).toBeGreaterThan(0);
    });

    test('should handle OAuth callback with missing parameters', async () => {
      const req = new Request('http://localhost:3001/auth/callback/google');
      const res = await testApp.fetch(req);

      expect(res.status).toBe(400);
      // Just verify it's a 400 error, don't check the response body format
    });

    test('should handle OAuth callback with invalid state', async () => {
      const req = new Request(
        'http://localhost:3001/auth/callback/google?code=test_code&state=invalid_state'
      );
      const res = await testApp.fetch(req);

      expect(res.status).toBe(400);
      // Just verify it's a 400 error, don't check the response body format
    });
  });

  describe('Session Management Tests', () => {
    beforeEach(async () => {
      // Create a test user
      testUserId = createId();
      await getDb().insert(users).values({
        id: testUserId,
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google',
        providerId: 'google_test_123',
        googleRefreshToken: 'test_refresh_token',
      });

      // Create a test session using test Lucia
      const lucia = getTestLucia();
      const session = await lucia.createSession(testUserId, {});
      testSessionId = session.id;
    });

    test('should get current user with valid session', async () => {
      const lucia = getTestLucia();
      const sessionCookie = lucia.createSessionCookie(testSessionId);

      const req = new Request('http://localhost:3001/auth/me', {
        headers: {
          Cookie: sessionCookie.serialize(),
        },
      });
      const res = await testApp.fetch(req);

      expect(res.status).toBe(200);

      const data = await getDirectResponse<AuthResponse>(res);
      expect(data.user).toBeDefined();
      expect(data.user.id).toBe(testUserId);
      expect(data.user.email).toBe('test@example.com');
      expect(data.user.displayName).toBe('Test User');
      expect(data.session).toBeDefined();
      expect(data.session.id).toBe(testSessionId);
    });

    test('should reject request with no session', async () => {
      const req = new Request('http://localhost:3001/auth/me');
      const res = await testApp.fetch(req);

      expect(res.status).toBe(401);
      // Just verify it's a 401 error
    });

    test('should reject request with invalid session', async () => {
      const req = new Request('http://localhost:3001/auth/me', {
        headers: {
          Cookie: 'auth_session=invalid_session_id',
        },
      });
      const res = await testApp.fetch(req);

      expect(res.status).toBe(401);
      // Just verify it's a 401 error
    });

    test('should refresh session successfully', async () => {
      const lucia = getTestLucia();
      const sessionCookie = lucia.createSessionCookie(testSessionId);

      const req = new Request('http://localhost:3001/auth/refresh', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie.serialize(),
        },
      });
      const res = await testApp.fetch(req);

      expect(res.status).toBe(200);

      const data = await getDirectResponse<AuthResponse>(res);
      expect(data.user).toBeDefined();
      expect(data.user.id).toBe(testUserId);
      expect(data.session).toBeDefined();

      // Session ID might be the same if not close to expiry
      expect(data.session.id).toBeDefined();
    });

    test('should logout successfully', async () => {
      const luciaInstance = getTestLucia();
      const sessionCookie = luciaInstance.createSessionCookie(testSessionId);

      const req = new Request('http://localhost:3001/auth/logout', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie.serialize(),
        },
      });
      const res = await testApp.fetch(req);

      expect(res.status).toBe(200);

      const data = await getDirectResponse<LogoutResponse>(res);
      expect(data.message).toContain('Logged out successfully');

      // Check that session cookie is cleared
      const cookies = res.headers.get('Set-Cookie');
      expect(cookies).toContain('auth_session=;');

      // Verify session is invalidated
      const { session } = await luciaInstance.validateSession(testSessionId);
      expect(session).toBeNull();
    });

    test('should logout without session gracefully', async () => {
      const req = new Request('http://localhost:3001/auth/logout', {
        method: 'POST',
      });
      const res = await testApp.fetch(req);

      expect(res.status).toBe(200);

      const data = await getDirectResponse<LogoutResponse>(res);
      expect(data.message).toContain('Logged out successfully');
    });
  });

  describe('Protected Route Tests', () => {
    beforeEach(async () => {
      // Create a test user and session
      testUserId = createId();
      await getDb().insert(users).values({
        id: testUserId,
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google',
        providerId: 'google_test_123',
      });

      const lucia = getTestLucia();
      const session = await lucia.createSession(testUserId, {});
      testSessionId = session.id;
    });

    test('should access protected route with valid session', async () => {
      const lucia = getTestLucia();
      const sessionCookie = lucia.createSessionCookie(testSessionId);

      const req = new Request('http://localhost:3001/protected', {
        headers: {
          Cookie: sessionCookie.serialize(),
        },
      });
      const res = await testApp.fetch(req);

      expect(res.status).toBe(200);

      const data = await getDirectResponse<AuthResponse>(res);
      expect(data.user).toBeDefined();
      expect(data.user.id).toBe(testUserId);
      expect(data.user.email).toBe('test@example.com');
    });

    test('should reject protected route without session', async () => {
      const req = new Request('http://localhost:3001/protected');
      const res = await testApp.fetch(req);

      expect(res.status).toBe(401);
      // Just verify it's a 401 error
    });

    test('should reject protected route with invalid session', async () => {
      const req = new Request('http://localhost:3001/protected', {
        headers: {
          Cookie: 'auth_session=invalid_session_id',
        },
      });
      const res = await testApp.fetch(req);

      expect(res.status).toBe(401);
      // Just verify it's a 401 error
    });
  });

  describe('Session Expiry and Refresh Tests', () => {
    test('should handle expired session', async () => {
      // Create a user
      testUserId = createId();
      await getDb().insert(users).values({
        id: testUserId,
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google',
        providerId: 'google_test_123',
      });

      // Create an expired session manually
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      await getDb()
        .insert(sessions)
        .values({
          id: 'expired_session_id',
          userId: testUserId,
          expiresAt: Math.floor(expiredDate.getTime() / 1000),
        });

      const req = new Request('http://localhost:3001/auth/me', {
        headers: {
          Cookie: 'auth_session=expired_session_id',
        },
      });
      const res = await testApp.fetch(req);

      expect(res.status).toBe(401);
      // Just verify it's a 401 error and session cookie is cleared
      const cookies = res.headers.get('Set-Cookie');
      if (cookies) {
        expect(cookies).toContain('auth_session=;');
      }
    });
  });

  describe('Error Handling Tests', () => {
    test('should handle malformed cookies', async () => {
      const req = new Request('http://localhost:3001/auth/me', {
        headers: {
          Cookie: 'malformed_cookie_string',
        },
      });
      const res = await testApp.fetch(req);

      expect(res.status).toBe(401);
      // Just verify it's a 401 error
    });
  });
});
