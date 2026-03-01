import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { authStore } from '../auth.js';
import type { User } from '../../types/index.js';

// Mock fetch — apiClient uses fetch internally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock window.location
const mockLocation = {
	href: ''
};
Object.defineProperty(window, 'location', {
	value: mockLocation,
	writable: true
});

// Mock user data
const mockUser: User = {
	id: '1',
	email: 'test@example.com',
	displayName: 'Test User',
	provider: 'google',
	providerId: 'google-123',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

/**
 * Helper to create a mock Response that apiClient expects.
 * apiClient checks response.ok, then reads JSON and unwraps { data } envelope.
 */
function mockApiResponse(data: unknown, ok = true, status = 200) {
	return {
		ok,
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: () => Promise.resolve({ success: ok, data })
	};
}

function mockApiError(status: number, message = 'Error') {
	return {
		ok: false,
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: () => Promise.resolve({ error: { message } })
	};
}

describe('Auth Store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLocation.href = '';
		authStore.clearUser();
		authStore.setLoading(true);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Initial State', () => {
		it('has correct initial state', () => {
			const state = get(authStore);
			expect(state).toEqual({
				user: null,
				isAuthenticated: false,
				isLoading: true,
				error: null,
				token: null
			});
		});
	});

	describe('setUser', () => {
		it('sets user and updates authentication state', () => {
			authStore.setUser(mockUser, 'test-token');
			const state = get(authStore);
			expect(state.user).toEqual(mockUser);
			expect(state.isAuthenticated).toBe(true);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBe(null);
			expect(state.token).toBe('test-token');
		});

		it('sets user without token', () => {
			authStore.setUser(mockUser);
			const state = get(authStore);
			expect(state.user).toEqual(mockUser);
			expect(state.isAuthenticated).toBe(true);
			expect(state.token).toBe(null);
		});
	});

	describe('clearUser', () => {
		it('clears user and resets authentication state', () => {
			authStore.setUser(mockUser, 'test-token');
			authStore.clearUser();
			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBe(null);
			expect(state.token).toBe(null);
		});
	});

	describe('setLoading', () => {
		it('updates loading state', () => {
			authStore.setLoading(false);
			expect(get(authStore).isLoading).toBe(false);
			authStore.setLoading(true);
			expect(get(authStore).isLoading).toBe(true);
		});
	});

	describe('setError', () => {
		it('sets error and stops loading', () => {
			authStore.setError('Test error');
			const state = get(authStore);
			expect(state.error).toBe('Test error');
			expect(state.isLoading).toBe(false);
		});

		it('clears error when set to null', () => {
			authStore.setError('Test error');
			authStore.setError(null);
			expect(get(authStore).error).toBe(null);
		});
	});

	describe('initialize', () => {
		it('successfully initializes with valid session', async () => {
			mockFetch.mockResolvedValueOnce(mockApiResponse(mockUser));

			await authStore.initialize();

			const state = get(authStore);
			expect(state.user).toEqual(mockUser);
			expect(state.isAuthenticated).toBe(true);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBe(null);
		});

		it('handles invalid session gracefully', async () => {
			mockFetch.mockResolvedValueOnce(mockApiError(401, 'Unauthorized'));

			await authStore.initialize();

			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.isLoading).toBe(false);
		});

		it('handles network errors', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			await authStore.initialize();

			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.isLoading).toBe(false);
		});
	});

	describe('loginWithGoogle', () => {
		it('redirects to Google OAuth endpoint', () => {
			authStore.loginWithGoogle();
			expect(mockLocation.href).toBe('/api/v1/auth/login/google');
		});
	});

	describe('refreshToken', () => {
		it('successfully refreshes token', async () => {
			const newToken = 'new-test-token';
			mockFetch.mockResolvedValueOnce(mockApiResponse({ token: newToken }));

			const result = await authStore.refreshToken();

			expect(result).toBe(newToken);
			const state = get(authStore);
			expect(state.token).toBe(newToken);
			expect(state.error).toBe(null);
		});

		it('handles refresh failure', async () => {
			mockFetch.mockResolvedValueOnce(mockApiError(401, 'Token refresh failed'));

			await expect(authStore.refreshToken()).rejects.toThrow();

			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.token).toBe(null);
		});
	});

	describe('logout', () => {
		it('successfully logs out user', async () => {
			authStore.setUser(mockUser, 'test-token');
			mockFetch.mockResolvedValueOnce(mockApiResponse(null));

			await authStore.logout();

			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBe(null);
			expect(state.token).toBe(null);
		});
	});

	describe('Store Reactivity', () => {
		it('notifies subscribers of state changes', () => {
			const states: unknown[] = [];
			const unsubscribe = authStore.subscribe(state => {
				states.push({ ...state });
			});

			expect(states).toHaveLength(1);

			authStore.setUser(mockUser);
			expect(states).toHaveLength(2);

			authStore.setError('Test error');
			expect(states).toHaveLength(3);

			authStore.clearUser();
			expect(states).toHaveLength(4);

			unsubscribe();
		});
	});
});
