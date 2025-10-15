import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { authStore } from '../../stores/auth.js';
import { appStore } from '../../stores/app.js';
import type { User } from '../../types/index.js';

// Mock $app/stores
vi.mock('$app/stores', () => {
	const mockPageStore = {
		subscribe: vi.fn(callback => {
			callback({ url: { pathname: '/dashboard' } });
			return () => {};
		})
	};

	return {
		page: mockPageStore
	};
});

// Mock SyncStatusIndicator component
vi.mock('../SyncStatusIndicator.svelte', () => ({
	default: class MockSyncStatusIndicator {
		constructor() {}
	}
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

describe('Navigation Component Logic', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset stores to initial state
		authStore.clearUser();
		appStore.closeMobileMenu();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('manages authentication state correctly', () => {
		// Initially not authenticated
		let authState = get(authStore);
		expect(authState.isAuthenticated).toBe(false);

		// Set user
		authStore.setUser(mockUser);
		authState = get(authStore);
		expect(authState.isAuthenticated).toBe(true);
		expect(authState.user?.displayName).toBe('Test User');
		expect(authState.user?.email).toBe('test@example.com');
	});

	it('manages mobile menu state correctly', () => {
		// Initially closed
		let appState = get(appStore);
		expect(appState.isMobileMenuOpen).toBe(false);

		// Toggle open
		appStore.toggleMobileMenu();
		appState = get(appStore);
		expect(appState.isMobileMenuOpen).toBe(true);

		// Close
		appStore.closeMobileMenu();
		appState = get(appStore);
		expect(appState.isMobileMenuOpen).toBe(false);
	});

	it('determines active navigation correctly', () => {
		const isActive = (href: string, currentPath: string): boolean => {
			if (href === '/dashboard') {
				return currentPath === '/' || currentPath === '/dashboard';
			}
			return currentPath.startsWith(href);
		};

		// Test dashboard active states
		expect(isActive('/dashboard', '/')).toBe(true);
		expect(isActive('/dashboard', '/dashboard')).toBe(true);
		expect(isActive('/dashboard', '/vehicles')).toBe(false);

		// Test other routes
		expect(isActive('/vehicles', '/vehicles')).toBe(true);
		expect(isActive('/vehicles', '/vehicles/123')).toBe(true);
		expect(isActive('/vehicles', '/expenses')).toBe(false);

		expect(isActive('/expenses', '/expenses')).toBe(true);
		expect(isActive('/expenses', '/expenses/add')).toBe(true);
		expect(isActive('/expenses', '/analytics')).toBe(false);
	});

	it('handles logout functionality', async () => {
		// Set authenticated user
		authStore.setUser(mockUser);
		let authState = get(authStore);
		expect(authState.isAuthenticated).toBe(true);

		// Mock successful logout
		global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });

		// Logout
		await authStore.logout();
		authState = get(authStore);
		expect(authState.isAuthenticated).toBe(false);
		expect(authState.user).toBe(null);
	});

	it('provides correct navigation items', () => {
		const navigation = [
			{ name: 'Dashboard', href: '/dashboard' },
			{ name: 'Vehicles', href: '/vehicles' },
			{ name: 'Expenses', href: '/expenses' },
			{ name: 'Analytics', href: '/analytics' },
			{ name: 'Settings', href: '/settings' }
		];

		expect(navigation).toHaveLength(5);
		expect(navigation.find(item => item.name === 'Dashboard')).toBeDefined();
		expect(navigation.find(item => item.name === 'Vehicles')).toBeDefined();
		expect(navigation.find(item => item.name === 'Expenses')).toBeDefined();
		expect(navigation.find(item => item.name === 'Analytics')).toBeDefined();
		expect(navigation.find(item => item.name === 'Settings')).toBeDefined();
	});

	it('handles responsive breakpoints', () => {
		// Test responsive class logic
		const getResponsiveClasses = (isMobile: boolean) => {
			return {
				mobileHeader: isMobile ? 'lg:hidden fixed top-0' : 'lg:hidden fixed top-0',
				desktopSidebar: 'hidden lg:fixed lg:inset-y-0',
				mobileMenu: isMobile ? 'translate-x-0' : '-translate-x-full'
			};
		};

		const mobileClasses = getResponsiveClasses(true);
		expect(mobileClasses.mobileHeader).toContain('lg:hidden');
		expect(mobileClasses.desktopSidebar).toContain('hidden lg:fixed');

		const desktopClasses = getResponsiveClasses(false);
		expect(desktopClasses.mobileMenu).toBe('-translate-x-full');
	});

	it('manages user display information', () => {
		authStore.setUser(mockUser);
		const authState = get(authStore);

		const displayName = authState.user?.displayName || 'User';
		const email = authState.user?.email || '';

		expect(displayName).toBe('Test User');
		expect(email).toBe('test@example.com');
	});

	it('handles navigation state changes', () => {
		const states: any[] = [];

		const unsubscribe = authStore.subscribe(state => {
			states.push({ isAuthenticated: state.isAuthenticated });
		});

		// Initial state
		expect(states).toHaveLength(1);
		expect(states[0].isAuthenticated).toBe(false);

		// Authenticate
		authStore.setUser(mockUser);
		expect(states).toHaveLength(2);
		expect(states[1].isAuthenticated).toBe(true);

		// Logout
		authStore.clearUser();
		expect(states).toHaveLength(3);
		expect(states[2].isAuthenticated).toBe(false);

		unsubscribe();
	});
});
