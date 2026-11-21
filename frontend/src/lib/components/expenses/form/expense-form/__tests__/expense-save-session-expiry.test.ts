import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { User } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/utils/navigation.ts', () => ({ gotoDynamic: vi.fn(() => Promise.resolve()) }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

const { authStore } = await import('#lib/stores/auth.svelte.ts');
const { offlineExpenseQueue, onlineStatus } = await import('#lib/stores/offline.svelte.ts');
const { loadOfflineExpenses } = await import('#lib/utils/offline-storage.ts');
const { ExpenseFormState } = await import('../expense-form-state.svelte');
const { submitExpense } = await import('../expense-form-actions');

function user(id: string): User {
	return {
		id,
		email: `${id}@example.com`,
		displayName: id,
		createdAt: '2024-01-01T00:00:00Z',
		updatedAt: '2024-01-01T00:00:00Z'
	};
}

function unauthorized(): Response {
	return new Response(JSON.stringify({ error: { message: 'Session expired' } }), {
		status: 401,
		headers: { 'content-type': 'application/json' }
	});
}

function aliceForm() {
	const state = new ExpenseFormState({ expenseId: undefined, returnTo: '/expenses' }, false);
	state.formData.vehicleId = 'v1';
	state.formData.category = 'misc';
	state.formData.amount = '12.00';
	state.formData.date = '2025-03-10';
	state.formData.description = 'alice private note';
	return state;
}

describe('a save that finds the session expired', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ls.clear();
		authStore.clearUser();
		onlineStatus.current = true;
	});

	test('is kept for the user who made it, never handed to the next user who signs in', async () => {
		authStore.setUser(user('alice'));
		mockFetch.mockResolvedValue(unauthorized());

		await submitExpense(aliceForm());

		expect(authStore.isAuthenticated).toBe(false);
		expect(loadOfflineExpenses('alice').map(e => e.description)).toEqual(['alice private note']);

		authStore.setUser(user('bob'));
		expect(offlineExpenseQueue.current).toEqual([]);

		authStore.setUser(user('alice'));
		expect(offlineExpenseQueue.current.map(e => e.description)).toEqual(['alice private note']);
	});
});
