import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { paramRoutes, routes } from '../routes';

const ROUTES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../routes');

function pageFileFor(routePath: string): string {
	return join(ROUTES_DIR, ...routePath.split('/').filter(Boolean), '+page.svelte');
}

describe('route table entries resolve to real pages', () => {
	test('the route directory was located', () => {
		expect(existsSync(join(ROUTES_DIR, '+page.svelte'))).toBe(true);
		expect(Object.keys(routes).length + Object.keys(paramRoutes).length).toBeGreaterThan(20);
	});

	test.each(Object.entries(routes))('routes.%s (%s) has a +page.svelte', (_name, routePath) => {
		expect(existsSync(pageFileFor(routePath))).toBe(true);
	});

	test.each(Object.entries(paramRoutes))(
		'paramRoutes.%s (%s) has a +page.svelte',
		(_name, routePath) => {
			expect(existsSync(pageFileFor(routePath))).toBe(true);
		}
	);
});
