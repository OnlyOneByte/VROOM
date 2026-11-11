import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	syncOfflineExpenses,
	saveOfflineExpenses,
	loadOfflineExpenses,
	type OfflineExpense
} from '../offline-storage';
import { syncState } from '../../stores/offline.svelte';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function apiOk(data: unknown = { id: 'server-1' }) {
	return new Response(JSON.stringify({ success: true, data }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

function pending(id: string, over: Partial<OfflineExpense> = {}): OfflineExpense {
	return {
		id,
		clientId: `cid-${id}`,
		vehicleId: 'v1',
		tags: [],
		category: 'misc',
		amount: 10,
		date: '2024-06-01',
		timestamp: Date.now(),
		synced: false,
		version: '3.0',
		...over
	};
}

describe('syncOfflineExpenses', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ls.clear();
		syncState.current = 'idle';
	});

	it('POSTs each pending expense with its clientId, then clears the queue', async () => {
		saveOfflineExpenses([pending('a'), pending('b')]);
		mockFetch.mockImplementation(() => Promise.resolve(apiOk()));

		await syncOfflineExpenses();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		for (const call of mockFetch.mock.calls) {
			const body = JSON.parse((call[1] as { body?: string }).body as string);
			expect(body.clientId).toMatch(/^cid-/);
		}
		expect(loadOfflineExpenses()).toHaveLength(0);
		expect(syncState.current).toBe('success');
	});

	it('on a mid-batch TRANSIENT failure: keeps the failed pending and still attempts the rest', async () => {
		saveOfflineExpenses([pending('a'), pending('b'), pending('c')]);
		mockFetch
			.mockResolvedValueOnce(apiOk())
			.mockRejectedValueOnce(new Error('network down'))
			.mockResolvedValueOnce(apiOk());

		await syncOfflineExpenses();

		expect(mockFetch).toHaveBeenCalledTimes(3);
		expect(syncState.current).toBe('error');

		const remaining = loadOfflineExpenses();
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.id).toBe('b');
		expect(remaining[0]?.synced).toBe(false);
		expect(remaining[0]?.needsAttention).toBeFalsy();
	});

	it('on a TERMINAL rejection: parks the row instead of re-POSTing it forever', async () => {
		saveOfflineExpenses([pending('a')]);
		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({ success: false, error: { message: 'vehicleId is required' } }),
				{
					status: 400,
					headers: { 'content-type': 'application/json' }
				}
			)
		);

		await syncOfflineExpenses();
		await syncOfflineExpenses();

		expect(mockFetch).toHaveBeenCalledTimes(1);

		const parked = loadOfflineExpenses().find(e => e.id === 'a');
		expect(parked?.needsAttention).toBe(true);
		expect(parked?.synced).toBe(false);
		expect(parked).toBeDefined();
	});

	it('skips a malformed fuel expense (missing volume/charge or mileage)', async () => {
		saveOfflineExpenses([pending('fuel-bad', { category: 'fuel' }), pending('ok')]);
		mockFetch.mockImplementation(() => Promise.resolve(apiOk()));

		await syncOfflineExpenses();

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const call = mockFetch.mock.calls[0];
		expect(call).toBeDefined();
		const body = JSON.parse((call![1] as { body?: string }).body as string);
		expect(body.clientId).toBe('cid-ok');
	});

	it('CHARACTERIZATION: a skipped malformed fuel entry stays stuck in the queue, unsynced', async () => {
		saveOfflineExpenses([pending('fuel-bad', { category: 'fuel' }), pending('ok')]);
		mockFetch.mockImplementation(() => Promise.resolve(apiOk()));

		await syncOfflineExpenses();

		const remaining = loadOfflineExpenses();
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.id).toBe('fuel-bad');
		expect(remaining[0]?.synced).toBe(false);

		mockFetch.mockClear();
		await syncOfflineExpenses();
		expect(mockFetch).not.toHaveBeenCalled();
		expect(loadOfflineExpenses()).toHaveLength(1);
	});
});
