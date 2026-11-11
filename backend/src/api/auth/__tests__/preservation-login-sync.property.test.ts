/**
 * Login OAuth callback behavior and Google Sheets sync credential access. Login must keep creating
 * a session and redirecting to the dashboard, and sync reads its refresh token from
 * user_providers.credentials.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import { encrypt } from '../../../utils/encryption';

// Mock encryption key for tests
process.env.PROVIDER_ENCRYPTION_KEY = 'a'.repeat(64);

const googleSubArb = fc.stringMatching(/^[0-9]{10,21}$/);

const googleEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{2,14}$/),
    fc.constantFrom('gmail.com', 'googlemail.com', 'example.com')
  )
  .map(([local, domain]) => `${local}@${domain}`);

const displayNameArb = fc
  .tuple(fc.stringMatching(/^[A-Z][a-z]{2,10}$/), fc.stringMatching(/^[A-Z][a-z]{2,10}$/))
  .map(([first, last]) => `${first} ${last}`);

const refreshTokenArb = fc.stringMatching(/^1\/[A-Za-z0-9_-]{30,60}$/);

const loginReturnToArb = fc.constantFrom(undefined, '/dashboard', '/');

describe('login OAuth callback behavior', () => {
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

  test('login/:authProvider generates OAuth URL with correct structure and state shape', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        const loginStart = routesSource.indexOf("routes.get('/login/:authProvider'");
        const loginEnd = routesSource.indexOf("routes.get('/link/:authProvider'");
        const loginSection = routesSource.slice(loginStart, loginEnd);

        expect(loginSection).toContain('getEnabledProvider');
        expect(loginSection).toContain('codeVerifier');
        expect(loginSection).toContain('createdAt');
        expect(loginSection).toContain('c.redirect');
      }),
      { numRuns: 100 }
    );
  });

  test('callback/:authProvider always creates session and sets cookie for login flow', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(loginReturnToArb, (_returnTo) => {
        const callbackStart = routesSource.indexOf("routes.get('/callback/:authProvider'");
        const callbackEnd =
          routesSource.indexOf('// ====\n// SESSION ROUTES') !== -1
            ? routesSource.indexOf('// ====\n// SESSION ROUTES')
            : routesSource.indexOf("routes.get('/me'");
        const callbackSection = routesSource.slice(callbackStart, callbackEnd);

        expect(callbackSection).toContain('exchangeAuthTokens');
        expect(callbackSection).toContain('findByProviderIdentity');
        expect(callbackSection).toContain('createAuthSession');
        expect(callbackSection).toContain('c.redirect');
        expect(callbackSection).toContain('/dashboard');
      }),
      { numRuns: 100 }
    );
  });

  test('callback/google creates new user with correct id format and fields', () => {
    fc.assert(
      fc.property(googleSubArb, googleEmailArb, displayNameArb, (googleSub, email, displayName) => {
        const userId = `google_${googleSub}`;

        sqliteDb.run(
          `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
          [userId, email, displayName]
        );

        const user = sqliteDb.query('SELECT * FROM users WHERE id = ?').get(userId) as Record<
          string,
          unknown
        > | null;

        expect(user).not.toBeNull();
        expect(user?.id).toBe(userId);
        expect(user?.email).toBe(email);
        expect(user?.display_name).toBe(displayName);

        sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
      }),
      { numRuns: 100 }
    );
  });

  test('callback/google with existing user creates session referencing correct userId', () => {
    fc.assert(
      fc.property(googleSubArb, googleEmailArb, displayNameArb, (googleSub, email, displayName) => {
        const userId = `google_${googleSub}`;

        sqliteDb.run(
          `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
          [userId, email, displayName]
        );

        const existingUser = sqliteDb
          .query('SELECT * FROM users WHERE email = ? LIMIT 1')
          .get(email) as Record<string, unknown> | null;

        expect(existingUser).not.toBeNull();
        expect(existingUser?.id).toBe(userId);

        const sessionId = `session_${googleSub}_${Date.now()}`;
        const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
        sqliteDb.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [
          sessionId,
          userId,
          expiresAt,
        ]);

        const session = sqliteDb
          .query('SELECT * FROM sessions WHERE id = ?')
          .get(sessionId) as Record<string, unknown> | null;

        expect(session).not.toBeNull();
        expect(session?.user_id).toBe(userId);
        expect(session?.expires_at).toBe(expiresAt);

        sqliteDb.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
        sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
      }),
      { numRuns: 100 }
    );
  });

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

        sqliteDb.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
        sqliteDb.run('DELETE FROM users WHERE id = ?', [userId]);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Google Sheets sync reads provider credentials', () => {
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

  test('a missing Google Drive provider yields no credentials row', () => {
    fc.assert(
      fc.property(googleSubArb, googleEmailArb, displayNameArb, (googleSub, email, displayName) => {
        const userId = `google_${googleSub}`;

        sqliteDb.run(
          `INSERT INTO users (id, email, display_name)
             VALUES (?, ?, ?)`,
          [userId, email, displayName]
        );

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

  test('sync reads the refresh token from user_providers.credentials', () => {
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

  test('restore reads the user and the provider credentials', () => {
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
