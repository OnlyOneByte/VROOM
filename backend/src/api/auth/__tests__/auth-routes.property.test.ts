/**
 * Source-code property tests for auth routes structural invariants.
 *
 * Reads routes.ts source and verifies structural properties:
 * - Login callback rejects state entries with flowType set
 * - Link callback validates flowType=auth-link
 * - /callback/link routes registered before generic /callback routes
 * - /providers endpoint has no requireAuth
 * - Rate limiter applied to login/callback/link routes
 *
 * **Validates: Requirements 3.3, 5.2, 14.1, 16.1, 16.2, 16.3**
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';

describe('Auth routes structural properties', () => {
  /**
   * **Validates: Requirements 16.3**
   *
   * The login callback (validateLoginState) consumes the OAuth state via the shared single-use
   * `consumeOAuthState` helper with the LOGIN flow (expectedFlow `undefined` → entry must have no
   * flowType). The single-use + flow-isolation BEHAVIOR is pinned directly in
   * consume-oauth-state.test.ts (C39); this just guards the wiring (the validator delegates with the
   * right flow arg, not a re-inlined copy). Updated C39 when the inline body moved into the helper.
   */
  test('login callback delegates to consumeOAuthState for the login flow (no flowType)', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    const fnStart = routesSource.indexOf('function validateLoginState');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = routesSource.slice(fnStart, routesSource.indexOf('\n}', fnStart) + 2);
    // Login flow → consumeOAuthState(..., undefined): the entry must carry NO flowType.
    expect(fnBody).toContain('consumeOAuthState(oauthStateStore, stateParam, undefined)');
  });

  /**
   * **Validates: Requirements 5.2, 16.2**
   *
   * The link callback consumes via the shared helper with the 'auth-link' flow.
   */
  test('link callback delegates to consumeOAuthState for the auth-link flow', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    const fnStart = routesSource.indexOf('function validateLinkState');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = routesSource.slice(fnStart, routesSource.indexOf('\n}', fnStart) + 2);
    expect(fnBody).toContain("consumeOAuthState(oauthStateStore, stateParam, 'auth-link')");
  });

  /**
   * **Validates: Requirements 16.1**
   *
   * /callback/link/:authProvider is registered BEFORE /callback/:authProvider
   * to prevent route collision.
   */
  test('callback/link routes are registered before generic callback routes', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        const linkCallbackPos = routesSource.indexOf("'/callback/link/:authProvider'");
        const genericCallbackPos = routesSource.indexOf("'/callback/:authProvider'");

        expect(linkCallbackPos).not.toBe(-1);
        expect(genericCallbackPos).not.toBe(-1);
        expect(linkCallbackPos).toBeLessThan(genericCallbackPos);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.1**
   *
   * The public /providers endpoint does NOT have requireAuth middleware.
   */
  test('/providers endpoint has no requireAuth', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // Find the /providers route definition
        const providersRouteIdx = routesSource.indexOf("routes.get('/providers'");
        expect(providersRouteIdx).not.toBe(-1);

        // Extract the route definition line (up to the next routes. call or closing)
        const lineEnd = routesSource.indexOf('\n', providersRouteIdx);
        const routeLine = routesSource.slice(providersRouteIdx, lineEnd);

        // The /providers route should NOT include requireAuth
        expect(routeLine).not.toContain('requireAuth');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.1**
   *
   * Rate limiter (authRateLimiter) is applied to login, callback, and link routes.
   */
  test('rate limiter is applied to login, callback, and link routes', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // authRateLimiter must be defined
        expect(routesSource).toContain('authRateLimiter');

        // Find login route and verify it uses authRateLimiter
        const loginRouteIdx = routesSource.indexOf("'/login/:authProvider'");
        expect(loginRouteIdx).not.toBe(-1);
        const loginLine = routesSource.lastIndexOf('routes.get(', loginRouteIdx);
        const loginDef = routesSource.slice(loginLine, routesSource.indexOf('\n', loginRouteIdx));
        expect(loginDef).toContain('authRateLimiter');

        // Find link callback route and verify it uses authRateLimiter
        const linkCallbackIdx = routesSource.indexOf("'/callback/link/:authProvider'");
        expect(linkCallbackIdx).not.toBe(-1);
        const linkLine = routesSource.lastIndexOf('routes.get(', linkCallbackIdx);
        const linkDef = routesSource.slice(linkLine, routesSource.indexOf('\n', linkCallbackIdx));
        expect(linkDef).toContain('authRateLimiter');

        // Find generic callback route and verify it uses authRateLimiter
        const genericCallbackIdx = routesSource.indexOf("'/callback/:authProvider'");
        expect(genericCallbackIdx).not.toBe(-1);
        const genericLine = routesSource.lastIndexOf('routes.get(', genericCallbackIdx);
        const genericDef = routesSource.slice(
          genericLine,
          routesSource.indexOf('\n', genericCallbackIdx)
        );
        expect(genericDef).toContain('authRateLimiter');

        // Find link initiation route and verify it uses authRateLimiter
        const linkInitIdx = routesSource.indexOf("'/link/:authProvider'");
        expect(linkInitIdx).not.toBe(-1);
        const linkInitLine = routesSource.lastIndexOf('routes.get(', linkInitIdx);
        const linkInitDef = routesSource.slice(
          linkInitLine,
          routesSource.indexOf('\n', linkInitIdx)
        );
        expect(linkInitDef).toContain('authRateLimiter');
      }),
      { numRuns: 100 }
    );
  });
});
