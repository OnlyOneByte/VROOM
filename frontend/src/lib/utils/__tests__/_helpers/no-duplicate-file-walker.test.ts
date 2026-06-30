/**
 * Meta-GUARD (committed) pairing the C275 rule-of-four convergence: the recursive `.svelte` file
 * walker (`collectSvelteFiles`) now lives in ONE shared helper (./collect-svelte-files.ts), and the
 * four source-scan guards that used to re-declare it byte-identically (no-hardcoded-currency,
 * no-interpolated-arbitrary-class, no-theme-clashing-colors, fab-bottom-clearance) import it.
 *
 * The drift this pins: a FUTURE source-scan guard is the natural place to copy the `.svelte` walker
 * locally again (it's the obvious "I need to enumerate every .svelte" boilerplate) — silently
 * un-converging C275 back toward five copies. This scan fails the moment any *.test.ts under __tests__
 * declares its OWN `function collectSvelteFiles` instead of importing the shared helper.
 *
 * SCOPE (narrow, deliberately): this pins the `collectSvelteFiles` symbol ONLY — the exact thing C275
 * converged. It does NOT flag the bare `readdirSync(... withFileTypes)` idiom in general, because a
 * SEPARATE, differently-shaped walker family exists — `collectSourceFiles` (collects .ts + .svelte;
 * in no-native-dialogs / no-utc-date-input / no-utc-month-parse) — which is its OWN un-converged
 * rule-of-three (found C276, FILED as a follow-on arch target, NOT yet deduped). Over-flagging the
 * raw idiom would false-positive on that family + on this guard's own collectTestFiles (the C271
 * over-flag lesson). Keep this guard honest to what C275 actually converged.
 *
 * The shared helper itself (collect-svelte-files.ts) is the ONE sanctioned home, allowlisted below.
 * Pure node:fs/path — runs in the fast unit suite, no browser/server.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at src/lib/utils/__tests__/_helpers/, so __tests__/ is one dir up.
const TESTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The sole sanctioned home for the walker — the shared helper this guard pairs with.
const ALLOWLIST = new Set<string>(['_helpers/collect-svelte-files.ts']);

// A local re-declaration of the EXACT symbol C275 converged. Scoped to the name (not the raw
// readdir idiom) so it doesn't false-positive on the separate collectSourceFiles family or on
// this guard's own collectTestFiles (the C271 over-flag lesson).
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

describe('no duplicate .svelte file-walker in the source-scan guard suite (C275 convergence guard)', () => {
	const files = collectTestFiles(TESTS_ROOT);

	test('the scan actually found .test.ts sources (guard is live, not a no-op)', () => {
		expect(files.length).toBeGreaterThan(10);
	});

	test('no *.test.ts re-declares the file-walker locally — import the shared helper instead', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const rel = relative(TESTS_ROOT, file).split('\\').join('/');
			if (ALLOWLIST.has(rel)) continue;
			const src = readFileSync(file, 'utf-8');
			if (LOCAL_WALKER_DECL.test(src)) {
				offenders.push(rel);
			}
		}
		expect(
			offenders,
			`Source-scan guard(s) re-declaring the .svelte file-walker locally — this silently un-converges ` +
				`the C275 dedup. Import { collectSvelteFiles } from './_helpers/collect-svelte-files' (or ` +
				`'../_helpers/...' by depth) instead:\n${offenders.join('\n')}`
		).toEqual([]);
	});

	test('the shared helper still exists + still exports the walker (no stale allowlist / convergence intact)', () => {
		const helper = join(TESTS_ROOT, '_helpers/collect-svelte-files.ts');
		const src = readFileSync(helper, 'utf-8');
		expect(src).toMatch(/export function collectSvelteFiles\s*\(/);
	});
});
