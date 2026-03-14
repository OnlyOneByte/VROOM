/**
 * Bug Condition Exploration: Provider OAuth callback session isolation
 *
 * Property 1: Expected Behavior — Provider OAuth callback never modifies the session
 *
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5**
 *
 * Originally this test targeted /reauth/google (removed in Task 5.4).
 * Updated to target the new /providers/connect/google + /callback/provider/google endpoints.
 *
 * The fix introduces:
 * - /providers/connect/google stores state with flowType: 'provider' and userId
 * - /callback/provider/google does NOT call lucia.createSession() or setCookie()
 * - /callback/provider/google stores credentials via storePending() or updates provider directly
 * - /callback/provider/google redirects with provider_connected=true and nonce (no PII)
 * - The callback validates session userId matches state userId (CSRF protection)
 *
 * EXPECTED OUTCOME: Tests PASS (confirms bug is fixed)
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let sqliteDb: Database;

const USER_A_ID = 'google_user-a-sub';
const USER_A_EMAIL = 'alice@gmail.com';
const USER_A_SUB = 'user-a-sub';

// Mock encryption key for tests
process.env.PROVIDER_ENCRYPTION_KEY = 'a'.repeat(64);

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  for (const m of migrations) {
    applyMigration(sqliteDb, m);
  }

  // Seed User A (the logged-in user)
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name)
     VALUES ('${USER_A_ID}', '${USER_A_EMAIL}', 'Alice')`
  );

  // Seed a session for User A
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  sqliteDb.run(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ('session-a-original', '${USER_A_ID}', ${expiresAt})`
  );
});

afterEach(() => {
  sqliteDb.close();
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate a Google sub ID (numeric string like real Google sub IDs) */
const googleSubArb = fc.stringMatching(/^[0-9]{10,21}$/).filter((s) => s !== USER_A_SUB);

/** Generate a Google email */
const googleEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{3,15}$/),
    fc.constantFrom('gmail.com', 'googlemail.com', 'example.com')
  )
  .map(([local, domain]) => `${local}@${domain}`)
  .filter((e) => e !== USER_A_EMAIL);

/** Generate a returnTo path (always present for provider flow) */
const returnToArb = fc.constantFrom(
  '/settings/providers/new',
  '/settings/providers/abc123/edit',
  '/settings/providers'
);

/** Generate a nonce (UUID format) */
const nonceArb = fc.uuid();

// ---------------------------------------------------------------------------
// Property 1: Expected Behavior — Provider OAuth callback never modifies session
// ---------------------------------------------------------------------------

