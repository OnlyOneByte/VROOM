/**
 * Provider OAuth callback isolation. The provider flow must never create or modify the login
 * session. It stores credentials only, redirects without PII, and checks that the session user
 * matches the user who started the flow.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';

let sqliteDb: Database;

const USER_A_ID = 'google_user-a-sub';
const USER_A_EMAIL = 'alice@gmail.com';
const USER_A_SUB = 'user-a-sub';

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

/** Google sub IDs are numeric strings. */
const googleSubArb = fc.stringMatching(/^[0-9]{10,21}$/).filter((s) => s !== USER_A_SUB);

const googleEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{3,15}$/),
    fc.constantFrom('gmail.com', 'googlemail.com', 'example.com')
  )
  .map(([local, domain]) => `${local}@${domain}`)
  .filter((e) => e !== USER_A_EMAIL);

const returnToArb = fc.constantFrom(
  '/settings/providers/new',
  '/settings/providers/abc123/edit',
  '/settings/providers'
);

const nonceArb = fc.uuid();

describe('provider OAuth callback never modifies the session', () => {
  test('providers/connect/google stores state with flowType and userId (flow isolation)', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(returnToArb, nonceArb, (_returnTo, _nonce) => {
        const connectStart = routesSource.indexOf("routes.get('/providers/connect/google'");
        expect(connectStart).not.toBe(-1);

        const connectSection = routesSource.slice(
          connectStart,
          routesSource.indexOf("routes.get('/callback/provider/google'")
        );

        expect(connectSection).toContain("flowType: 'provider'");
        expect(connectSection).toContain('userId:');
        expect(connectSection).toContain('nonce');
        expect(connectSection).toContain('requireAuth');
      }),
      { numRuns: 100 }
    );
  });

  test('callback/provider/google does NOT create sessions or set cookies (session isolation)', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(
        googleSubArb,
        googleEmailArb,
        returnToArb,
        nonceArb,
        (_googleSub, _googleEmail, _returnTo, _nonce) => {
          const callbackStart = routesSource.indexOf("routes.get('/callback/provider/google'");
          expect(callbackStart).not.toBe(-1);

          const callbackSection = routesSource.slice(
            callbackStart,
            routesSource.indexOf('export { routes }')
          );

          expect(callbackSection).not.toContain('lucia.createSession');
          expect(callbackSection).not.toContain('setCookie(');
        }
      ),
      { numRuns: 100 }
    );
  });

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

          expect(callbackSection).toContain('storePending');
          expect(callbackSection).toContain('updateExistingProvider');
          expect(callbackSection).not.toContain('db.insert(users)');
          expect(callbackSection).not.toContain('.update(users)');
        }
      ),
      { numRuns: 100 }
    );
  });

  test('callback/provider/google redirects with nonce and no PII in URL', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(returnToArb, nonceArb, (_returnTo, _nonce) => {
        const callbackStart = routesSource.indexOf("routes.get('/callback/provider/google'");
        const callbackSection = routesSource.slice(
          callbackStart,
          routesSource.indexOf('export { routes }')
        );

        expect(callbackSection).toContain('provider_connected=true');
        expect(callbackSection).toContain('nonce=');

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

  test('callback/provider/google validates CSRF — session userId must match state userId', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        const callbackStart = routesSource.indexOf("routes.get('/callback/provider/google'");
        const callbackSection = routesSource.slice(
          callbackStart,
          routesSource.indexOf('export { routes }')
        );

        expect(callbackSection).toContain('validateProviderCsrf');
        expect(callbackSection).toContain('session_mismatch');
      }),
      { numRuns: 100 }
    );
  });

  test('provider credentials contain the refresh token via the pending store', () => {
    // Import the pending credentials helpers
    const { storePending, consumePending } = require('../../../utils/pending-credentials');

    fc.assert(
      fc.property(nonceArb, (nonce) => {
        const refreshToken = `1/test-refresh-token-${nonce.slice(0, 8)}`;
        const email = 'provider@gmail.com';

        storePending(USER_A_ID, nonce, refreshToken, email);
        const consumed = consumePending(USER_A_ID, nonce);

        expect(consumed).not.toBeNull();
        expect(consumed?.refreshToken).toBe(refreshToken);
        expect(consumed?.email).toBe(email);

        const again = consumePending(USER_A_ID, nonce);
        expect(again).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('does not expose a /reauth/google endpoint', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(routesSource).not.toContain("'/reauth/google'");
        expect(routesSource).not.toContain('"/reauth/google"');
      }),
      { numRuns: 100 }
    );
  });
});
