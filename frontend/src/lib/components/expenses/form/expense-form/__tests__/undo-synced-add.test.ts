import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';

const appStore = vi.hoisted(() => ({ addNotification: vi.fn(), dismissToast: vi.fn() }));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore }));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: { createExpense: vi.fn(), deleteExpense: vi.fn() }
}));
const scheduleDelete = vi.hoisted(() => vi.fn());
vi.mock('#lib/utils/pending-deletes.svelte.ts', () => ({ scheduleDelete, UNDO_WINDOW_MS: 5000 }));
vi.mock('#lib/utils/offline-storage.ts', () => ({
	loadOfflineExpenses: () => [],
	removeOfflineExpense: vi.fn()
}));

import { expenseApi } from '#lib/services/expense-api.ts';
import {
	forgetRecentlySynced,
	recentlySynced,
	rememberSynced
} from '#lib/utils/sync/recently-synced.svelte.ts';
import { undoAdd } from '../saved-toast.ts';

const queued: OfflineExpense = {
	id: 'device-1',
	clientId: 'client-1',
	vehicleId: 'v1',
	tags: [],
	category: 'misc',
	amount: 12,
	date: '2026-11-27T12:00:00.000Z',
	timestamp: 1,
	synced: true,
	version: '3.0'
};
const payload = { vehicleId: 'v1', category: 'misc' as const, amount: 12 };

describe('Undo on the Saved toast after the add has synced', () => {
	beforeEach(() => vi.resetAllMocks());
	afterEach(() => forgetRecentlySynced());

	test('deletes by the server id, with no second create request', async () => {
		rememberSynced({ ...queued, serverId: 'srv-1' });

		await undoAdd({ clientId: 'client-1', payload });

		expect(expenseApi.createExpense).not.toHaveBeenCalled();
		expect(scheduleDelete).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'srv-1', amount: 12 })
		);
		expect(recentlySynced()).toEqual([]);
	});

	test('without a remembered server id, falls back to the replayed create', async () => {
		const saved = { ...payload, id: 'srv-2' };
		vi.mocked(expenseApi.createExpense).mockResolvedValueOnce(saved as never);

		await undoAdd({ clientId: 'client-2', payload });

		expect(expenseApi.createExpense).toHaveBeenCalledWith(payload, 'client-2');
		expect(scheduleDelete).toHaveBeenCalledWith(saved);
	});
});
