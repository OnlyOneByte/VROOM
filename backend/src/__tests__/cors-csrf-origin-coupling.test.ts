import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'app.ts');

const CORS_CALL = /\bcors\(\{([^}]*)\}/;
const CSRF_CALL = /\bcsrf\(\{([^}]*)\}/;

const ORIGIN_FROM_CONFIG = /origin\s*:\s*CONFIG\.cors\.origins\b/;

function appSrcCollapsed(): string {
  return readFileSync(APP, 'utf8').replace(/\s+/g, ' ');
}

describe('CORS and CSRF derive their origin allowlist from the same source (CONFIG.cors.origins)', () => {
  test('the scan resolves app.ts (guard is live, not a no-op)', () => {
    expect(readFileSync(APP, 'utf8').length, `unreadable/empty: ${APP}`).toBeGreaterThan(100);
  });

  test('cors() is configured with origin: CONFIG.cors.origins', () => {
    const body = appSrcCollapsed().match(CORS_CALL)?.[1];
    expect(body, 'Could not find a `cors({ ... })` middleware call in app.ts').toBeTruthy();
    expect(
      ORIGIN_FROM_CONFIG.test(body ?? ''),
      `cors() must read its origin allowlist from CONFIG.cors.origins (the shared source CSRF also uses). ` +
        `A hardcoded or divergent list here splits the two trust boundaries. Found: ${body?.trim()}`
    ).toBe(true);
  });

  test('csrf() is configured with origin: CONFIG.cors.origins', () => {
    const body = appSrcCollapsed().match(CSRF_CALL)?.[1];
    expect(body, 'Could not find a `csrf({ ... })` middleware call in app.ts').toBeTruthy();
    expect(
      ORIGIN_FROM_CONFIG.test(body ?? ''),
      `csrf() must read its origin allowlist from CONFIG.cors.origins (the SAME source cors() uses). ` +
        `If csrf trusts a different set than cors, state-changing requests from an origin one accepts ` +
        `and the other rejects either bypass CSRF or are wrongly rejected as forgery. Found: ${body?.trim()}`
    ).toBe(true);
  });

  test('both middlewares reference the IDENTICAL origin source (no drift)', () => {
    const src = appSrcCollapsed();
    const corsOrigin = src.match(CORS_CALL)?.[1]?.match(/origin\s*:\s*([\w.]+)/)?.[1];
    const csrfOrigin = src.match(CSRF_CALL)?.[1]?.match(/origin\s*:\s*([\w.]+)/)?.[1];
    expect(corsOrigin, 'no origin expr found in cors()').toBeTruthy();
    expect(csrfOrigin, 'no origin expr found in csrf()').toBeTruthy();
    expect(
      csrfOrigin,
      `CORS origin source (${corsOrigin}) and CSRF origin source (${csrfOrigin}) have DRIFTED. ` +
        `They must reference the identical allowlist so the two trust boundaries can't split.`
    ).toBe(corsOrigin);
  });
});
