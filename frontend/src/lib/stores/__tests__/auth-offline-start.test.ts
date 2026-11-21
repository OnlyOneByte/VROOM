import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../auth.svelte';
import { offlineExpenseQueue } from '../offline.svelte';
import { saveOfflineExpenses, type OfflineExpense } from '#lib/utils/offline-storage.ts';
import type { User } from '#lib/types/index.ts';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

const alice: User = {
	id: 'alice',
	email: 'alice@example.com',
	displayName: 'Alice',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

function meOk(user: User): Response {
	return new Response(
		JSON.stringify({
			success: true,
			data: { user, session: { expiresAt: '2099-01-01' } }
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

function meError(status: number): Response {
	return new Response(JSON.stringify({ error: { message: 'nope' } }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function queued(id: string): OfflineExpense {
	return {
		id,
		clientId: `cid-${id}`,
		vehicleId: 'v1',
		tags: [],
		category: 'misc',
		amount: 5,
		date: '2024-06-01',
		timestamp: 0,
		synced: false,
		version: '3.0'
	};
}

async function signInOnline(user: User): Promise<void> {
	mockFetch.mockResolvedValueOnce(meOk(user));
	await authStore.initialize();
}

describe('authStore.initialize when /auth/me fails', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.clearUser();
		ls.clear();
	});

	it('keeps the last signed-in user when the server is unreachable', async () => {
		await signInOnline(alice);
		authStore.clearUser();
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		await authStore.initialize();

		expect(authStore.isAuthenticated).toBe(true);
		expect(authStore.user?.id).toBe('alice');
		expect(authStore.sessionUnverified).toBe(true);
		expect(authStore.isLoading).toBe(false);
	});

	it('keeps the last signed-in user on a 5xx', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockResolvedValueOnce(meError(503));

		await authStore.initialize();

		expect(authStore.isAuthenticated).toBe(true);
		expect(authStore.sessionUnverified).toBe(true);
	});

	it('signs out on a 401 and forgets the remembered user', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockResolvedValueOnce(meError(401));

		await authStore.initialize();

		expect(authStore.isAuthenticated).toBe(false);
		expect(authStore.sessionUnverified).toBe(false);
		expect(localStorage.getItem('vroom_last_user')).toBeNull();
	});

	it('signs out on a network error when nobody signed in on this device before', async () => {
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		await authStore.initialize();

		expect(authStore.isAuthenticated).toBe(false);
	});

	it('clears the unverified flag once the server confirms the session', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await authStore.initialize();

		await signInOnline(alice);

		expect(authStore.sessionUnverified).toBe(false);
		expect(authStore.isAuthenticated).toBe(true);
	});
});

describe('the offline queue follows the signed-in user', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.clearUser();
		ls.clear();
	});

	it("shows only the signed-in user's queued entries, and keeps them across a sign-out", async () => {
		await signInOnline(alice);
		saveOfflineExpenses([queued('alice-1')]);

		authStore.clearUser();
		expect(offlineExpenseQueue.current).toEqual([]);

		await signInOnline({ ...alice, id: 'bob' });
		expect(offlineExpenseQueue.current).toEqual([]);

		await signInOnline(alice);
		expect(offlineExpenseQueue.current.map(e => e.id)).toEqual(['alice-1']);
	});

	it('hands entries queued before the queue was scoped to the first user who signs in', async () => {
		localStorage.setItem('vroom_offline_expenses', JSON.stringify([queued('legacy-1')]));

		await signInOnline(alice);

		expect(offlineExpenseQueue.current.map(e => e.id)).toEqual(['legacy-1']);
		expect(localStorage.getItem('vroom_offline_expenses')).toBeNull();
	});

	it("restores the user's queue on an offline start", async () => {
		await signInOnline(alice);
		saveOfflineExpenses([queued('alice-1')]);
		authStore.clearUser();
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		await authStore.initialize();

		expect(authStore.isAuthenticated).toBe(true);
		expect(offlineExpenseQueue.current.map(e => e.id)).toEqual(['alice-1']);
	});

	it("stashes a corrupt queue under the user's own key", async () => {
		localStorage.setItem('vroom_offline_expenses:alice', '{not json');

		await signInOnline(alice);

		expect(offlineExpenseQueue.current).toEqual([]);
		expect(localStorage.getItem('vroom_offline_expenses:alice.corrupt')).toBe('{not json');
	});

	it('keeps the unscoped queue when copying it to the user fails', async () => {
		localStorage.setItem('vroom_offline_expenses', JSON.stringify([queued('legacy-1')]));
		const setItem = vi.mocked(window.localStorage.setItem);
		const writeThrough = setItem.getMockImplementation()!;
		setItem.mockImplementation((key, value) => {
			if (key === 'vroom_offline_expenses:alice') {
				throw new DOMException('exceeded the quota', 'QuotaExceededError');
			}
			writeThrough(key, value);
		});

		try {
			await signInOnline(alice);
		} finally {
			setItem.mockImplementation(writeThrough);
		}

		expect(localStorage.getItem('vroom_offline_expenses')).not.toBeNull();
	});
});
