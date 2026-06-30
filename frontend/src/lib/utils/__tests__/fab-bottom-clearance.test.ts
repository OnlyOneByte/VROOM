/**
 * Regression GUARD (committed, travels with the merge) for the FloatingActionButton bottom-clearance class.
 *
 * `floating-action-button.svelte` is `position: fixed` at `bottom-4 … right-4` (full-width on mobile,
 * bottom-right on `sm:`). Because it's FIXED, it floats OVER the page's scroll content — so the page's
 * LAST row (the final expense / vehicle / pagination control) sits behind it unless the page reserves
 * bottom padding to clear it. Every FAB page today wraps its content in `pb-24` for exactly this; a C241
 * eyes-on scout (shot /expenses desktop+mobile) certified the FAB floats over the pb-24 gap, NOT over data,
 * and the four FAB pages (expenses / insurance / vehicles[id] / dashboard) are all consistent.
 *
 * Nothing pinned that correspondence: a future page that adds the FAB WITHOUT a `pb-*` clearance would
 * permanently occlude its last row/control behind the fixed button (a NORTH_STAR #3 reachability defect),
 * and neither the unit suite nor a headless e2e (which doesn't assert overlap) would catch it. This scans
 * every route .svelte: if it imports FloatingActionButton, it MUST also carry a `pb-{16,20,24,28,32}`
 * bottom-padding class. The C190/no-native-dialogs cross-file source-scan idiom.
 *
 * Runs in the fast unit suite (no browser, no server).
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up; routes/ is under it.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROUTES_ROOT = join(SRC_ROOT, 'routes');

// Imports the FAB (by component name or the module path — either form counts).
const USES_FAB = /FloatingActionButton|common\/floating-action-button/;
// A generous bottom-clearance: pb-16 or larger (the established value is pb-24).
const HAS_BOTTOM_CLEARANCE = /\bpb-(?:16|20|24|28|32|36|40)\b/;

describe('every FloatingActionButton page reserves bottom clearance (C241 guard)', () => {
	const routeFiles = collectSvelteFiles(ROUTES_ROOT);

	test('the scan found route sources (guard is live, not a no-op)', () => {
		expect(routeFiles.length).toBeGreaterThan(10);
	});

	test('the FAB is actually used somewhere (else this guard is vacuous)', () => {
		const fabPages = routeFiles.filter((f) => USES_FAB.test(readFileSync(f, 'utf8')));
		expect(fabPages.length).toBeGreaterThanOrEqual(4);
	});

	test('no FAB page renders the fixed button without a pb-* clearance (last row would be occluded)', () => {
		const offenders: string[] = [];
		for (const file of routeFiles) {
			const src = readFileSync(file, 'utf8');
			if (!USES_FAB.test(src)) continue;
			if (!HAS_BOTTOM_CLEARANCE.test(src)) {
				offenders.push(relative(SRC_ROOT, file).split('\\').join('/'));
			}
		}
		expect(
			offenders,
			`Page(s) use FloatingActionButton (position: fixed) WITHOUT a pb-{16..40} bottom clearance — the ` +
				`fixed FAB would permanently cover the last row / pagination (NORTH_STAR #3 reachability). Wrap the ` +
				`page content in pb-24 (the established clearance), as expenses/insurance/vehicles[id]/dashboard do:\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
