/**
 * The recursive `.svelte` walker lives in one place (`./collect-svelte-files.ts`); source-scan
 * guards import it rather than re-declaring it.
 *
 * The drift this pins: enumerating every `.svelte` is the obvious boilerplate for a new source-scan
 * guard, so the natural move is to paste the walker in locally again — which silently un-converges
 * back toward a copy per guard, each free to disagree about which directories to skip. A guard that
 * walks a subtly different tree reports a subtly different answer, and nothing says so.
 *
 * Scope is the `collectSvelteFiles` SYMBOL only, not the `readdirSync(…, withFileTypes)` idiom in
 * general. A separate, differently-shaped `collectSourceFiles` family (collects `.ts` AND `.svelte`)
 * legitimately exists, and this guard's own `collectTestFiles` walks `.test.ts` — matching the raw
 * idiom would flag both.
 *
 * There is no allowlist: the shared helper is a `.ts` file, and the walk below only collects
 * `.test.ts`, so it is out of scope structurally rather than by exemption. (It previously carried an
 * allowlist entry naming the helper, which could never match anything.) The helper's own existence
 * is asserted separately — the scan passing because the helper vanished would be the one way this
 * could read green while the convergence was gone.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ratchet } from './debt-ratchet';

// This file lives at src/lib/utils/__tests__/_helpers/, so __tests__/ is one dir up.
const TESTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A local re-declaration of the exact symbol that was converged. */
const LOCAL_WALKER_DECL = /function\s+collectSvelteFiles\s*\(/;

function collectTestFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectTestFiles(full, acc);
		} else if (entry.name.endsWith('.test.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

const files = collectTestFiles(TESTS_ROOT);

ratchet({
	name: 'no duplicate .svelte file-walker in the source-scan guard suite',
	tolerated: [],
	guidance:
		'Source-scan guard(s) re-declaring the .svelte file-walker locally, which un-converges the ' +
		"shared walker. Import { collectSvelteFiles } from './_helpers/collect-svelte-files' " +
		"(or '../_helpers/…' by depth) instead:",
	scan: () =>
		files
			.map(file => ({ file, rel: relative(TESTS_ROOT, file).split('\\').join('/') }))
			// This file quotes the declaration as a probe fixture, so it always matches itself.
			.filter(({ rel }) => rel !== '_helpers/no-duplicate-file-walker.test.ts')
			.filter(({ file }) => LOCAL_WALKER_DECL.test(readFileSync(file, 'utf-8')))
			.map(({ rel }) => rel),
	probe: () => {
		expect(LOCAL_WALKER_DECL.test('function collectSvelteFiles(dir: string) {')).toBe(true);
		expect(LOCAL_WALKER_DECL.test('export function collectSvelteFiles (dir) {')).toBe(true);
		// An IMPORT of the shared helper is the correct form and must not match.
		expect(
			LOCAL_WALKER_DECL.test(
				"import { collectSvelteFiles } from './_helpers/collect-svelte-files';"
			)
		).toBe(false);
		// Neither may the other walker families.
		expect(LOCAL_WALKER_DECL.test('function collectSourceFiles(dir: string) {')).toBe(false);
		expect(LOCAL_WALKER_DECL.test('function collectTestFiles(dir: string) {')).toBe(false);
		expect(
			files.length,
			'the .test.ts walk found almost nothing — TESTS_ROOT is wrong'
		).toBeGreaterThan(10);
	}
});

describe('the converged walker is still there', () => {
	test('the shared helper exists and still exports collectSvelteFiles', () => {
		// Without this, deleting the helper would make the scan above pass by vacuity: no file
		// re-declares the walker because nothing uses it any more.
		const helper = join(TESTS_ROOT, '_helpers/collect-svelte-files.ts');
		expect(readFileSync(helper, 'utf-8')).toMatch(/export function collectSvelteFiles\s*\(/);
	});
});
