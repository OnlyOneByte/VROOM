import { beforeEach, describe, expect, it, vi } from 'vitest';

const appStore = vi.hoisted(() => ({ addNotification: vi.fn(), dismissToast: vi.fn() }));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

import { onlineStatus, syncState } from '../../../stores/offline.svelte';
import {
	loadOfflineExpenses,
	type OfflineExpense,
	saveOfflineExpenses
} from '../../offline-storage';
import { syncConfig } from '../sync-state.svelte';
import { syncManager } from '../sync-manager';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function apiError(status: number, message: string): Response {
	return new Response(JSON.stringify({ success: false, message }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

function queued(id: string, over: Partial<OfflineExpense> = {}): OfflineExpense {
	return {
		id,
		clientId: `cid-${id}`,
		vehicleId: 'v1',
		tags: [],
		category: 'misc',
		amount: 10,
		date: '2024-06-01T12:00:00.000Z',
		timestamp: Date.now(),
		synced: false,
		version: '3.0',
		...over
	};
}

describe('a queued save that fails is announced once, and Retry clears it', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ls.clear();
		syncState.current = 'idle';
		onlineStatus.current = true;
		syncConfig.update(config => ({ ...config, maxRetries: 0 }));
	});

	it('a server refusal parks the entry, keeps what was typed, and raises one toast that offers Edit', async () => {
		saveOfflineExpenses([queued('a', { description: 'Oil change', mileage: 41000 })]);
		mockFetch.mockResolvedValue(apiError(400, 'Mileage must be greater than 41,010'));

		await syncManager.syncAll();
		await syncManager.syncAll({ skipConflicted: false }).catch(() => undefined);

		const [entry] = loadOfflineExpenses();
		expect(entry).toMatchObject({
			needsAttention: true,
			attentionReason: expect.stringContaining('Mileage must be greater than 41,010'),
			description: 'Oil change',
			mileage: 41000
		});
		expect(appStore.addNotification).toHaveBeenCalledTimes(1);
		const [notice] = appStore.addNotification.mock.calls[0] as [Record<string, unknown>];
		expect(notice['type']).toBe('error');
		expect(notice['message']).toMatch(/wasn't saved$/);
		expect(notice['description']).toContain('Mileage must be greater than 41,010');
		expect(notice['duration']).toBe(Number.POSITIVE_INFINITY);
		expect((notice['action'] as { label: string }).label).toBe('Edit');
	});

	it('a server error records a plain message on the row and offers Retry, announced once across attempts', async () => {
		saveOfflineExpenses([queued('a')]);
		mockFetch.mockResolvedValue(apiError(500, 'Database unavailable'));

		await syncManager.syncAll();
		await syncManager.syncAll();

		expect(loadOfflineExpenses()[0]?.lastError).toBe(
			'Something went wrong on our side. Try again in a moment.'
		);
		expect(appStore.addNotification).toHaveBeenCalledTimes(1);
		const [notice] = appStore.addNotification.mock.calls[0] as [Record<string, unknown>];
		expect((notice['action'] as { label: string }).label).toBe('Retry');
	});

	it('Retry clears the error and the toast, and a fresh failure is announced again', async () => {
		saveOfflineExpenses([queued('a')]);
		mockFetch.mockResolvedValue(apiError(500, 'Database unavailable'));
		await syncManager.syncAll();

		syncManager.retryEntry('a');
		expect(appStore.dismissToast).toHaveBeenCalledWith('save-failed-a');
		await vi.waitFor(() => expect(appStore.addNotification).toHaveBeenCalledTimes(2));
	});
});
