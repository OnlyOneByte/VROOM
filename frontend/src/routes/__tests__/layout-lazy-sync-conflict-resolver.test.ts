import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const LAYOUT_SRC = readFileSync(`${process.cwd()}/src/routes/+layout.svelte`, 'utf8');
const RESOLVER = '#lib/components/sync/SyncConflictResolver.svelte';

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
		expect(LAYOUT_SRC).toContain("from '#lib/utils/sync/sync-state.svelte.ts'");
	});

	test('the loaded component is never unset — no destroy mid-close', () => {
		const assignments = LAYOUT_SRC.match(/SyncConflictResolver\s*=\s*[^=]/g) ?? [];
		expect(assignments).toHaveLength(2);
		expect(LAYOUT_SRC).toMatch(/SyncConflictResolver\s*=\s*\$state<[^>]*>\(null\)/);
		expect(LAYOUT_SRC).toMatch(/SyncConflictResolver\s*=\s*module\.default/);
		expect(LAYOUT_SRC).toContain('{#if SyncConflictResolver}');
		expect(LAYOUT_SRC).not.toMatch(/\{#if\s+syncConflicts\.current\.length/);
	});
});
