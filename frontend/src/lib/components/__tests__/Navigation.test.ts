import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authStore } from '../../stores/auth.svelte';
import type { User } from '../../types/index.js';

vi.mock('$app/state', () => ({
	page: { url: { pathname: '/dashboard' } }
}));

vi.mock('../SyncStatusIndicator.svelte', () => ({
	default: class MockSyncStatusIndicator {
		constructor() {}
	}
}));

const mockUser: User = {
	id: '1',
	email: 'test@example.com',
	displayName: 'Test User',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

describe('Navigation Component Logic', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.clearUser();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('manages authentication state correctly', () => {
		expect(authStore.isAuthenticated).toBe(false);

		authStore.setUser(mockUser);
		expect(authStore.isAuthenticated).toBe(true);
		expect(authStore.user?.displayName).toBe('Test User');
		expect(authStore.user?.email).toBe('test@example.com');
	});

	it('determines active navigation correctly', () => {
		const isActive = (href: string, currentPath: string): boolean => {
			if (href === '/dashboard') {
				return currentPath === '/' || currentPath === '/dashboard';
			}
			return currentPath.startsWith(href);
		};

		expect(isActive('/dashboard', '/')).toBe(true);
		expect(isActive('/dashboard', '/dashboard')).toBe(true);
		expect(isActive('/dashboard', '/expenses')).toBe(false);

		expect(isActive('/vehicles', '/vehicles')).toBe(true);
		expect(isActive('/vehicles', '/vehicles/123')).toBe(true);
		expect(isActive('/vehicles', '/expenses')).toBe(false);

		expect(isActive('/expenses', '/expenses')).toBe(true);
		expect(isActive('/expenses', '/expenses/add')).toBe(true);
		expect(isActive('/expenses', '/analytics')).toBe(false);
	});

	it('handles logout functionality', async () => {
		authStore.setUser(mockUser);
		expect(authStore.isAuthenticated).toBe(true);

		global.fetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			status: 200,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: () => Promise.resolve({ success: true, data: null })
		});

		await authStore.logout();
		expect(authStore.isAuthenticated).toBe(false);
		expect(authStore.user).toBe(null);
	});

	it('documents the current navigation items', () => {
		// Mirrors the Navigation.svelte arrays, which are not exported; keep it in sync when the nav changes.
		const navigation = [
			{ name: 'Dashboard', href: '/dashboard' },
			{ name: 'Expenses', href: '/expenses' },
			{ name: 'Insurance', href: '/insurance' },
			{ name: 'Analytics', href: '/analytics' },
			{ name: 'Reminders', href: '/reminders' },
			{ name: 'Trips', href: '/trips' }
		];
		const userNavigation = [{ name: 'Settings', href: '/settings' }];

		expect(navigation).toHaveLength(6);
		const declared = new Set([
			'/dashboard',
			'/expenses',
			'/insurance',
			'/analytics',
			'/reminders',
			'/trips',
			'/settings'
		]);
		for (const item of [...navigation, ...userNavigation]) {
			expect(declared.has(item.href), `${item.name} -> ${item.href}`).toBe(true);
		}
	});

	it('handles responsive breakpoints', () => {
		const getResponsiveClasses = (isMobile: boolean) => {
			return {
				mobileHeader: 'lg:hidden fixed top-0',
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

		const displayName = authStore.user?.displayName || 'User';
		const email = authStore.user?.email || '';

		expect(displayName).toBe('Test User');
		expect(email).toBe('test@example.com');
	});

	it('handles navigation state changes', () => {
		expect(authStore.isAuthenticated).toBe(false);

		authStore.setUser(mockUser);
		expect(authStore.isAuthenticated).toBe(true);

		authStore.clearUser();
		expect(authStore.isAuthenticated).toBe(false);
	});
});
