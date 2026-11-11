import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';

describe('Domain guard on provider routes', () => {
  test('DELETE handler rejects auth-domain rows with ValidationError', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        const deleteIdx = routesSource.indexOf("routes.delete('/:id'");
        expect(deleteIdx).not.toBe(-1);

        const nextRouteIdx = routesSource.indexOf('routes.', deleteIdx + 1);
        const deleteBody = routesSource.slice(
          deleteIdx,
          nextRouteIdx !== -1 ? nextRouteIdx : undefined
        );

        expect(deleteBody).toContain("domain === 'auth'");
        expect(deleteBody).toContain('ValidationError');
      }),
      { numRuns: 100 }
    );
  });

  test('PUT handler rejects auth-domain rows with ValidationError', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        const putIdx = routesSource.indexOf('routes.put(');
        expect(putIdx).not.toBe(-1);

        const nextRouteIdx = routesSource.indexOf('routes.', putIdx + 1);
        const putBody = routesSource.slice(putIdx, nextRouteIdx !== -1 ? nextRouteIdx : undefined);

        expect(putBody).toContain("domain === 'auth'");
        expect(putBody).toContain('ValidationError');
      }),
      { numRuns: 100 }
    );
  });

  test('POST handler rejects auth-domain creation with ValidationError', async () => {
    const routesSource = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

    fc.assert(
      fc.property(fc.constant(null), () => {
        const postIdx = routesSource.indexOf("routes.post('/'");
        expect(postIdx).not.toBe(-1);

        const nextRouteIdx = routesSource.indexOf('routes.', postIdx + 1);
        const postBody = routesSource.slice(
          postIdx,
          nextRouteIdx !== -1 ? nextRouteIdx : undefined
        );

        expect(postBody).toContain("=== 'auth'");
        expect(postBody).toContain('ValidationError');
      }),
      { numRuns: 100 }
    );
  });
});
