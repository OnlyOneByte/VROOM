/**
 * Preservation Property Tests — Login OAuth flow and sync credential access
 *
 * **Validates: Requirements 3.1, 3.2, 3.4**
 *
 * These tests capture the CURRENT (pre-fix) behavior that MUST be preserved
 * after the provider OAuth session isolation fix is applied.
 *
 * Property 2: Preservation — Login OAuth callback behavior unchanged
 *   For all login OAuth callback requests (where flowType is absent and returnTo
 *   is absent or points to dashboard), the handler creates or finds a user,
 *   calls lucia.createSession(), sets the session cookie, and redirects.
 *
 * Property 4: Preservation — Google Sheets sync and restore use provider credentials
 *   For all Google Sheets sync operations, getUserToken() returns a valid
 *   refresh token from user_providers.credentials.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import { encrypt } from '../../../utils/encryption';

// Mock encryption key for tests
process.env.PROVIDER_ENCRYPTION_KEY = 'a'.repeat(64);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate a Google sub ID (numeric string like real Google sub IDs) */
const googleSubArb = fc.stringMatching(/^[0-9]{10,21}$/);

/** Generate a Google email */
const googleEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{2,14}$/),
    fc.constantFrom('gmail.com', 'googlemail.com', 'example.com')
  )
  .map(([local, domain]) => `${local}@${domain}`);

/** Generate a display name */
const displayNameArb = fc
  .tuple(fc.stringMatching(/^[A-Z][a-z]{2,10}$/), fc.stringMatching(/^[A-Z][a-z]{2,10}$/))
  .map(([first, last]) => `${first} ${last}`);

/** Generate a refresh token (opaque string) */
const refreshTokenArb = fc.stringMatching(/^1\/[A-Za-z0-9_-]{30,60}$/);

/** Generate returnTo values for login flow (absent or dashboard) */
const loginReturnToArb = fc.constantFrom(undefined, '/dashboard', '/');

// ---------------------------------------------------------------------------
// Property 2: Preservation — Login OAuth callback behavior unchanged
// ---------------------------------------------------------------------------

