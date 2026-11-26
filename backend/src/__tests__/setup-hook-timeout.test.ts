import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { SETUP_TIMEOUT_MS, useTestApp } from '../test-helpers/http-client';
import { scanSetupHooks, setupHooksWithoutTimeout } from '../test-helpers/setup-hook-scan';

const EACH = ['before', 'Each'].join('');
const ALL = ['before', 'All'].join('');

describe('test app setup hooks carry an explicit timeout', () => {
  test.each([
    [`${EACH}(async () => {\n  ctx = await createTestApp();\n});`, 1],
    [`${EACH}(async () => {\n  ctx = await createTestApp();\n}, SETUP_TIMEOUT_MS);`, 0],
    [`${ALL}(async () => {\n  ctx = await createTestApp({ id: "a,b" });\n});`, 1],
    [`${EACH}(async () => {\n  seed(f(1, 2));\n});`, 0],
    [`${EACH}(() => ctx.sqlite.run("DELETE FROM users"));`, 0],
  ])('the scan counts %j as %i', (source, expected) => {
    expect(setupHooksWithoutTimeout(source)).toBe(expected);
  });

  test('no test app setup hook runs on the 5 s default', () => {
    expect(scanSetupHooks(join(import.meta.dir, '..'))).toEqual({});
  });
});

describe('useTestApp', () => {
  const ctx = useTestApp();

  test('builds a fresh app per test with the shared setup timeout', async () => {
    expect(SETUP_TIMEOUT_MS).toBe(30_000);
    const res = await ctx().authed('GET', '/api/v1/auth/me');
    expect(res.status).toBe(200);
  });
});
