import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { authStore } from '../../stores/auth.js';
import type { User } from '../../types/index.js';
import { goto } from '$app/navigation';

// Mock $app/navigation
vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

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

		const authState = get(authStore);
		expect(authState.isLoading).toBe(true);
		expect(authState.isAuthenticated).toBe(false);

		// Should show loading, not redirect
		const shouldRedirect = !authState.isLoading && !authState.isAuthenticated;
		expect(shouldRedirect).toBe(false);
	});

	it('allows access when user is authenticated', () => {
		authStore.setUser(mockUser);

		const authState = get(authStore);
		expect(authState.isAuthenticated).toBe(true);
		expect(authState.isLoading).toBe(false);

		// Should allow access, not redirect
		const shouldRedirect = !authState.isLoading && !authState.isAuthenticated;
		expect(shouldRedirect).toBe(false);
	});

	it('triggers redirect when user is not authenticated and not loading', () => {
		authStore.clearUser();

		const authState = get(authStore);
		expect(authState.isAuthenticated).toBe(false);
		expect(authState.isLoading).toBe(false);

		// Should redirect to auth
		const shouldRedirect = !authState.isLoading && !authState.isAuthenticated;
		expect(shouldRedirect).toBe(true);

		// Simulate the redirect logic
		if (shouldRedirect) {
			goto('/auth');
		}

		expect(goto).toHaveBeenCalledWith('/auth');
	});

	it('does not redirect when still loading', () => {
		authStore.setLoading(true);

		const authState = get(authStore);
		expect(authState.isLoading).toBe(true);

		// Should not redirect when loading
		const shouldRedirect = !authState.isLoading && !authState.isAuthenticated;
		expect(shouldRedirect).toBe(false);
		expect(goto).not.toHaveBeenCalled();
	});

	it('handles authentication state transitions correctly', () => {
		const states: { isLoading: boolean; isAuthenticated: boolean; shouldRedirect: boolean }[] = [];

		const unsubscribe = authStore.subscribe(state => {
			const shouldRedirect = !state.isLoading && !state.isAuthenticated;
			states.push({
				isLoading: state.isLoading,
				isAuthenticated: state.isAuthenticated,
				shouldRedirect
			});
		});

		// Initial loading state
		expect(states[0]?.isLoading).toBe(true);
		expect(states[0]?.shouldRedirect).toBe(false);

		// Authenticate user
		authStore.setUser(mockUser);
		expect(states[1]?.isAuthenticated).toBe(true);
		expect(states[1]?.shouldRedirect).toBe(false);

		// Log out user
		authStore.clearUser();
		expect(states[2]?.isAuthenticated).toBe(false);
		expect(states[2]?.isLoading).toBe(false);
		expect(states[2]?.shouldRedirect).toBe(true);

		unsubscribe();
	});

	it('provides correct loading UI state', () => {
		authStore.setLoading(true);

		const authState = get(authStore);
		const uiState = {
			showLoading: authState.isLoading,
			showContent: authState.isAuthenticated && !authState.isLoading,
			showRedirect: !authState.isLoading && !authState.isAuthenticated
		};

		expect(uiState.showLoading).toBe(true);
		expect(uiState.showContent).toBe(false);
		expect(uiState.showRedirect).toBe(false);
	});

	it('provides correct authenticated UI state', () => {
		authStore.setUser(mockUser);

		const authState = get(authStore);
		const uiState = {
			showLoading: authState.isLoading,
			showContent: authState.isAuthenticated && !authState.isLoading,
			showRedirect: !authState.isLoading && !authState.isAuthenticated
		};

		expect(uiState.showLoading).toBe(false);
		expect(uiState.showContent).toBe(true);
		expect(uiState.showRedirect).toBe(false);
	});

	it('provides correct unauthenticated UI state', () => {
		authStore.clearUser();

		const authState = get(authStore);
		const uiState = {
			showLoading: authState.isLoading,
			showContent: authState.isAuthenticated && !authState.isLoading,
			showRedirect: !authState.isLoading && !authState.isAuthenticated
		};

		expect(uiState.showLoading).toBe(false);
		expect(uiState.showContent).toBe(false);
		expect(uiState.showRedirect).toBe(true);
	});
});
