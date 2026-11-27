import { afterEach, describe, expect, test } from 'vitest';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import {
	forgetRecentlySynced,
	forgetSyncedByClientId,
	recentlySynced,
	rememberSynced,
	syncedExpenseByClientId
} from '../recently-synced.svelte.ts';

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

	test('stop showing once they are older than 30 s', () => {
		rememberSynced(entry('old'), 1_000);
		rememberSynced(entry('new'), 20_000);

		expect(recentlySynced(31_000).map(row => row.id)).toEqual(['new', 'old']);
		expect(recentlySynced(31_001).map(row => row.id)).toEqual(['new']);
		expect(recentlySynced(50_001)).toEqual([]);
	});

	test('keep only the newest 20', () => {
		for (let i = 0; i < 25; i++) rememberSynced(entry(`e${i}`));
		const ids = recentlySynced().map(row => row.id);
		expect(ids).toHaveLength(20);
		expect(ids[0]).toBe('e24');
		expect(ids).not.toContain('e4');
	});

	test('keep the server id, found by client id, and can be forgotten one at a time', () => {
		rememberSynced({ ...entry('a'), serverId: 'srv-a' });
		rememberSynced(entry('b'));

		expect(syncedExpenseByClientId('c-a')).toMatchObject({ id: 'srv-a', amount: 12.34 });
		expect(recentlySynced().map(row => row.id)).toEqual(['b', 'a']);
		expect(syncedExpenseByClientId('c-b')).toBeUndefined();
		expect(syncedExpenseByClientId('c-missing')).toBeUndefined();

		forgetSyncedByClientId('c-a');
		expect(syncedExpenseByClientId('c-a')).toBeUndefined();
		expect(recentlySynced().map(row => row.id)).toEqual(['b']);
	});
});
