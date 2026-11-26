import { afterEach, describe, expect, test } from 'vitest';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { forgetRecentlySynced, recentlySynced, rememberSynced } from '../recently-synced.svelte.ts';

const entry = (id: string): OfflineExpense => ({
	id,
	clientId: `c-${id}`,
	vehicleId: 'v1',
	tags: [],
	category: 'misc',
	amount: 12.34,
	date: '2026-11-26T12:00:00.000Z',
	timestamp: 1,
	synced: true,
	version: '3.0'
});

describe('rows synced before the list page has loaded', () => {
	afterEach(() => forgetRecentlySynced());

	test('are kept newest first until the page forgets them', () => {
		rememberSynced(entry('a'));
		rememberSynced(entry('b'));
		expect(recentlySynced().map(row => row.id)).toEqual(['b', 'a']);

		forgetRecentlySynced();
		expect(recentlySynced()).toEqual([]);
	});

	test('keep only the newest 20', () => {
		for (let i = 0; i < 25; i++) rememberSynced(entry(`e${i}`));
		const ids = recentlySynced().map(row => row.id);
		expect(ids).toHaveLength(20);
		expect(ids[0]).toBe('e24');
		expect(ids).not.toContain('e4');
	});
});
