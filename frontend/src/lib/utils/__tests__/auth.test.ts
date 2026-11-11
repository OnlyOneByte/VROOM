import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	isPublicRoute,
	isProtectedRoute,
	publicRoutes,
	handleRouteProtection,
	requireAuth
} from '../auth';
import { goto } from '$app/navigation';
import { authStore } from '$lib/stores/auth.svelte';
import type { User } from '$lib/types';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const mockUser: User = {
	id: 'u1',
	email: 'test@example.com',
	displayName: 'Test User',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

const AUTHED_ROUTES = [
	'/dashboard',
	'/vehicles',
	'/expenses',
	'/analytics',
	'/settings',
	'/insurance',
	'/reminders',
	'/profile',
	'/trips'
];

const PUBLIC_ROUTES = ['/', '/auth', '/privacypolicy', '/termsofservice'];

describe('route classification (deny-by-default)', () => {
	it('treats exactly the marketing/sign-in/legal routes as public', () => {
		for (const r of PUBLIC_ROUTES) {
			expect(isPublicRoute(r), `${r} should be public`).toBe(true);
			expect(isProtectedRoute(r), `${r} should NOT be protected`).toBe(false);
		}
	});

	it('protects every authed route — including the ones a manual allowlist forgot', () => {
		for (const r of AUTHED_ROUTES) {
			expect(isProtectedRoute(r), `${r} must be protected`).toBe(true);
			expect(isPublicRoute(r), `${r} must not be public`).toBe(false);
		}
	});

	it('protects sub-paths of authed routes', () => {
		for (const r of ['/vehicles/abc123', '/expenses/abc/edit', '/insurance/xyz/terms/new']) {
			expect(isProtectedRoute(r), `${r} must be protected`).toBe(true);
		}
	});

	it('treats sub-paths of public routes as public (e.g. OAuth callback)', () => {
		expect(isPublicRoute('/auth/callback')).toBe(true);
		expect(isPublicRoute('/auth/oauth-complete')).toBe(true);
	});

	it("does NOT let the root '/' make every path public", () => {
		expect(isPublicRoute('/dashboard')).toBe(false);
		expect(publicRoutes).toContain('/');
	});

	it('does not treat a route that merely shares a name prefix as public', () => {
		expect(isProtectedRoute('/trips')).toBe(true);
		expect(isProtectedRoute('/terms-of-use')).toBe(true);
	});
});

describe('handleRouteProtection redirects', () => {
	beforeEach(() => vi.clearAllMocks());

	it('does nothing while auth is still loading', () => {
		handleRouteProtection('/dashboard', false, true);
		expect(goto).not.toHaveBeenCalled();
	});

	it('redirects a logged-out user off a protected route to /auth', () => {
		for (const r of AUTHED_ROUTES) {
			vi.clearAllMocks();
			handleRouteProtection(r, false, false);
			expect(goto, `${r} should bounce to /auth when logged out`).toHaveBeenCalledWith('/auth');
		}
	});

	it('does NOT redirect a logged-out user off a public route', () => {
		for (const r of PUBLIC_ROUTES) {
			vi.clearAllMocks();
			handleRouteProtection(r, false, false);
			expect(goto, `${r} should not redirect when logged out`).not.toHaveBeenCalled();
		}
	});

	it('sends an authed user from / and /auth to the dashboard', () => {
		for (const r of ['/', '/auth']) {
			vi.clearAllMocks();
			handleRouteProtection(r, true, false);
			expect(goto, `${r} should redirect an authed user to /dashboard`).toHaveBeenCalledWith(
				'/dashboard'
			);
		}
	});

	it('lets an authed user READ the legal pages (no redirect away)', () => {
		for (const r of ['/privacypolicy', '/termsofservice']) {
			vi.clearAllMocks();
			handleRouteProtection(r, true, false);
			expect(goto, `${r} must be readable while signed in`).not.toHaveBeenCalled();
		}
	});

	it('lets an authed user stay on a protected route', () => {
		handleRouteProtection('/insurance', true, false);
		expect(goto).not.toHaveBeenCalled();
	});
});

describe('requireAuth', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.clearUser();
		authStore.setLoading(false);
	});
	afterEach(() => {
		vi.useRealTimers();
		authStore.setLoading(false);
	});

	it('resolves true and does NOT redirect when already authenticated (not loading)', async () => {
		authStore.setUser(mockUser);
		await expect(requireAuth()).resolves.toBe(true);
		expect(goto).not.toHaveBeenCalled();
	});

	it('resolves false and redirects to /auth when not authenticated (not loading)', async () => {
		authStore.clearUser();
		await expect(requireAuth()).resolves.toBe(false);
		expect(goto).toHaveBeenCalledWith('/auth');
	});

	it('polls while loading, then resolves true once auth resolves authenticated', async () => {
		vi.useFakeTimers();
		authStore.setLoading(true);

		const pending = requireAuth();

		authStore.setUser(mockUser);
		await vi.advanceTimersByTimeAsync(60);

		await expect(pending).resolves.toBe(true);
		expect(goto).not.toHaveBeenCalled();
	});

	it('polls while loading, then resolves false + redirects once auth resolves unauthenticated', async () => {
		vi.useFakeTimers();
		authStore.setLoading(true);

		const pending = requireAuth();

		authStore.setLoading(false);
		await vi.advanceTimersByTimeAsync(60);

		await expect(pending).resolves.toBe(false);
		expect(goto).toHaveBeenCalledWith('/auth');
	});
});
