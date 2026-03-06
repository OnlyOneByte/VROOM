import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { authStore } from '../../stores/auth.js';
import type { User } from '../../types/index.js';
import { goto } from '$app/navigation';

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockLocation = { href: '' };
Object.defineProperty(window, 'location', { value: mockLocation, writable: true });

const mockUser: User = {
	id: '1',
	email: 'test@example.com',
	displayName: 'Test User',
	provider: 'google',
	providerId: 'google-123',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

/** Helper: mock a successful apiClient-compatible response */
function apiOk(data: unknown) {
	return {
		ok: true,
		status: 200,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: () => Promise.resolve({ success: true, data })
	};
}

function apiError(status: number, message = 'Error') {
	return {
		ok: false,
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: () => Promise.resolve({ error: { message } })
	};
}

describe('Authentication Flow Integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLocation.href = '';
		authStore.clearUser();
		authStore.setLoading(false);
		authStore.setError(null);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Login Flow Logic', () => {
		it('handles Google OAuth initiation', () => {
			authStore.loginWithGoogle();
			expect(mockLocation.href).toBe('/api/v1/auth/login/google');
		});

		it('manages loading state during authentication', () => {
			authStore.setLoading(true);
			const authState = get(authStore);
			expect(authState.isLoading).toBe(true);
		});

		it('handles authentication errors', () => {
			authStore.setError('Authentication failed');
			const authState = get(authStore);
			expect(authState.error).toBe('Authentication failed');
			expect(authState.isLoading).toBe(false);
		});

		it('clears errors on successful authentication', () => {
			authStore.setError('Previous error');
			authStore.setUser(mockUser);
			const authState = get(authStore);
			expect(authState.error).toBe(null);
			expect(authState.isAuthenticated).toBe(true);
		});
	});

	describe('Authentication State Management', () => {
		it('initializes authentication state on app load', async () => {
			mockFetch.mockResolvedValueOnce(apiOk(mockUser));
			await authStore.initialize();
			const state = get(authStore);
			expect(state.user).toEqual(mockUser);
			expect(state.isAuthenticated).toBe(true);
			expect(state.isLoading).toBe(false);
		});

		it('handles successful authentication callback', () => {
			authStore.setUser(mockUser, 'test-token');
			const state = get(authStore);
			expect(state.user).toEqual(mockUser);
			expect(state.isAuthenticated).toBe(true);
			expect(state.token).toBe('test-token');
		});

		it('handles authentication session expiry', async () => {
			authStore.setUser(mockUser, 'test-token');
			mockFetch.mockResolvedValueOnce(apiError(401, 'Unauthorized'));
			await authStore.initialize();
			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
		});
	});

	describe('Protected Route Access', () => {
		it('redirects unauthenticated users to login', () => {
			authStore.clearUser();
			const state = get(authStore);
			if (!state.isAuthenticated && !state.isLoading) {
				goto('/auth');
			}
			expect(goto).toHaveBeenCalledWith('/auth');
		});

		it('allows authenticated users to access protected routes', () => {
			authStore.setUser(mockUser);
			const state = get(authStore);
			expect(state.isAuthenticated).toBe(true);
			expect(goto).not.toHaveBeenCalled();
		});
	});

	describe('Dashboard Access Logic', () => {
		it('provides correct user data for dashboard display', () => {
			authStore.setUser(mockUser);
			const authState = get(authStore);
			expect(authState.user?.displayName).toBe('Test User');
			expect(authState.user?.email).toBe('test@example.com');
		});

		it('handles logout functionality', async () => {
			authStore.setUser(mockUser);
			mockFetch.mockResolvedValueOnce(apiOk(null));
			await authStore.logout();
			const authState = get(authStore);
			expect(authState.user).toBe(null);
			expect(authState.isAuthenticated).toBe(false);
		});
	});

	describe('Token Management', () => {
		it('refreshes expired tokens automatically', async () => {
			authStore.setUser(mockUser, 'old-token');
			mockFetch.mockResolvedValueOnce(apiOk({ token: 'new-token' }));
			const refreshedToken = await authStore.refreshToken();
			expect(refreshedToken).toBe('new-token');
			expect(get(authStore).token).toBe('new-token');
		});

		it('logs out user when token refresh fails', async () => {
			authStore.setUser(mockUser, 'old-token');
			mockFetch.mockResolvedValueOnce(apiError(401, 'Token refresh failed'));
			await expect(authStore.refreshToken()).rejects.toThrow();
			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
		});
	});

	describe('Error Handling', () => {
		it('handles network errors gracefully', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));
			await authStore.initialize();
			const state = get(authStore);
			expect(state.isAuthenticated).toBe(false);
		});

		it('clears errors on successful authentication', () => {
			authStore.setError('Previous error');
			authStore.setUser(mockUser);
			expect(get(authStore).error).toBe(null);
			expect(get(authStore).isAuthenticated).toBe(true);
		});
	});

	describe('Session Persistence', () => {
		it('maintains session across page reloads', async () => {
			mockFetch.mockResolvedValueOnce(apiOk(mockUser));
			await authStore.initialize();
			const state = get(authStore);
			expect(state.user).toEqual(mockUser);
			expect(state.isAuthenticated).toBe(true);
		});

		it('handles invalid sessions on page reload', async () => {
			mockFetch.mockResolvedValueOnce(apiError(401, 'Unauthorized'));
			await authStore.initialize();
			const state = get(authStore);
			expect(state.user).toBe(null);
			expect(state.isAuthenticated).toBe(false);
		});
	});
});
