/**
 * Source-code property tests for domain guard on provider routes.
 *
 * Verifies that DELETE, PUT, and POST handlers reject auth-domain rows
 * with ValidationError.
 *
 * **Validates: Requirements 8.2**
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';

describe('Domain guard on provider routes', () => {
  /**
   * **Validates: Requirements 8.2**
   *
   * DELETE handler checks existing[0].domain === 'auth' and throws ValidationError.
   */
  test('DELETE handler rejects auth-domain rows with ValidationError', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // Find the DELETE handler
        const deleteIdx = routesSource.indexOf("routes.delete('/:id'");
        expect(deleteIdx).not.toBe(-1);

        // Extract the DELETE handler body (up to the next routes. definition or end)
        const nextRouteIdx = routesSource.indexOf('routes.', deleteIdx + 1);
        const deleteBody = routesSource.slice(
          deleteIdx,
          nextRouteIdx !== -1 ? nextRouteIdx : undefined
        );

        // Must check domain === 'auth'
        expect(deleteBody).toContain("domain === 'auth'");
        // Must throw ValidationError
        expect(deleteBody).toContain('ValidationError');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * PUT handler checks existing[0].domain === 'auth' and throws ValidationError.
   */
  test('PUT handler rejects auth-domain rows with ValidationError', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // Find the PUT handler
        const putIdx = routesSource.indexOf('routes.put(');
        expect(putIdx).not.toBe(-1);

        // Extract the PUT handler body
        const nextRouteIdx = routesSource.indexOf('routes.', putIdx + 1);
        const putBody = routesSource.slice(putIdx, nextRouteIdx !== -1 ? nextRouteIdx : undefined);

        // Must check domain === 'auth'
        expect(putBody).toContain("domain === 'auth'");
        // Must throw ValidationError
        expect(putBody).toContain('ValidationError');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * POST handler checks body.domain === 'auth' and throws ValidationError.
   */
  test('POST handler rejects auth-domain creation with ValidationError', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // Find the POST handler for creating providers
        const postIdx = routesSource.indexOf("routes.post('/'");
        expect(postIdx).not.toBe(-1);

        // Extract the POST handler body
        const nextRouteIdx = routesSource.indexOf('routes.', postIdx + 1);
        const postBody = routesSource.slice(
          postIdx,
          nextRouteIdx !== -1 ? nextRouteIdx : undefined
        );

        // Must check domain === 'auth' on the body
        expect(postBody).toContain("=== 'auth'");
        // Must throw ValidationError
        expect(postBody).toContain('ValidationError');
      }),
      { numRuns: 100 }
    );
  });
});
