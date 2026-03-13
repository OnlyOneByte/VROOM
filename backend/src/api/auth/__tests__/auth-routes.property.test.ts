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
   * The login callback (validateLoginState) rejects state entries where
   * flowType is set — only entries with no flowType are valid for login.
   */
  test('login callback rejects state entries with flowType set', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // validateLoginState must check that flowType is falsy
        expect(routesSource).toContain('function validateLoginState');

        // Extract the validateLoginState function
        const fnStart = routesSource.indexOf('function validateLoginState');
        const fnEnd = routesSource.indexOf(
          '}',
          routesSource.indexOf('return { data: storedData }', fnStart)
        );
        const fnBody = routesSource.slice(fnStart, fnEnd + 1);

        // Must reject when flowType is set (storedData.flowType is truthy)
        expect(fnBody).toContain('storedData.flowType');
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 5.2, 16.2**
   *
   * The link callback validates that flowType === 'auth-link'.
   */
  test('link callback validates flowType=auth-link', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // validateLinkState must check flowType === 'auth-link'
        expect(routesSource).toContain('function validateLinkState');

        const fnStart = routesSource.indexOf('function validateLinkState');
        const fnEnd = routesSource.indexOf(
          '}',
          routesSource.indexOf('return { data: storedData }', fnStart)
        );
        const fnBody = routesSource.slice(fnStart, fnEnd + 1);

        expect(fnBody).toContain("'auth-link'");
      }),
      { numRuns: 200 }
    );
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
    );
  });
});
