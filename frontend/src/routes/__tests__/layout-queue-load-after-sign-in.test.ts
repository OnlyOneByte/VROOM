import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import type { User } from '#lib/types/index.ts';

const LAYOUT_SRC = readFileSync(`${process.cwd()}/src/routes/+layout.svelte`, 'utf8');

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

const { authStore } = await import('#lib/stores/auth.svelte.ts');
const { offlineExpenseQueue } = await import('#lib/stores/offline.svelte.ts');

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

const alice: User = {
	id: 'alice',
	email: 'alice@example.com',
	displayName: 'Alice',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

describe('the offline queue is loaded only once the signed-in user is known', () => {
	beforeEach(() => {
		ls.clear();
		authStore.clearUser();
		offlineExpenseQueue.current = [];
	});

	test('the root layout does not read the queue itself', () => {
		expect(LAYOUT_SRC).not.toContain('loadOfflineExpenses');
		expect(LAYOUT_SRC).not.toMatch(/offlineExpenseQueue\.current\s*=/);
	});

	test('nothing is shown before sign-in, and the signed-in user sees their entries after it', () => {
		localStorage.setItem('vroom_offline_expenses:alice', JSON.stringify([queued('alice-1')]));
		localStorage.setItem('vroom_offline_expenses', JSON.stringify([queued('shared-1')]));

		expect(offlineExpenseQueue.current).toEqual([]);

		authStore.setUser(alice);

		expect(offlineExpenseQueue.current.map(e => e.id).sort()).toEqual(['alice-1', 'shared-1']);
	});
});