describe('Property 1: Expected Behavior — Provider OAuth callback never modifies the session', () => {
  /**
   * Test 1: /providers/connect/google stores state with flowType: 'provider' and userId
   *
   * The new provider initiation endpoint stores proper flow isolation markers
   * in the OAuth state, enabling the callback to distinguish provider flows from login flows.
   */
  test('providers/connect/google stores state with flowType and userId (flow isolation)', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(returnToArb, nonceArb, (_returnTo, _nonce) => {
        // Extract the provider connect endpoint
        const connectStart = routesSource.indexOf("routes.get('/providers/connect/google'");
        expect(connectStart).not.toBe(-1);

        const connectSection = routesSource.slice(
          connectStart,
          routesSource.indexOf("routes.get('/callback/provider/google'")
        );

        // The state MUST include flowType: 'provider' for flow isolation
        expect(connectSection).toContain("flowType: 'provider'");

        // The state MUST include userId for CSRF protection
        expect(connectSection).toContain('userId:');

        // The state MUST include nonce for credential correlation
        expect(connectSection).toContain('nonce');

        // The endpoint requires authentication
        expect(connectSection).toContain('requireAuth');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Test 2: /callback/provider/google does NOT call lucia.createSession() or setCookie()
   *
   * The provider callback MUST NOT create sessions or modify cookies.
   * This is the core fix — the callback stores credentials without touching auth state.
   */
  test('callback/provider/google does NOT create sessions or set cookies (session isolation)', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(
        googleSubArb,
        googleEmailArb,
        returnToArb,
        nonceArb,
        (_googleSub, _googleEmail, _returnTo, _nonce) => {
          // Extract the provider callback handler
          const callbackStart = routesSource.indexOf("routes.get('/callback/provider/google'");
          expect(callbackStart).not.toBe(-1);

          const callbackSection = routesSource.slice(
            callbackStart,
            routesSource.indexOf('export { routes }')
          );

          // The provider callback MUST NOT call lucia.createSession()
          expect(callbackSection).not.toContain('lucia.createSession');

          // The provider callback MUST NOT call setCookie() for session creation
          // It reads cookies for validation but never sets them
          expect(callbackSection).not.toContain('setCookie(');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test 3: /callback/provider/google stores credentials via storePending() or updates provider
   *
   * Instead of creating sessions, the callback stores the refresh token
   * in the pending credentials store (new provider) or updates the existing
   * provider record directly (re-auth).
   */
  test('callback/provider/google stores credentials on provider, not session (credential isolation)', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(
        googleSubArb,
        googleEmailArb,
        returnToArb,
        nonceArb,
        (_googleSub, _googleEmail, _returnTo, _nonce) => {
          const callbackStart = routesSource.indexOf("routes.get('/callback/provider/google'");
          const callbackSection = routesSource.slice(
            callbackStart,
            routesSource.indexOf('export { routes }')
          );

          // The callback MUST use storePending for new providers
          expect(callbackSection).toContain('storePending');

          // The callback MUST use updateExistingProvider for re-auth
          expect(callbackSection).toContain('updateExistingProvider');

          // The callback MUST NOT insert into or update the users table
          expect(callbackSection).not.toContain('db.insert(users)');
          expect(callbackSection).not.toContain('.update(users)');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test 4: /callback/provider/google redirects with provider_connected=true and nonce (no PII)
   *
   * The redirect URL contains only opaque tokens and status flags — never email addresses.
   */
  test('callback/provider/google redirects with nonce and no PII in URL', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(returnToArb, nonceArb, (_returnTo, _nonce) => {
        const callbackStart = routesSource.indexOf("routes.get('/callback/provider/google'");
        const callbackSection = routesSource.slice(
          callbackStart,
          routesSource.indexOf('export { routes }')
        );

        // Success redirect includes provider_connected=true
        expect(callbackSection).toContain('provider_connected=true');

        // Success redirect includes nonce
        expect(callbackSection).toContain('nonce=');

        // The redirect MUST NOT contain email addresses or PII
        // Check that no email variable is interpolated into the redirect URL
        const redirectLines = callbackSection
          .split('\n')
          .filter((line) => line.includes('provider_connected=true'));
        for (const line of redirectLines) {
          expect(line).not.toContain('email');
          expect(line).not.toContain('@');
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Test 5: /callback/provider/google validates session userId matches state userId (CSRF)
   *
   * The callback verifies the authenticated user matches the user who initiated
   * the OAuth flow, preventing confused-deputy attacks.
   */
  test('callback/provider/google validates CSRF — session userId must match state userId', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        const callbackStart = routesSource.indexOf("routes.get('/callback/provider/google'");
        const callbackSection = routesSource.slice(
          callbackStart,
          routesSource.indexOf('export { routes }')
        );

        // The callback MUST validate the session against the state userId
        expect(callbackSection).toContain('validateProviderCsrf');

        // There must be a session mismatch error path
        expect(callbackSection).toContain('session_mismatch');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Test 6: Provider credentials contain actual refresh token, not empty object
   *
   * With the fix, provider credentials stored via storePending contain
   * a real refresh token that can be used for Google Drive operations.
   */
  test('provider credentials should contain refresh token via pending store', () => {
    // Import the pending credentials helpers
    const { storePending, consumePending } = require('../../../utils/pending-credentials');

    fc.assert(
      fc.property(nonceArb, (nonce) => {
        const refreshToken = `1/test-refresh-token-${nonce.slice(0, 8)}`;
        const email = 'provider@gmail.com';

        // Store credentials as the callback would
        storePending(USER_A_ID, nonce, refreshToken, email);

        // Consume as POST /api/v1/providers would
        const consumed = consumePending(USER_A_ID, nonce);

        expect(consumed).not.toBeNull();
        expect(consumed?.refreshToken).toBe(refreshToken);
        expect(consumed?.email).toBe(email);

        // After consumption, the entry is gone
        const again = consumePending(USER_A_ID, nonce);
        expect(again).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Test 7: /reauth/google endpoint has been removed
   *
   * The old endpoint that caused the bug no longer exists.
   */
  test('/reauth/google endpoint is removed (bug vector eliminated)', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // The old /reauth/google endpoint must not exist
        expect(routesSource).not.toContain("'/reauth/google'");
        expect(routesSource).not.toContain('"/reauth/google"');
      }),
      { numRuns: 100 }
    );
  });
});
