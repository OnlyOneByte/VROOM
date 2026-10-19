/**
 * Every entry in the shared route table must name a page that exists on disk.
 *
 * SvelteKit's `resolve()` is typed against `RouteId`, not `Pathname`: a directory that only holds
 * child routes (e.g. `src/routes/vehicles/` holding `new/` and `[id]/`) is a member of `RouteId`
 * even though it has no `+page.svelte` and 404s at runtime. So `resolve(routes.vehicles)` type-checks,
 * lints and builds cleanly while producing a dead link. Nothing else in the toolchain closes that gap.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { paramRoutes, routes } from '../routes';

// `node:url`/`node:path` rather than the global `URL`: the test environment is happy-dom, whose URL
// implementation does not resolve a relative path against a `file://` base the way Node's does.
const ROUTES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../routes');

/** Route-table values are absolute app paths; map one to its `src/routes/<segments>/+page.svelte`. */
function pageFileFor(routePath: string): string {
	return join(ROUTES_DIR, ...routePath.split('/').filter(Boolean), '+page.svelte');
}

describe('route table entries resolve to real pages', () => {
	test('the route directory was located (so the cases below cannot vacuously pass)', () => {
		expect(existsSync(join(ROUTES_DIR, '+page.svelte'))).toBe(true);
		expect(Object.keys(routes).length + Object.keys(paramRoutes).length).toBeGreaterThan(20);
	});

	test.each(Object.entries(routes))('routes.%s (%s) has a +page.svelte', (_name, routePath) => {
		expect(existsSync(pageFileFor(routePath))).toBe(true);
	});

	// `[id]`-style segments are literal directory names on disk, so they map through verbatim.
	test.each(Object.entries(paramRoutes))(
		'paramRoutes.%s (%s) has a +page.svelte',
		(_name, routePath) => {
			expect(existsSync(pageFileFor(routePath))).toBe(true);
		}
	);
});