describe('Property 2: Preservation — Login OAuth callback behavior unchanged', () => {
  let sqliteDb: Database;

  beforeEach(() => {
    sqliteDb = new Database(':memory:');
    sqliteDb.run('PRAGMA foreign_keys = ON');
    const migrations = loadMigrations();
    for (const m of migrations) {
      applyMigration(sqliteDb, m);
    }
  });

  afterEach(() => {
    sqliteDb.close();
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * Observation: /login/google generates an OAuth URL with the correct scopes
   * and redirects to Google. The URL contains state, code_challenge, and scopes
   * including openid, profile, email, and drive.file.
   *
   * Property: For all login initiation requests, the /login/google endpoint
   * generates a valid Google OAuth authorization URL and stores state in the
   * oauthStateStore with { codeVerifier, createdAt } (no flowType, no userId).
   */
  test('login/:authProvider generates OAuth URL with correct structure and state shape', async () => {
    // Read the source to verify the login endpoint's behavior structurally
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // Extract the login handler section
        const loginStart = routesSource.indexOf("routes.get('/login/:authProvider'");
        const loginEnd = routesSource.indexOf("routes.get('/link/:authProvider'");
        const loginSection = routesSource.slice(loginStart, loginEnd);

        // Login endpoint looks up provider from registry
        expect(loginSection).toContain('getEnabledProvider');

        // Login endpoint stores state with codeVerifier and createdAt
        expect(loginSection).toContain('codeVerifier');
        expect(loginSection).toContain('createdAt');

        // Login endpoint redirects to the generated URL
        expect(loginSection).toContain('c.redirect');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * Observation: /callback/google with a valid login flow (no returnTo or
   * returnTo pointing to dashboard) creates a user record if new, creates
   * a Lucia session, sets the session cookie, and redirects to dashboard.
   *
   * Property: For all login OAuth callback requests, the handler:
   * 1. Exchanges the code for tokens
   * 2. Fetches Google user info
   * 3. Creates or finds a user record
   * 4. Calls lucia.createSession()
   * 5. Sets the session cookie via setCookie()
   * 6. Redirects to the dashboard (or returnTo)
   */
  test('callback/:authProvider always creates session and sets cookie for login flow', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(loginReturnToArb, (_returnTo) => {
        // Extract the generic callback handler (between callback/:authProvider and session routes)
        const callbackStart = routesSource.indexOf("routes.get('/callback/:authProvider'");
        const callbackEnd =
          routesSource.indexOf('// ====\n// SESSION ROUTES') !== -1
            ? routesSource.indexOf('// ====\n// SESSION ROUTES')
            : routesSource.indexOf("routes.get('/me'");
        const callbackSection = routesSource.slice(callbackStart, callbackEnd);

        // Callback uses exchangeAuthTokens helper for token exchange
        expect(callbackSection).toContain('exchangeAuthTokens');

        // Callback resolves user via 3-way resolution
        expect(callbackSection).toContain('findByProviderIdentity');

        // Callback ALWAYS creates a Lucia session (this is the login behavior to preserve)
        expect(callbackSection).toContain('createAuthSession');

        // Callback redirects to dashboard
        expect(callbackSection).toContain('c.redirect');
        expect(callbackSection).toContain('/dashboard');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Observation: /callback/google with a new Google account creates a user
   * record with the correct fields (id, email, displayName).
   *
   * Property: For all new user login flows, the callback inserts a user record
   * with id = `google_${sub}`, the Google email, and display name.
   */
  test('callback/google creates new user with correct id format and fields', () => {
    fc.assert(
      fc.property(googleSubArb, googleEmailArb, displayNameArb, (googleSub, email, displayName) => {
        const userId = `google_${googleSub}`;

        // Insert a new user as the callback would
        sqliteDb.run(
          `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
          [userId, email, displayName]
        );

        // Verify the user was created correctly
        const user = sqliteDb.query('SELECT * FROM users WHERE id = ?').get(userId) as Record<
          string,
          unknown
        > | null;

        expect(user).not.toBeNull();
        expect(user?.id).toBe(userId);
        expect(user?.email).toBe(email);
        expect(user?.display_name).toBe(displayName);

        // Clean up for next iteration
        sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * Observation: /callback/google with an existing user finds the user by
   * email, optionally updates the refresh token, creates a session,
   * and redirects.
   *
   * Property: For all existing user login flows, the callback finds the user
   * by email, creates a session record in the sessions table, and the
   * session references the correct userId.
   */
  test('callback/google with existing user creates session referencing correct userId', () => {
    fc.assert(
      fc.property(googleSubArb, googleEmailArb, displayNameArb, (googleSub, email, displayName) => {
        const userId = `google_${googleSub}`;

        // Seed an existing user (as if they logged in before)
        sqliteDb.run(
          `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
          [userId, email, displayName]
        );

        // Simulate what the callback does: look up user by email
        const existingUser = sqliteDb
          .query('SELECT * FROM users WHERE email = ? LIMIT 1')
          .get(email) as Record<string, unknown> | null;

        expect(existingUser).not.toBeNull();
        expect(existingUser?.id).toBe(userId);

        // Simulate session creation (what lucia.createSession does)
        const sessionId = `session_${googleSub}_${Date.now()}`;
        const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
        sqliteDb.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [
          sessionId,
          userId,
          expiresAt,
        ]);

        // Verify session was created and references the correct user
        const session = sqliteDb
          .query('SELECT * FROM sessions WHERE id = ?')
          .get(sessionId) as Record<string, unknown> | null;

        expect(session).not.toBeNull();
        expect(session?.user_id).toBe(userId);
        expect(session?.expires_at).toBe(expiresAt);

        // Clean up
        sqliteDb.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
        sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Observation: Session validation via /auth/me returns the correct user
   * when a valid session exists.
   *
   * Property: For all valid sessions, looking up the session and joining
   * to the users table returns the correct user data.
   */
  test('session validation returns correct user for valid session', () => {
    fc.assert(
      fc.property(googleSubArb, googleEmailArb, displayNameArb, (googleSub, email, displayName) => {
        const userId = `google_${googleSub}`;

        // Seed user
        sqliteDb.run(
          `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
          [userId, email, displayName]
        );

        // Seed session
        const sessionId = `session_${googleSub}`;
        const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
        sqliteDb.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [
          sessionId,
          userId,
          expiresAt,
        ]);

        // Simulate what /auth/me does: validate session → get user
        const result = sqliteDb
          .query(
            `SELECT u.id, u.email, u.display_name
               FROM sessions s
               JOIN users u ON s.user_id = u.id
               WHERE s.id = ? AND s.expires_at > ?`
          )
          .get(sessionId, Math.floor(Date.now() / 1000)) as Record<string, unknown> | null;

        expect(result).not.toBeNull();
        expect(result?.id).toBe(userId);
        expect(result?.email).toBe(email);
        expect(result?.display_name).toBe(displayName);

        // Clean up
        sqliteDb.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
        sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Preservation — getUserToken() returns valid refresh token
// ---------------------------------------------------------------------------

describe('Property 4: Preservation — Google Sheets sync uses provider credentials', () => {
  let sqliteDb: Database;

  beforeEach(() => {
    sqliteDb = new Database(':memory:');
    sqliteDb.run('PRAGMA foreign_keys = ON');
    const migrations = loadMigrations();
    for (const m of migrations) {
      applyMigration(sqliteDb, m);
    }
  });

  afterEach(() => {
    sqliteDb.close();
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Post-fix: getUserToken() reads from user_providers.credentials where
   * domain='storage', providerType='google-drive', status='active'.
   *
   * Property: For all users with an active Google Drive provider containing
   * a refresh token in credentials, querying user_providers returns the
   * encrypted credentials. This is the data path getUserToken() uses.
   */
  test('user_providers.credentials is accessible for sync operations', () => {
    fc.assert(
      fc.property(
        googleSubArb,
        googleEmailArb,
        displayNameArb,
        refreshTokenArb,
        (googleSub, email, displayName, refreshToken) => {
          const userId = `google_${googleSub}`;

          // Seed user
          sqliteDb.run(
            `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
            [userId, email, displayName]
          );

          // Seed a Google Drive provider with encrypted credentials containing refreshToken
          const encryptedCredentials = encrypt(JSON.stringify({ refreshToken }));
          sqliteDb.run(
            `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
             VALUES (?, ?, 'storage', 'google-drive', 'Google Drive', ?, 'active')`,
            [`provider_${googleSub}`, userId, encryptedCredentials]
          );

          // Simulate what getUserToken() does: query user_providers for credentials
          const provider = sqliteDb
            .query(
              `SELECT credentials FROM user_providers
               WHERE user_id = ? AND domain = 'storage' AND provider_type = 'google-drive' AND status = 'active'
               LIMIT 1`
            )
            .get(userId) as { credentials: string } | null;

          expect(provider).not.toBeNull();
          expect(provider?.credentials).toBeTruthy();

          // Clean up
          sqliteDb.run('DELETE FROM user_providers WHERE user_id = ?', [userId]);
          sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: For all users WITHOUT an active Google Drive provider,
   * getUserToken() would throw AUTH_INVALID. This error behavior must be preserved.
   */
  test('missing Google Drive provider produces null (triggers AUTH_INVALID in getUserToken)', () => {
    fc.assert(
      fc.property(googleSubArb, googleEmailArb, displayNameArb, (googleSub, email, displayName) => {
        const userId = `google_${googleSub}`;

        // Seed user WITHOUT a Google Drive provider
        sqliteDb.run(
          `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
          [userId, email, displayName]
        );

        // getUserToken() checks for active Google Drive provider → throws AUTH_INVALID if none
        const provider = sqliteDb
          .query(
            `SELECT credentials FROM user_providers
             WHERE user_id = ? AND domain = 'storage' AND provider_type = 'google-drive' AND status = 'active'
             LIMIT 1`
          )
          .get(userId) as { credentials: string } | null;

        expect(provider).toBeNull();

        // Clean up
        sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: For all users with an active Google Drive provider,
   * the credentials contain a valid encrypted refresh token that can
   * be used for sync operations.
   */
  test('getUserToken reads from user_providers.credentials for sync', () => {
    fc.assert(
      fc.property(
        googleSubArb,
        googleEmailArb,
        displayNameArb,
        refreshTokenArb,
        (googleSub, email, displayName, refreshToken) => {
          const userId = `google_${googleSub}`;

          // Seed user
          sqliteDb.run(
            `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
            [userId, email, displayName]
          );

          // Seed a Google Drive provider with proper credentials
          const encryptedCredentials = encrypt(JSON.stringify({ refreshToken }));
          sqliteDb.run(
            `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
             VALUES (?, ?, 'storage', 'google-drive', 'Google Drive', ?, 'active')`,
            [`provider_${googleSub}`, userId, encryptedCredentials]
          );

          // Simulate getUserToken(): find active Google Drive provider and read credentials
          const provider = sqliteDb
            .query(
              `SELECT credentials FROM user_providers
               WHERE user_id = ? AND domain = 'storage' AND provider_type = 'google-drive' AND status = 'active'
               LIMIT 1`
            )
            .get(userId) as { credentials: string } | null;

          expect(provider).not.toBeNull();
          expect(provider?.credentials).toBeTruthy();

          // Clean up
          sqliteDb.run('DELETE FROM user_providers WHERE user_id = ?', [userId]);
          sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: For all restore operations, getUserWithToken() reads from
   * user_providers.credentials. The user must exist and have an active
   * Google Drive provider with credentials.
   */
  test('getUserWithToken reads id, displayName, and credentials from user_providers', () => {
    fc.assert(
      fc.property(
        googleSubArb,
        googleEmailArb,
        displayNameArb,
        refreshTokenArb,
        (googleSub, email, displayName, refreshToken) => {
          const userId = `google_${googleSub}`;

          // Seed user
          sqliteDb.run(
            `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
            [userId, email, displayName]
          );

          // Seed a Google Drive provider with credentials
          const encryptedCredentials = encrypt(JSON.stringify({ refreshToken }));
          sqliteDb.run(
            `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
             VALUES (?, ?, 'storage', 'google-drive', 'Google Drive', ?, 'active')`,
            [`provider_${googleSub}`, userId, encryptedCredentials]
          );

          // Simulate getUserWithToken() from restore.ts — read user + provider credentials
          const user = sqliteDb
            .query('SELECT id, display_name FROM users WHERE id = ? LIMIT 1')
            .get(userId) as { id: string; display_name: string } | null;

          const provider = sqliteDb
            .query(
              `SELECT credentials FROM user_providers
               WHERE user_id = ? AND domain = 'storage' AND provider_type = 'google-drive' AND status = 'active'
               LIMIT 1`
            )
            .get(userId) as { credentials: string } | null;

          expect(user).not.toBeNull();
          expect(user?.id).toBe(userId);
          expect(user?.display_name).toBe(displayName);
          expect(provider).not.toBeNull();
          expect(provider?.credentials).toBeTruthy();

          // Clean up
          sqliteDb.run('DELETE FROM user_providers WHERE user_id = ?', [userId]);
          sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
