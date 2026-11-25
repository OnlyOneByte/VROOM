import { flushSync } from 'svelte';
import { describe, expect, test } from 'vitest';
import { offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
import type { ExpenseSummary } from '#lib/types/index.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { dateOnlyToISO } from '#lib/utils/formatters.ts';
import {
	matchesFilters,
	pendingExpenseRow,
	pendingRowState,
	withPendingByMonth,
	withPendingInSummary,
	withRowsInBreakdowns,
	withoutRowsInBreakdowns
} from '../pending-rows.ts';
import { usePendingRows } from '../pending-rows.svelte.ts';

function entry(id: string, overrides: Partial<OfflineExpense> = {}): OfflineExpense {
	return {
		id,
		clientId: `client-${id}`,
		vehicleId: 'v1',
		tags: ['commute'],
		category: 'fuel',
		amount: 40,
		date: dateOnlyToISO('2026-11-20'),
		description: 'Arco',
		timestamp: 1000,
		synced: false,
		...overrides
	};
}

describe('pending row state', () => {
	test('a queued entry is saving until it fails', () => {
		expect(pendingRowState(entry('a'))).toEqual({ status: 'saving' });
	});

	test('a server refusal is failed, with its reason, and can be edited', () => {
		expect(
			pendingRowState(entry('a', { needsAttention: true, attentionReason: 'Mileage too low' }))
		).toEqual({ status: 'failed', error: 'Mileage too low', editable: true, reachedServer: false });
	});

	test('a network failure is failed with its error but is retried, not edited', () => {
		expect(pendingRowState(entry('a', { lastError: 'Server down' }))).toEqual({
			status: 'failed',
			error: 'Server down',
			editable: false,
			reachedServer: false
		});
	});

	test('an entry that reached the server but lost a photo cannot be edited as a new one', () => {
		expect(
			pendingRowState(entry('a', { needsAttention: true, attentionReason: 'x', serverId: 's1' }))
				.editable
		).toBe(false);
	});

	test('the row keeps what was typed', () => {
		expect(pendingExpenseRow(entry('a', { mileage: 41000, volume: 10.2 }))).toMatchObject({
			id: 'a',
			vehicleId: 'v1',
			category: 'fuel',
			amount: 40,
			description: 'Arco',
			mileage: 41000,
			volume: 10.2,
			tags: ['commute']
		});
	});
});

describe('pending rows and the list filters', () => {
	const row = pendingExpenseRow(entry('a'));

	test.each([
		[{ vehicleId: 'v1' }, true],
		[{ vehicleId: 'v2' }, false],
		[{ categories: ['fuel', 'misc'] }, true],
		[{ categories: ['misc'] }, false],
		[{ startDate: '2026-11-20', endDate: '2026-11-20' }, true],
		[{ startDate: '2026-11-21' }, false],
		[{ search: 'arc' }, true],
		[{ search: 'shell' }, false],
		[{ tags: ['commute'] }, true],
		[{ tags: ['trip'] }, false]
	])('%o matches: %s', (filters, expected) => {
		expect(matchesFilters(row, filters)).toBe(expected);
	});
});

describe('totals with rows that are still saving', () => {
	const rows = [pendingExpenseRow(entry('a')), pendingExpenseRow(entry('b', { amount: 10 }))];

	test('the summary counts them', () => {
		const summary = { totalAmount: 100, expenseCount: 4, recentAmount: 20 } as ExpenseSummary;
		expect(withPendingInSummary(summary, rows, new Date(2026, 10, 24).getTime())).toMatchObject({
			totalAmount: 150,
			expenseCount: 6,
			recentAmount: 70
		});
	});

	test('edited rows go back into the trend and breakdown, adding a category it lacked', () => {
		const summary = {
			monthlyTrend: [{ period: '2026-11', amount: 100, count: 1 }],
			categoryBreakdown: [{ category: 'fuel', amount: 100, count: 1 }]
		} as ExpenseSummary;
		const misc = pendingExpenseRow(entry('c', { category: 'misc', amount: 30 }));
		const result = withRowsInBreakdowns(summary, [rows[0]!, misc]);
		expect(result?.monthlyTrend).toEqual([{ period: '2026-11', amount: 170, count: 3 }]);
		expect(result?.categoryBreakdown).toEqual([
			{ category: 'fuel', amount: 140, count: 2 },
			{ category: 'misc', amount: 30, count: 1 }
		]);
	});

	test('rows being deleted leave the monthly trend and the category breakdown', () => {
		const summary = {
			monthlyTrend: [
				{ period: '2026-11', amount: 200, count: 4 },
				{ period: '2026-10', amount: 80, count: 1 }
			],
			categoryBreakdown: [
				{ category: 'fuel', amount: 150, count: 3 },
				{ category: 'misc', amount: 50, count: 1 }
			]
		} as ExpenseSummary;
		const misc = pendingExpenseRow(entry('c', { category: 'misc', amount: 50 }));
		const result = withoutRowsInBreakdowns(summary, [...rows, misc]);
		expect(result?.monthlyTrend).toEqual([
			{ period: '2026-11', amount: 100, count: 1 },
			{ period: '2026-10', amount: 80, count: 1 }
		]);
		expect(result?.categoryBreakdown).toEqual([{ category: 'fuel', amount: 100, count: 1 }]);
	});

	test('their month total grows, and other months stay', () => {
		const totals = new Map([
			['2026-11', 200],
			['2026-10', 80]
		]);
		expect([...withPendingByMonth(totals, rows)]).toEqual([
			['2026-11', 250],
			['2026-10', 80]
		]);
	});
});

describe('usePendingRows', () => {
	test('a row that syncs stays on screen until the refreshed list has loaded', async () => {
		let release: () => void = () => {};
		let refreshes = 0;
		offlineExpenseQueue.current = [entry('a'), entry('b', { timestamp: 2000 })];
		let pending!: ReturnType<typeof usePendingRows>;
		const stop = $effect.root(() => {
			pending = usePendingRows({
				match: () => true,
				refresh: () => {
					refreshes++;
					return new Promise<void>(resolve => (release = resolve));
				}
			});
		});
		flushSync();
		expect(pending.rows.map(row => row.id)).toEqual(['b', 'a']);

		offlineExpenseQueue.current = [entry('a'), entry('b', { timestamp: 2000, synced: true })];
		flushSync();
		expect(refreshes).toBe(1);
		expect(pending.rows.map(row => row.id)).toEqual(['b', 'a']);

		release();
		await Promise.resolve();
		await Promise.resolve();
		flushSync();
		expect(pending.rows.map(row => row.id)).toEqual(['a']);
		stop();
		offlineExpenseQueue.current = [];
	});

	test('a synced row survives the queue being cleared while the refresh is still loading', async () => {
		let release: () => void = () => {};
		offlineExpenseQueue.current = [entry('a')];
		let pending!: ReturnType<typeof usePendingRows>;
		const stop = $effect.root(() => {
			pending = usePendingRows({
				match: () => true,
				refresh: () => new Promise<void>(resolve => (release = resolve))
			});
		});
		flushSync();

		offlineExpenseQueue.current = [entry('a', { synced: true })];
		flushSync();
		offlineExpenseQueue.current = [];
		flushSync();
		expect(pending.rows.map(row => row.id)).toEqual(['a']);

		release();
		await Promise.resolve();
		await Promise.resolve();
		flushSync();
		expect(pending.rows).toEqual([]);
		stop();
	});

	test('a kept row hides as soon as the list shows its server copy, before the refresh settles', () => {
		offlineExpenseQueue.current = [entry('a')];
		let listed = $state(new Set<string>());
		let pending!: ReturnType<typeof usePendingRows>;
		const stop = $effect.root(() => {
			pending = usePendingRows({
				match: () => true,
				refresh: () => new Promise<void>(() => {}),
				listedIds: () => listed
			});
		});
		flushSync();

		offlineExpenseQueue.current = [entry('a', { synced: true, serverId: 'srv-a' })];
		flushSync();
		offlineExpenseQueue.current = [];
		flushSync();
		expect(pending.rows.map(row => row.id)).toEqual(['a']);

		listed = new Set(['srv-a']);
		flushSync();
		expect(pending.rows).toEqual([]);
		stop();
	});

	test('a new row shows at once, with no refresh', () => {
		let refreshes = 0;
		offlineExpenseQueue.current = [];
		let pending!: ReturnType<typeof usePendingRows>;
		const stop = $effect.root(() => {
			pending = usePendingRows({
				match: () => true,
				refresh: async () => {
					refreshes++;
				}
			});
		});
		flushSync();
		offlineExpenseQueue.current = [entry('a')];
		flushSync();
		expect(pending.rows.map(row => row.id)).toEqual(['a']);
		expect(pending.states.get('a')).toEqual({ status: 'saving' });
		expect(refreshes).toBe(0);
		stop();
		offlineExpenseQueue.current = [];
	});
});
