import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ratchet } from './debt-ratchet';

const TESTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
			.filter(({ rel }) => rel !== '_helpers/no-duplicate-file-walker.test.ts')
			.filter(({ file }) => LOCAL_WALKER_DECL.test(readFileSync(file, 'utf-8')))
			.map(({ rel }) => rel),
	probe: () => {
		expect(LOCAL_WALKER_DECL.test('function collectSvelteFiles(dir: string) {')).toBe(true);
		expect(LOCAL_WALKER_DECL.test('export function collectSvelteFiles (dir) {')).toBe(true);
		expect(
			LOCAL_WALKER_DECL.test(
				"import { collectSvelteFiles } from './_helpers/collect-svelte-files';"
			)
		).toBe(false);
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
		const helper = join(TESTS_ROOT, '_helpers/collect-svelte-files.ts');
		expect(readFileSync(helper, 'utf-8')).toMatch(/export function collectSvelteFiles\s*\(/);
	});
});
