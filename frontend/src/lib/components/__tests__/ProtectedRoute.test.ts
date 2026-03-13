import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authStore } from '../../stores/auth.svelte';
import type { User } from '../../types/index.js';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

// Mock $app/navigation
vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

// Mock $app/paths
vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

// Mock user data
const mockUser: User = {
	id: '1',
	email: 'test@example.com',
	displayName: 'Test User',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

describe('ProtectedRoute Logic', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset auth store to initial state
		authStore.clearUser();
		authStore.setLoading(true);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('determines correct state when authentication is loading', () => {
		authStore.setLoading(true);

		// Direct property access
		expect(authStore.isLoading).toBe(true);
		expect(authStore.isAuthenticated).toBe(false);

		// Should show loading, not redirect
		const shouldRedirect = !authStore.isLoading && !authStore.isAuthenticated;
		expect(shouldRedirect).toBe(false);
	});

	it('allows access when user is authenticated', () => {
		authStore.setUser(mockUser);

		// Direct property access
		expect(authStore.isAuthenticated).toBe(true);
		expect(authStore.isLoading).toBe(false);

		// Should allow access, not redirect
		const shouldRedirect = !authStore.isLoading && !authStore.isAuthenticated;
		expect(shouldRedirect).toBe(false);
	});

	it('triggers redirect when user is not authenticated and not loading', () => {
		authStore.clearUser();

		// Direct property access
		expect(authStore.isAuthenticated).toBe(false);
		expect(authStore.isLoading).toBe(false);

		// Should redirect to auth
		const shouldRedirect = !authStore.isLoading && !authStore.isAuthenticated;
		expect(shouldRedirect).toBe(true);

		// Simulate the redirect logic
		if (shouldRedirect) {
			goto(resolve('/auth'));
		}

		expect(goto).toHaveBeenCalledWith('/auth');
	});

	it('does not redirect when still loading', () => {
		authStore.setLoading(true);

		// Direct property access
		expect(authStore.isLoading).toBe(true);

		// Should not redirect when loading
		const shouldRedirect = !authStore.isLoading && !authStore.isAuthenticated;
		expect(shouldRedirect).toBe(false);
		expect(goto).not.toHaveBeenCalled();
	});

	it('handles authentication state transitions correctly', () => {
		// Initial loading state
		expect(authStore.isLoading).toBe(true);

		// Authenticate user
		authStore.setUser(mockUser);
		expect(authStore.isAuthenticated).toBe(true);
		expect(authStore.isLoading).toBe(false);

		// Log out user
		authStore.clearUser();
		expect(authStore.isAuthenticated).toBe(false);
		expect(authStore.isLoading).toBe(false);
	});

	it('provides correct loading UI state', () => {
		authStore.setLoading(true);

		// Direct property access
		const uiState = {
			showLoading: authStore.isLoading,
			showContent: authStore.isAuthenticated && !authStore.isLoading,
			showRedirect: !authStore.isLoading && !authStore.isAuthenticated
		};

		expect(uiState.showLoading).toBe(true);
		expect(uiState.showContent).toBe(false);
		expect(uiState.showRedirect).toBe(false);
	});

	it('provides correct authenticated UI state', () => {
		authStore.setUser(mockUser);

		// Direct property access
		const uiState = {
			showLoading: authStore.isLoading,
			showContent: authStore.isAuthenticated && !authStore.isLoading,
			showRedirect: !authStore.isLoading && !authStore.isAuthenticated
		};

		expect(uiState.showLoading).toBe(false);
		expect(uiState.showContent).toBe(true);
		expect(uiState.showRedirect).toBe(false);
	});

	it('provides correct unauthenticated UI state', () => {
		authStore.clearUser();

		// Direct property access
		const uiState = {
			showLoading: authStore.isLoading,
			showContent: authStore.isAuthenticated && !authStore.isLoading,
			showRedirect: !authStore.isLoading && !authStore.isAuthenticated
		};

		expect(uiState.showLoading).toBe(false);
		expect(uiState.showContent).toBe(false);
		expect(uiState.showRedirect).toBe(true);
	});
});
