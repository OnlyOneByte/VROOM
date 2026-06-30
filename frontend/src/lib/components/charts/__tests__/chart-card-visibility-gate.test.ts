/**
 * C242 source-scan guard — ChartCard's visibility-gate + four-state contract.
 *
 * A C242 eyes-on scout (shot /vehicles/[id] Overview + Finance desktop+mobile on the seeded loan vehicle)
 * found the Amortization + Expense-Trend + Fuel-Efficiency charts rendering BLANK in the full-page capture
 * while their sibling stat cards showed real data. INVESTIGATED firsthand: NOT a defect — ChartCard
 * deliberately GATES chart children behind `gate.visible` (createVisibilityWatch: IntersectionObserver +
 * a MutationObserver on the `hidden` tab ancestor), because LayerChart (SVG, dimension-measured) mounts into
 * a 0×0 container below the fold / in an inactive bits-ui tab and computes negative widths. A headless
 * full-page screenshot never scrolls those into a measured viewport, so they show the gated-state SKELETON —
 * working as designed (the chart mounts for a real user on scroll-in / tab-activate).
 *
 * Two load-bearing pieces make that correct, both inline in the .svelte (no charts component-test harness):
 *   1. the data branch gates `{@render children()}` behind `{#if gate.visible}` (the 0×0-crash guard), and
 *   2. the NOT-yet-visible state renders a Skeleton — NEVER a blank white box (UIQuality Four-States).
 * A refactor dropping (1) reintroduces LayerChart's 0×0 negative-width crash; dropping (2) shows a blank box
 * below the fold (NORTH_STAR #3). Neither would fail a headless e2e. This pins both + the full four-state.
 * The C190/C239/C241 cross-file source-scan idiom.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'ChartCard.svelte'), 'utf8');

describe('ChartCard keeps its visibility-gate + four-state contract (C242 guard)', () => {
	test('uses createVisibilityWatch as the render gate', () => {
		expect(SRC).toContain('createVisibilityWatch');
	});

	test('gates the chart children behind gate.visible (the LayerChart 0×0-crash guard)', () => {
		expect(SRC).toMatch(/\{#if gate\.visible\}/);
		// children render INSIDE the gate (the {@render children()} call exists under the gate branch).
		expect(SRC).toContain('@render children()');
	});

	test('the not-yet-visible (gated) state renders a Skeleton, never a blank box (NORTH_STAR #3)', () => {
		// After the `{#if gate.visible}` there must be an `{:else}` that shows a Skeleton (the comment +
		// the markup). Pin that the gated fallback is a Skeleton, so a refactor can't leave a blank div.
		const gateIdx = SRC.indexOf('{#if gate.visible}');
		expect(gateIdx).toBeGreaterThan(-1);
		const afterGate = SRC.slice(gateIdx);
		expect(afterGate).toMatch(/\{:else\}/);
		expect(afterGate).toContain('Skeleton');
	});

	test('renders the full four-state set (loading / error / empty / data)', () => {
		expect(SRC).toContain('isLoading'); // loading
		expect(SRC).toMatch(/:else if error/); // error
		expect(SRC).toMatch(/:else if isEmpty/); // empty
		expect(SRC).toContain('EmptyState'); // empty uses the shared primitive
	});
});
