/**
 * Regression GUARD: every frontend page the auth routes redirect to must actually exist.
 *
 * The OAuth flows end by bouncing the browser to `${CONFIG.frontend.url}<path>` — that is how a
 * user learns the outcome (`/dashboard` on success, `/auth?auth_error=...`, `/profile?link_error=
 * ...`, the provider form's `?provider_error=...`). Nothing couples those literals to the
 * SvelteKit route tree, so a renamed or never-existing page turns a handled error into a 404: the
 * provider callback redirected to `/auth/login`, which has never been a route (the login page is
 * `/auth`), and the provider-state fallback pointed at `/settings/providers`, which is only a
 * directory of two real pages (`new`, `[id]/edit`), not a page itself.
 *
 * The scan takes every literal path interpolated after `CONFIG.frontend.url`, plus the hardcoded
 * `returnTo` fallback, and resolves each against `frontend/src/routes/**\/+page.svelte`. Dynamic
 * targets (`${CONFIG.frontend.url}${path}`, where the path is a caller-supplied returnTo) have no
 * literal to check and are skipped — the fallback literal is what this guard pins.
 *
 * Pure source scan over both trees — no DB, no network.
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
    // '' is the `${CONFIG.frontend.url}${path}` helper — a runtime returnTo, nothing to resolve.
    if (path) found.add(path);
  }
  for (const [, raw] of src.matchAll(RETURN_TO_FALLBACK)) {
    found.add(raw.split('?')[0]);
  }
  return [...found];
}

/**
 * Resolve a URL path against the SvelteKit route tree: each segment must be a directory of that
 * name, or the one dynamic `[param]` directory at that level, and the leaf must hold a
 * `+page.svelte`.
 */
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
    // The known redirect targets must all be found, or the regexes have drifted.
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
    // Pins the resolver itself: /settings/providers holds new/ and [id]/ but no +page.svelte,
    // which is exactly the shape that made the old fallback a 404.
    expect(pageExists('/settings/providers')).toBe(false);
    expect(pageExists('/settings/providers/new')).toBe(true);
    expect(pageExists('/auth/login')).toBe(false);
    expect(pageExists('/auth')).toBe(true);
  });
});
