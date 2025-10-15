import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { authStore } from '../auth.js';
import type { User } from '../../types/index.js';

// Mock fetch
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

describe('Auth Store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLocation.href = '';

		// Reset store to initial state
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
			// First set a user
			authStore.setUser(mockUser, 'test-token');

			// Then clear
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

			const state = get(authStore);
			expect(state.isLoading).toBe(false);

			authStore.setLoading(true);

			const updatedState = get(authStore);
			expect(updatedState.isLoading).toBe(true);
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

			const state = get(authStore);
			expect(state.error).toBe(null);
		});
	});

	describe('initialize', () => {
		it('successfully initializes with valid session', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockUser)
			});

			await authStore.initialize();

			const state = get(authStore);
			expect(state.user).toEqual(mockUser);
			expect(state.isAuthenticated).toBe(true);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBe(null);

			expect(mockFetch).toHaveBeenCalledWith('/api/auth/me', {
				credentials: 'include'
			});
		});

		it('handles invalid session gracefully', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401
			});

			await authStore.initialize();

			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBe(null);
		});

		it('handles network errors', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			await authStore.initialize();

			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBe('Network error');
		});
	});

	describe('loginWithGoogle', () => {
		it('redirects to Google OAuth endpoint', () => {
			authStore.loginWithGoogle();

			expect(mockLocation.href).toBe('/api/auth/login/google');
		});
	});

	describe('refreshToken', () => {
		it('successfully refreshes token', async () => {
			const newToken = 'new-test-token';
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ token: newToken })
			});

			const result = await authStore.refreshToken();

			expect(result).toBe(newToken);

			const state = get(authStore);
			expect(state.token).toBe(newToken);
			expect(state.error).toBe(null);

			expect(mockFetch).toHaveBeenCalledWith('/api/auth/refresh', {
				method: 'POST',
				credentials: 'include'
			});
		});

		it('handles refresh failure', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401
			});

			await expect(authStore.refreshToken()).rejects.toThrow('Token refresh failed');

			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.token).toBe(null);
			expect(state.error).toBe('Token refresh failed');
		});

		it('handles network errors during refresh', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			await expect(authStore.refreshToken()).rejects.toThrow('Network error');

			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.token).toBe(null);
			expect(state.error).toBe('Network error');
		});
	});

	describe('logout', () => {
		it('successfully logs out user', async () => {
			// First set a user
			authStore.setUser(mockUser, 'test-token');

			mockFetch.mockResolvedValueOnce({
				ok: true
			});

			await authStore.logout();

			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBe(null);
			expect(state.token).toBe(null);

			expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', {
				method: 'POST',
				credentials: 'include'
			});
		});

		it('handles logout errors', async () => {
			authStore.setUser(mockUser, 'test-token');

			mockFetch.mockRejectedValueOnce(new Error('Logout failed'));

			await authStore.logout();

			const state = get(authStore);
			expect(state.error).toBe('Logout failed');
			// User should still be cleared even if logout request fails
		});
	});

	describe('Store Reactivity', () => {
		it('notifies subscribers of state changes', () => {
			const states: any[] = [];

			const unsubscribe = authStore.subscribe(state => {
				states.push({ ...state });
			});

			// Initial state
			expect(states).toHaveLength(1);

			// Set user
			authStore.setUser(mockUser);
			expect(states).toHaveLength(2);
			expect(states[1].isAuthenticated).toBe(true);

			// Set error
			authStore.setError('Test error');
			expect(states).toHaveLength(3);
			expect(states[2].error).toBe('Test error');

			// Clear user
			authStore.clearUser();
			expect(states).toHaveLength(4);
			expect(states[3].isAuthenticated).toBe(false);

			unsubscribe();
		});
	});
});
