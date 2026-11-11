import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineStatus, syncState } from '../../../stores/offline.svelte';
import { type OfflineExpense, saveOfflineExpenses } from '../../offline-storage';
import { syncConfig, syncManager } from '../sync-manager';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

function apiOk(data: unknown): Response {
	return new Response(JSON.stringify({ success: true, data }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function serverRow(date: string, amount: number) {
	return {
		id: 'server-1',
		vehicleId: 'v1',
		userId: 'u1',
		tags: ['fuel'],
		category: 'fuel',
		expenseAmount: amount,
		date,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z'
	};
}

const getQueries: URLSearchParams[] = [];
const posts: string[] = [];

function serveFiltered(rows: ReturnType<typeof serverRow>[]): void {
	mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
		const method = init?.method ?? 'GET';
		if (method !== 'GET') {
			posts.push(url);
			return Promise.resolve(apiOk({ id: 'created-1' }));
		}
		const params = new URL(url, 'http://localhost').searchParams;
		getQueries.push(params);
		const vehicleId = params.get('vehicleId');
		const start = params.get('startDate');
		const end = params.get('endDate');
		return Promise.resolve(
			apiOk(
				rows.filter(
					row =>
						(!vehicleId || row.vehicleId === vehicleId) &&
						(!start || row.date >= start) &&
						(!end || row.date <= end)
				)
			)
		);
	});
}

function localFillUp(): OfflineExpense {
	return {
		id: 'local-1',
		clientId: 'cid-local-1',
		vehicleId: 'v1',
		tags: ['fuel'],
		category: 'fuel',
		amount: 50,
		date: '2024-06-02',
		mileage: 30000,
		volume: 10,
		fuelType: 'Regular',
		timestamp: Date.now(),
		synced: false,
		version: '3.0'
	};
}

describe('offline sync duplicate check — day window', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getQueries.length = 0;
		posts.length = 0;
		ls.clear();
		syncState.current = 'idle';
		onlineStatus.current = true;
		syncConfig.current = {
			maxRetries: 3,
			retryDelay: 100,
			batchSize: 10,
			conflictResolution: 'ask_user'
		};
	});

	it('does not call a same-tag expense from another day a conflict — it syncs', async () => {
		saveOfflineExpenses([localFillUp()]);
		serveFiltered([serverRow('2024-05-01', 999)]);

		const result = await syncManager.syncAll();

		expect(result.conflicts).toHaveLength(0);
		expect(result.synced).toBe(1);
		expect(posts).toHaveLength(1);
	});

	it('asks for the filters the route implements, and none it ignores', async () => {
		saveOfflineExpenses([localFillUp()]);
		serveFiltered([]);

		await syncManager.syncAll();

		const query = getQueries[0];
		expect(query?.get('vehicleId')).toBe('v1');
		expect(query?.get('startDate')).toBe('2024-06-02');
		expect(query?.get('endDate')).toBe('2024-06-02');
		expect(query?.has('date')).toBe(false);
		expect(query?.has('amount')).toBe(false);
	});

	it('still catches a genuine same-day duplicate, so the check is narrowed and not disabled', async () => {
		saveOfflineExpenses([localFillUp()]);
		serveFiltered([serverRow('2024-06-02', 50)]);

		const result = await syncManager.syncAll();

		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]?.conflictType).toBe('duplicate');
		expect(posts).toHaveLength(0);
	});
});
