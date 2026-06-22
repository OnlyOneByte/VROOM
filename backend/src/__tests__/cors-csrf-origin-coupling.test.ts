/**
 * Regression GUARD (committed, travels with the merge) for the CORS↔CSRF origin-allowlist coupling
 * (deep-review-adjacent, C92 flagged this surface unaudited).
 *
 * app.ts wires TWO origin-sensitive middlewares from ONE source of truth:
 *   1. `cors({ origin: CONFIG.cors.origins, ... })`  — which cross-origin requests get CORS headers
 *      (so the browser lets the response through).
 *   2. `csrf({ origin: CONFIG.cors.origins })`        — which Origin headers are accepted on
 *      state-changing requests (POST/PUT/DELETE/PATCH); a mismatch is rejected as forgery.
 *
 * These MUST read the SAME allowlist. They are coupled only by both literally referencing
 * `CONFIG.cors.origins` — nothing enforced it. If a future edit drifts them (hands `csrf` a hardcoded
 * list, a narrower/wider const, or an env var `cors` doesn't use), the two trust boundaries split:
 *   - CSRF trusting an origin CORS doesn't (or vice versa) → either a CSRF-protection gap on an origin
 *     the app didn't intend to trust, or legitimate cross-origin state-changing requests silently
 *     rejected as forgery. Both are security/availability regressions (NORTH_STAR #2 isolation), and a
 *     behavioral test that only exercises the happy-path same-origin request stays GREEN, blind to the
 *     drift (the spoof/odd-origin case is the one that isn't routinely exercised).
 *
 * This guard pins the coupling via a source-scan: both middleware calls in app.ts must pass
 * `origin: CONFIG.cors.origins`. Edit either out of lockstep → RED here. The one-edit→source-scan
 * pattern (C25 #36 RAW, C45 #37 atomic, C59 #94 convert, C67 retry-ceiling, C80 export-import columns).
 *
 * Pure source scan — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'app.ts');

// Match a middleware call `cors({ ... })` / `csrf({ ... })` and capture its single argument-object body
// (the calls contain no nested parens/braces, so `[^)]*` to the closing `)` is safe). Whitespace is
// collapsed first so multi-line config bodies match.
const CORS_CALL = /\bcors\(\{([^}]*)\}/;
const CSRF_CALL = /\bcsrf\(\{([^}]*)\}/;

// The origin must be sourced from the shared config getter, not a hardcoded/divergent list.
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
