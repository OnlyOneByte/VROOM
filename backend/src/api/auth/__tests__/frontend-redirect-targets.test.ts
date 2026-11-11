/**
 * Every frontend page the auth routes redirect to must exist in the SvelteKit route tree. A
 * missing page turns a handled OAuth error into a 404. Dynamic targets built from a caller-supplied
 * returnTo cannot be checked statically and are skipped. Pure source scan, no DB or network.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH_ROUTES = join(HERE, '..', 'routes.ts');
const FRONTEND_ROUTES = join(HERE, '..', '..', '..', '..', '..', 'frontend', 'src', 'routes');

/** `${CONFIG.frontend.url}` followed by the literal part of the template string. */
const FRONTEND_REDIRECT = /\$\{CONFIG\.frontend\.url\}([^`$]*)/g;
/** The provider-callback fallback used when the stored OAuth state is gone. */
const RETURN_TO_FALLBACK = /returnTo\s*\?\?\s*'([^']+)'/g;

function authRoutesSrc(): string {
  return readFileSync(AUTH_ROUTES, 'utf8');
}

/** Collect the literal redirect paths, query strings stripped, duplicates removed. */
function redirectPaths(): string[] {
  const src = authRoutesSrc();
  const found = new Set<string>();
  for (const [, raw] of src.matchAll(FRONTEND_REDIRECT)) {
    const path = raw.split('?')[0];
    if (path) found.add(path);
  }
  for (const [, raw] of src.matchAll(RETURN_TO_FALLBACK)) {
    found.add(raw.split('?')[0]);
  }
  return [...found];
}

function pageExists(urlPath: string): boolean {
  let dir = FRONTEND_ROUTES;
  for (const segment of urlPath.split('/').filter(Boolean)) {
    const exact = join(dir, segment);
    if (existsSync(exact) && statSync(exact).isDirectory()) {
      dir = exact;
      continue;
    }
    const dynamic = readdirSync(dir).find(
      (entry) => entry.startsWith('[') && statSync(join(dir, entry)).isDirectory()
    );
    if (!dynamic) return false;
    dir = join(dir, dynamic);
  }
  return existsSync(join(dir, '+page.svelte'));
}

describe('auth route redirects point at frontend pages that exist', () => {
  test('the scan resolves both trees (guard is live, not a no-op)', () => {
    expect(authRoutesSrc().length, `unreadable/empty: ${AUTH_ROUTES}`).toBeGreaterThan(100);
    expect(existsSync(join(FRONTEND_ROUTES, '+page.svelte')), `missing: ${FRONTEND_ROUTES}`).toBe(
      true
    );
    expect(redirectPaths().length).toBeGreaterThanOrEqual(4);
  });

  test('every literal redirect target has a +page.svelte', () => {
    const missing = redirectPaths().filter((path) => !pageExists(path));
    expect(
      missing,
      `auth/routes.ts redirects to frontend pages that do not exist: ${missing.join(', ')}. ` +
        'A user sent there gets a 404 instead of the error (or success) the flow meant to report.'
    ).toEqual([]);
  });

  test('a path that is only a directory of pages is NOT accepted as a page', () => {
    expect(pageExists('/settings/providers')).toBe(false);
    expect(pageExists('/settings/providers/new')).toBe(true);
    expect(pageExists('/auth/login')).toBe(false);
    expect(pageExists('/auth')).toBe(true);
  });
});
