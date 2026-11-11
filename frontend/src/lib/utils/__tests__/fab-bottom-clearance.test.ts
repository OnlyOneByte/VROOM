import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROUTES_ROOT = join(SRC_ROOT, 'routes');

const USES_FAB = /FloatingActionButton|common\/floating-action-button/;
const HAS_BOTTOM_CLEARANCE = /\bpb-(?:16|20|24|28|32|36|40)\b/;

describe('every FloatingActionButton page reserves bottom clearance', () => {
	const routeFiles = collectSvelteFiles(ROUTES_ROOT);

	test('the scan found route sources (guard is live, not a no-op)', () => {
		expect(routeFiles.length).toBeGreaterThan(10);
	});

	test('the FAB is actually used somewhere (else this guard is vacuous)', () => {
		const fabPages = routeFiles.filter(f => USES_FAB.test(readFileSync(f, 'utf8')));
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
				`fixed FAB would permanently cover the last row / pagination (reachability). Wrap the ` +
				`page content in pb-24 (the established clearance), as expenses/insurance/vehicles[id]/dashboard do:\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
