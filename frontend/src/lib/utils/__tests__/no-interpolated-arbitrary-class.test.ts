/**
 * Regression GUARD (committed, travels with the merge) for the dead-interpolated-Tailwind-class
 * bug class (cycle 14 found it via DOM probe; cycle 65 fixed the load-bearing instance).
 *
 * Tailwind generates arbitrary-value utilities (e.g. `h-[600px]`) by SCANNING SOURCE TEXT for
 * the literal class at build time. A class built with a runtime `{...}` interpolation —
 * `class="h-[{scrollHeight}] w-full"` or `h-[{CHART_HEIGHT}px]` — is never seen as a literal,
 * so NO CSS rule is generated and the utility is silently dead: the height/width never applies.
 * In ExpensesTable this meant the 600px scroll cap never engaged and a many-row vehicle grew
 * unbounded (the bug fixed in C65 by switching to an inline `style="height: …"`). The e2e harness
 * wouldn't catch it (a too-tall list still "renders"), so this static scan is the net.
 *
 * Scans every .svelte for an interpolated arbitrary value `<util>-[ … { … ]` (the `{` before the
 * closing `]` is the interpolation tell). Static arbitrary values like `h-[600px]` or `w-[1px]`
 * are FINE and never match (no brace). Dynamic sizing must use an inline `style` instead.
 *
 * Runs in the fast unit suite (`npm test`) — no browser, no server.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up from dirname.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// An arbitrary-value Tailwind utility whose bracket body contains a `{` — i.e. a runtime
// interpolation (`h-[{x}]`, `w-[{x}px]`, `min-h-[{x}]`). A static `h-[600px]` has no `{`, so
// it never matches. Requires a `-[` utility prefix preceded by a non-word char (class boundary).
const INTERPOLATED_ARBITRARY = /[\w-]+-\[[^\]]*\{[^\]]*\]/;

/**
 * Two chart components carry a `h-[{CHART_HEIGHT}px]` on the inner Chart.Container that is the
 * SAME dead class, but is HARMLESS there: each passes `height={CHART_HEIGHT}` to its ChartCard
 * wrapper, which sets the real height in an inline style, so the container just fills a
 * correctly-sized parent (verified C14/C65). They are excluded so the guard stays zero-tolerance
 * for the LOAD-BEARING case without forcing an eyes-on chart edit. If a chart ever loses its
 * wrapper height, that's a separate (visible) regression — revisit this exclusion then.
 */
const KNOWN_MASKED = new Set([
	'lib/components/charts/ExpenseTrendChart.svelte',
	'lib/components/charts/FuelEfficiencyTrendChart.svelte'
]);

function stripComments(source: string): string {
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
	return withoutBlocks
		.split('\n')
		.map(line => {
			const trimmed = line.trimStart();
			// Svelte/HTML comment or JSDoc continuation — drop it (so the explanatory comment
			// in ExpensesTable that QUOTES `h-[{scrollHeight}]` isn't a false positive).
			if (trimmed.startsWith('*') || trimmed.startsWith('<!--') || trimmed.startsWith('-->'))
				return '';
			const idx = line.indexOf('//');
			if (idx === -1) return line;
			if (idx > 0 && line[idx - 1] === ':') return line; // keep URLs
			return line.slice(0, idx);
		})
		.join('\n');
}

describe('no interpolated arbitrary Tailwind classes (dead-class guard — C14/C65)', () => {
	const files = collectSvelteFiles(SRC_ROOT);

	test('the scan actually found .svelte sources (guard is live, not a no-op)', () => {
		expect(files.length).toBeGreaterThan(30);
	});

	test('no .svelte uses an interpolated arbitrary value class (use an inline style instead)', () => {
		const offenders: string[] = [];

		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
			if (KNOWN_MASKED.has(rel)) continue;

			const rawLines = readFileSync(file, 'utf8').split('\n');
			const cleanLines = stripComments(rawLines.join('\n')).split('\n');
			cleanLines.forEach((line, idx) => {
				if (INTERPOLATED_ARBITRARY.test(line)) {
					offenders.push(`${rel}:${idx + 1}  ${(rawLines[idx] ?? line).trim()}`);
				}
			});
		}

		expect(
			offenders,
			`Interpolated arbitrary Tailwind class(es) found — Tailwind can't generate a rule for a runtime-interpolated arbitrary value, so the utility is silently dead. Use an inline style="..." for dynamic sizing instead (C14/C65):\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
