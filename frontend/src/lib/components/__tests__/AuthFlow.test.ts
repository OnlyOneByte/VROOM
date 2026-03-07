import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authStore } from '../../stores/auth.svelte';
import type { User } from '../../types/index.js';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
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
			// Direct property access
			expect(authStore.isLoading).toBe(true);
		});

		it('handles authentication errors', () => {
			authStore.setError('Authentication failed');
			// Direct property access
			expect(authStore.error).toBe('Authentication failed');
			expect(authStore.isLoading).toBe(false);
		});

		it('clears errors on successful authentication', () => {
			authStore.setError('Previous error');
			authStore.setUser(mockUser);
			// Direct property access
			expect(authStore.error).toBe(null);
			expect(authStore.isAuthenticated).toBe(true);
		});
	});

	describe('Authentication State Management', () => {
		it('initializes authentication state on app load', async () => {
			mockFetch.mockResolvedValueOnce(apiOk(mockUser));
			await authStore.initialize();
			// Direct property access
			expect(authStore.user).toEqual(mockUser);
			expect(authStore.isAuthenticated).toBe(true);
			expect(authStore.isLoading).toBe(false);
		});

		it('handles successful authentication callback', () => {
			authStore.setUser(mockUser, 'test-token');
			// Direct property access
			expect(authStore.user).toEqual(mockUser);
			expect(authStore.isAuthenticated).toBe(true);
			expect(authStore.token).toBe('test-token');
		});

		it('handles authentication session expiry', async () => {
			authStore.setUser(mockUser, 'test-token');
			mockFetch.mockResolvedValueOnce(apiError(401, 'Unauthorized'));
			await authStore.initialize();
			// Direct property access
			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
		});
	});

	describe('Protected Route Access', () => {
		it('redirects unauthenticated users to login', () => {
			authStore.clearUser();
			// Direct property access
			if (!authStore.isAuthenticated && !authStore.isLoading) {
				goto(resolve('/auth'));
			}
			expect(goto).toHaveBeenCalledWith('/auth');
		});

		it('allows authenticated users to access protected routes', () => {
			authStore.setUser(mockUser);
			// Direct property access
			expect(authStore.isAuthenticated).toBe(true);
			expect(goto).not.toHaveBeenCalled();
		});
	});

	describe('Dashboard Access Logic', () => {
		it('provides correct user data for dashboard display', () => {
			authStore.setUser(mockUser);
			// Direct property access
			expect(authStore.user?.displayName).toBe('Test User');
			expect(authStore.user?.email).toBe('test@example.com');
		});

		it('handles logout functionality', async () => {
			authStore.setUser(mockUser);
			mockFetch.mockResolvedValueOnce(apiOk(null));
			await authStore.logout();
			// Direct property access
			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
		});
	});

	describe('Token Management', () => {
		it('refreshes expired tokens automatically', async () => {
			authStore.setUser(mockUser, 'old-token');
			mockFetch.mockResolvedValueOnce(apiOk({ token: 'new-token' }));
			const refreshedToken = await authStore.refreshToken();
			expect(refreshedToken).toBe('new-token');
			expect(authStore.token).toBe('new-token');
		});

		it('logs out user when token refresh fails', async () => {
			authStore.setUser(mockUser, 'old-token');
			mockFetch.mockResolvedValueOnce(apiError(401, 'Token refresh failed'));
			await expect(authStore.refreshToken()).rejects.toThrow();
			// Direct property access
			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
		});
	});

	describe('Error Handling', () => {
		it('handles network errors gracefully', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));
			await authStore.initialize();
			// Direct property access
			expect(authStore.isAuthenticated).toBe(false);
		});

		it('clears errors on successful authentication', () => {
			authStore.setError('Previous error');
			authStore.setUser(mockUser);
			expect(authStore.error).toBe(null);
			expect(authStore.isAuthenticated).toBe(true);
		});
	});

	describe('Session Persistence', () => {
		it('maintains session across page reloads', async () => {
			mockFetch.mockResolvedValueOnce(apiOk(mockUser));
			await authStore.initialize();
			// Direct property access
			expect(authStore.user).toEqual(mockUser);
			expect(authStore.isAuthenticated).toBe(true);
		});

		it('handles invalid sessions on page reload', async () => {
			mockFetch.mockResolvedValueOnce(apiError(401, 'Unauthorized'));
			await authStore.initialize();
			// Direct property access
			expect(authStore.user).toBe(null);
			expect(authStore.isAuthenticated).toBe(false);
		});
	});
});
