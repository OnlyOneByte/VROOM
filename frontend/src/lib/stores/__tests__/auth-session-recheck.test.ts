import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../auth.svelte';
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
			data: { user, session: { id: 's', expiresAt: '2099-01-01' } }
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

describe('authStore.recheckSession', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.clearUser();
		ls.clear();
	});

	it('re-verifies the session and clears the in-flight flag when done', async () => {
		mockFetch.mockResolvedValueOnce(meOk(alice));

		const recheck = authStore.recheckSession();
		expect(authStore.recheckingSession).toBe(true);
		await recheck;

		expect(authStore.recheckingSession).toBe(false);
		expect(authStore.user?.id).toBe('alice');
		expect(authStore.sessionUnverified).toBe(false);
	});

	it('ignores a second recheck while one is already in flight', async () => {
		let respond!: (response: Response) => void;
		mockFetch.mockReturnValueOnce(new Promise<Response>(resolve => (respond = resolve)));

		const first = authStore.recheckSession();
		await authStore.recheckSession();
		respond(meOk(alice));
		await first;

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(authStore.recheckingSession).toBe(false);
	});

	it('clears the in-flight flag when the recheck throws', async () => {
		const initialize = vi
			.spyOn(authStore, 'initialize')
			.mockRejectedValueOnce(new Error('unexpected'));

		await expect(authStore.recheckSession()).rejects.toThrow('unexpected');

		expect(authStore.recheckingSession).toBe(false);
		initialize.mockRestore();
	});
});

describe('authStore remembered user', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.clearUser();
		ls.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('signs out when the remembered user is unreadable and the server is unreachable', async () => {
		localStorage.setItem('vroom_last_user', '{not json');
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		await authStore.initialize();

		expect(authStore.isAuthenticated).toBe(false);
		expect(authStore.user).toBeNull();
	});

	it('still signs in when storage refuses to remember the user', async () => {
		vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
			throw new Error('QuotaExceededError');
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		authStore.setUser(alice, 'token-1');

		expect(authStore.isAuthenticated).toBe(true);
		expect(authStore.user?.id).toBe('alice');
		expect(authStore.token).toBe('token-1');
		expect(warn).toHaveBeenCalledWith('Failed to remember the signed-in user:', expect.any(Error));
	});
});
