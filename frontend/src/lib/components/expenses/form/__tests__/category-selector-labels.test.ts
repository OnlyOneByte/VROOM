/**
 * Regression GUARD (committed, travels with the merge) for the cycle-201 bug class:
 * a multi-word CategorySelector label that wraps in the 2-col mobile grid.
 *
 * CategorySelector renders its six categories as buttons in a `grid-cols-2` (mobile) /
 * `grid-cols-3` (sm+) grid. Each card is a single icon+label row over a description. A
 * multi-word label ("Misc Operating Costs") wraps to a second line on the narrow mobile
 * column, floating the icon mid-card and breaking the row rhythm against its single-line
 * siblings. cycle 201 fixed it by shortening that label to the single word "Misc" (the
 * description carries the "operating costs" detail; "Misc" also matches the canonical
 * categoryLabels used across tables/charts/dashboard).
 *
 * That fix is just a string literal — under autonomous development a later cycle could
 * reintroduce a multi-word label and silently regress the mobile layout. The per-instance
 * E2E guard (e2e/expense-category-nowrap.meshclaw.e2e.ts) catches it at runtime but is
 * UNTRACKED (*.meshclaw.e2e.ts), so it does NOT survive a merge / fresh checkout. This
 * static source scan does, and pins the whole class: every CategorySelector label must be
 * a single word, so none can wrap in the tightest (2-col) layout.
 *
 * Runs in the fast unit suite (`npm test`) — no browser, no server.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at .../expenses/form/__tests__/; the component is one level up.
const COMPONENT = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'CategorySelector.svelte'
);

// Pull every `label: '...'` (single- or double-quoted) out of the categories array.
// The component has exactly one such array, so a file-wide scan is unambiguous.
const LABEL = /label:\s*(['"])(.*?)\1/g;

function extractLabels(source: string): string[] {
	const labels: string[] = [];
	for (const match of source.matchAll(LABEL)) {
		if (match[2] !== undefined) labels.push(match[2]);
	}
	return labels;
}

describe('CategorySelector labels stay single-word (cycle 201 mobile-wrap guard)', () => {
	const source = readFileSync(COMPONENT, 'utf8');
	const labels = extractLabels(source);

	test('the scan actually found the labels (guard is live, not a no-op)', () => {
		// Six categories: fuel, maintenance, financial, regulatory, enhancement, misc.
		expect(labels.length).toBe(6);
	});

	test('no category label is multi-word (would wrap in the 2-col mobile grid)', () => {
		const offenders = labels.filter((label) => /\s/.test(label.trim()));

		expect(
			offenders,
			`Multi-word CategorySelector label(s) found: ${JSON.stringify(offenders)}. ` +
				'A label with a space wraps to a second line in the grid-cols-2 mobile layout ' +
				'(floating the icon mid-card — cycle 201). Keep the label one word and put the ' +
				'detail in the description instead.'
		).toEqual([]);
	});
});
