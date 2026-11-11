/**
 * The offline-sync conflict dialog must stay OFF the root layout's eager chunk, and once loaded it
 * must stay mounted.
 *
 * It used to be rendered unconditionally in `+layout.svelte`, so every route — every cold load —
 * paid for its dialog/scroll-area/alert chrome (14.0 KB raw / 4.4 KB gzip measured in the root
 * chunk) to show a modal that only appears when a queued offline write collides with the server.
 *
 * The obvious gate, `{#if syncConflicts.current.length > 0}`, trades that for a worse bug:
 * resolving the LAST conflict empties the list and calls closeModal() in the same flush, so the
 * component would be destroyed mid-close — no exit transition, and closeModal running against a
 * tearing-down tree. The layout therefore loads the module on the first conflict and NEVER drops
 * it. Both halves of that are structural, and both are invisible at runtime until someone hits a
 * conflict, so they are pinned here against the layout source.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const LAYOUT_SRC = readFileSync(`${process.cwd()}/src/routes/+layout.svelte`, 'utf8');
const RESOLVER = '$lib/components/sync/SyncConflictResolver.svelte';

describe('root layout loads the sync conflict resolver lazily', () => {
	test('it is NOT statically imported (that is what put it on every route)', () => {
		expect(LAYOUT_SRC).not.toMatch(
			new RegExp(`import\\s+\\w+\\s+from\\s+'${RESOLVER.replace(/[$/.]/g, '\\$&')}'`)
		);
	});

	test('it IS reachable through a dynamic import', () => {
		expect(LAYOUT_SRC).toContain(`import('${RESOLVER}')`);
	});

	test('the conflict signal comes from the lightweight sync-state module', () => {
		// sync-manager re-exports the same signal, but importing it here would add an edge to a
		// 388-line module for a length check.
		expect(LAYOUT_SRC).toContain("from '$lib/utils/sync/sync-state.svelte'");
	});

	test('the loaded component is never unset — no destroy mid-close', () => {
		// Exactly two mentions of the binding as an assignment target: the `$state(null)`
		// declaration, and the one that stores the module's default export.
		const assignments = LAYOUT_SRC.match(/SyncConflictResolver\s*=\s*[^=]/g) ?? [];
		expect(assignments).toHaveLength(2);
		expect(LAYOUT_SRC).toMatch(/SyncConflictResolver\s*=\s*\$state<[^>]*>\(null\)/);
		expect(LAYOUT_SRC).toMatch(/SyncConflictResolver\s*=\s*module\.default/);
		// And the render gate must test the loaded component, not the conflict list — gating on the
		// list is what would unmount the dialog as the user resolves the last conflict.
		expect(LAYOUT_SRC).toContain('{#if SyncConflictResolver}');
		expect(LAYOUT_SRC).not.toMatch(/\{#if\s+syncConflicts\.current\.length/);
	});
});
