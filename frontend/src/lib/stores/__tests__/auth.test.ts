import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authStore } from '../auth.svelte';
import { recentlySynced, rememberSynced } from '#lib/utils/sync/recently-synced.svelte.ts';
import type { User } from '../../types/index.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockLocation = {
	href: ''
};
Object.defineProperty(window, 'location', {
	value: mockLocation,
	writable: true
});

const mockUser: User = {
	id: '1',
	email: 'test@example.com',
	displayName: 'Test User',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

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
			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
			expect(authStore.isLoading).toBe(true);
			expect(authStore.error).toBe(null);
			expect(authStore.token).toBe(null);
		});
	});

	describe('setUser', () => {
		it('sets user and updates authentication state', () => {
			authStore.setUser(mockUser, 'test-token');
			expect(authStore.user).toEqual(mockUser);
			expect(authStore.isAuthenticated).toBe(true);
			expect(authStore.isLoading).toBe(false);
			expect(authStore.error).toBe(null);
			expect(authStore.token).toBe('test-token');
		});

		it('sets user without token', () => {
			authStore.setUser(mockUser);
			expect(authStore.user).toEqual(mockUser);
			expect(authStore.isAuthenticated).toBe(true);
			expect(authStore.token).toBe(null);
		});
	});

	describe('clearUser', () => {
		it('clears user and resets authentication state', () => {
			authStore.setUser(mockUser, 'test-token');
			authStore.clearUser();
			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
			expect(authStore.isLoading).toBe(false);
			expect(authStore.error).toBe(null);
			expect(authStore.token).toBe(null);
		});
	});

	describe('setLoading', () => {
		it('updates loading state', () => {
			authStore.setLoading(false);
			expect(authStore.isLoading).toBe(false);
			authStore.setLoading(true);
			expect(authStore.isLoading).toBe(true);
		});
	});

	describe('setError', () => {
		it('sets error and stops loading', () => {
			authStore.setError('Test error');
			expect(authStore.error).toBe('Test error');
			expect(authStore.isLoading).toBe(false);
		});

		it('clears error when set to null', () => {
			authStore.setError('Test error');
			authStore.setError(null);
			expect(authStore.error).toBe(null);
		});
	});

	describe('initialize', () => {
		it('successfully initializes with valid session', async () => {
			mockFetch.mockResolvedValueOnce(
				mockApiResponse({
					user: mockUser,
					session: { expiresAt: '2026-04-07T00:00:00Z' }
				})
			);

			await authStore.initialize();

			expect(authStore.user).toEqual(mockUser);
			expect(authStore.isAuthenticated).toBe(true);
			expect(authStore.isLoading).toBe(false);
			expect(authStore.error).toBe(null);
		});

		it('handles invalid session gracefully', async () => {
			mockFetch.mockResolvedValueOnce(mockApiError(401, 'Unauthorized'));

			await authStore.initialize();

			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
			expect(authStore.isLoading).toBe(false);
		});

		it('handles network errors', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			await authStore.initialize();

			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
			expect(authStore.isLoading).toBe(false);
		});
	});

	describe('loginWith', () => {
		it('redirects to provider OAuth endpoint', () => {
			authStore.loginWith('google');
			expect(mockLocation.href).toBe('/api/v1/auth/login/google');
		});

		it('redirects to GitHub OAuth endpoint', () => {
			authStore.loginWith('github');
			expect(mockLocation.href).toBe('/api/v1/auth/login/github');
		});
	});

	describe('refreshToken', () => {
		it('successfully refreshes token', async () => {
			const newToken = 'new-test-token';
			mockFetch.mockResolvedValueOnce(mockApiResponse({ token: newToken }));

			const result = await authStore.refreshToken();

			expect(result).toBe(newToken);
			expect(authStore.token).toBe(newToken);
			expect(authStore.error).toBe(null);
		});

		it('handles refresh failure', async () => {
			mockFetch.mockResolvedValueOnce(mockApiError(401, 'Token refresh failed'));

			await expect(authStore.refreshToken()).rejects.toThrow();

			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
			expect(authStore.token).toBe(null);
		});
	});

	describe('logout', () => {
		it('successfully logs out user', async () => {
			authStore.setUser(mockUser, 'test-token');
			mockFetch.mockResolvedValueOnce(mockApiResponse(null));

			await authStore.logout();

			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
			expect(authStore.isLoading).toBe(false);
			expect(authStore.error).toBe(null);
			expect(authStore.token).toBe(null);
		});

		it('forgets rows that were just synced, so the next person on the device never sees them', async () => {
			authStore.setUser(mockUser, 'test-token');
			rememberSynced({
				id: 'e1',
				clientId: 'c1',
				vehicleId: 'v1',
				tags: [],
				category: 'misc',
				amount: 5,
				date: '2026-11-26T12:00:00.000Z',
				timestamp: 1,
				synced: true,
				version: '3.0'
			});
			mockFetch.mockResolvedValueOnce(mockApiResponse(null));

			await authStore.logout();

			expect(recentlySynced()).toEqual([]);
		});

		it("clears the user's cached vehicles and history but keeps their unsynced queue", async () => {
			authStore.setUser(mockUser, 'test-token');
			localStorage.setItem('vroom_offline_vehicles:1', '[]');
			localStorage.setItem('vroom_offline_vehicle_history:v1:1', '[]');
			localStorage.setItem('vroom_offline_vehicles:2', '[]');
			localStorage.setItem('vroom_offline_expenses:1', '[]');
			mockFetch.mockResolvedValueOnce(mockApiResponse(null));

			await authStore.logout();

			expect(localStorage.getItem('vroom_offline_vehicles:1')).toBeNull();
			expect(localStorage.getItem('vroom_offline_vehicle_history:v1:1')).toBeNull();
			expect(localStorage.getItem('vroom_offline_vehicles:2')).toBe('[]');
			expect(localStorage.getItem('vroom_offline_expenses:1')).toBe('[]');
		});

		it('keeps the caches when the logout request fails', async () => {
			authStore.setUser(mockUser, 'test-token');
			localStorage.setItem('vroom_offline_vehicles:1', '[]');
			mockFetch.mockResolvedValueOnce(mockApiError(500, 'Logout failed'));

			await expect(authStore.logout()).rejects.toThrow();

			expect(localStorage.getItem('vroom_offline_vehicles:1')).toBe('[]');
		});

		it('sets the error, stays signed in and rethrows when the logout request fails', async () => {
			authStore.setUser(mockUser, 'test-token');
			mockFetch.mockResolvedValueOnce(mockApiError(500, 'Logout failed'));

			await expect(authStore.logout()).rejects.toThrow();
			expect(authStore.error, 'a failed logout must surface its error').toBeTruthy();
			expect(authStore.isAuthenticated).toBe(true);
		});
	});

	describe('updateDisplayName', () => {
		it('merges the new displayName into the existing user, preserving other fields', async () => {
			authStore.setUser(mockUser, 'test-token');
			mockFetch.mockResolvedValueOnce(
				mockApiResponse({ user: { ...mockUser, displayName: 'Renamed' } })
			);

			const returned = await authStore.updateDisplayName('Renamed');

			expect(authStore.user?.displayName).toBe('Renamed');
			expect(authStore.user?.email).toBe(mockUser.email);
			expect(authStore.user?.id).toBe(mockUser.id);
			expect(returned.displayName).toBe('Renamed');
		});

		it('is a no-op on local state when there is no current user (the if (user) guard)', async () => {
			authStore.clearUser();
			mockFetch.mockResolvedValueOnce(
				mockApiResponse({ user: { ...mockUser, displayName: 'Ghost' } })
			);

			const returned = await authStore.updateDisplayName('Ghost');
			expect(returned.displayName).toBe('Ghost');
			expect(authStore.user).toBe(null);
		});
	});

	describe('Store Reactivity', () => {
		it('reflects state changes immediately', () => {
			authStore.setUser(mockUser);
			expect(authStore.user).toEqual(mockUser);
			expect(authStore.isAuthenticated).toBe(true);

			authStore.setError('Test error');
			expect(authStore.error).toBe('Test error');

			authStore.clearUser();
			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
		});
	});
});
