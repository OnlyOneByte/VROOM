import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';

describe('Auth routes structural properties', () => {
  test('login callback delegates to consumeOAuthState for the login flow (no flowType)', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    const fnStart = routesSource.indexOf('function validateLoginState');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = routesSource.slice(fnStart, routesSource.indexOf('\n}', fnStart) + 2);
    expect(fnBody).toContain('consumeOAuthState(oauthStateStore, stateParam, undefined)');
  });

  test('link callback delegates to consumeOAuthState for the auth-link flow', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    const fnStart = routesSource.indexOf('function validateLinkState');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = routesSource.slice(fnStart, routesSource.indexOf('\n}', fnStart) + 2);
    expect(fnBody).toContain("consumeOAuthState(oauthStateStore, stateParam, 'auth-link')");
  });

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

  test('/providers endpoint has no requireAuth', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        const providersRouteIdx = routesSource.indexOf("routes.get('/providers'");
        expect(providersRouteIdx).not.toBe(-1);

        const lineEnd = routesSource.indexOf('\n', providersRouteIdx);
        const routeLine = routesSource.slice(providersRouteIdx, lineEnd);

        expect(routeLine).not.toContain('requireAuth');
      }),
      { numRuns: 100 }
    );
  });

  test('rate limiter is applied to login, callback, and link routes', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(routesSource).toContain('authRateLimiter');

        const loginRouteIdx = routesSource.indexOf("'/login/:authProvider'");
        expect(loginRouteIdx).not.toBe(-1);
        const loginLine = routesSource.lastIndexOf('routes.get(', loginRouteIdx);
        const loginDef = routesSource.slice(loginLine, routesSource.indexOf('\n', loginRouteIdx));
        expect(loginDef).toContain('authRateLimiter');

        const linkCallbackIdx = routesSource.indexOf("'/callback/link/:authProvider'");
        expect(linkCallbackIdx).not.toBe(-1);
        const linkLine = routesSource.lastIndexOf('routes.get(', linkCallbackIdx);
        const linkDef = routesSource.slice(linkLine, routesSource.indexOf('\n', linkCallbackIdx));
        expect(linkDef).toContain('authRateLimiter');

        const genericCallbackIdx = routesSource.indexOf("'/callback/:authProvider'");
        expect(genericCallbackIdx).not.toBe(-1);
        const genericLine = routesSource.lastIndexOf('routes.get(', genericCallbackIdx);
        const genericDef = routesSource.slice(
          genericLine,
          routesSource.indexOf('\n', genericCallbackIdx)
        );
        expect(genericDef).toContain('authRateLimiter');

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
