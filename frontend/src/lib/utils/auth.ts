import { goto } from '$app/navigation';
import { authStore } from '$lib/stores/auth.js';

// Protected routes that require authentication
export const protectedRoutes = ['/dashboard', '/vehicles', '/expenses', '/analytics', '/settings'];

// Public routes that redirect to dashboard if authenticated
export const publicRoutes = ['/auth'];

export function isProtectedRoute(pathname: string): boolean {
	return protectedRoutes.some(route => pathname.startsWith(route));
}

export function isPublicRoute(pathname: string): boolean {
	return publicRoutes.some(route => pathname.startsWith(route));
}

export function handleRouteProtection(
	pathname: string,
	isAuthenticated: boolean,
	isLoading: boolean
) {
	// Skip route protection while auth is loading
	if (isLoading) return;

	const isProtected = isProtectedRoute(pathname);
	const isPublic = isPublicRoute(pathname);

	if (isProtected && !isAuthenticated) {
		// Redirect to auth page if trying to access protected route without authentication
		goto('/auth');
	} else if (isPublic && isAuthenticated) {
		// Redirect to dashboard if trying to access public route while authenticated
		goto('/dashboard');
	} else if (pathname === '/' && isAuthenticated) {
		// Redirect root to dashboard if authenticated
		goto('/dashboard');
	} else if (pathname === '/' && !isAuthenticated) {
		// Redirect root to auth if not authenticated
		goto('/auth');
	}
}

export function requireAuth(): Promise<boolean> {
	return new Promise(resolve => {
		const unsubscribe = authStore.subscribe(({ isAuthenticated, isLoading }) => {
			if (!isLoading) {
				unsubscribe();
				if (!isAuthenticated) {
					goto('/auth');
					resolve(false);
				} else {
					resolve(true);
				}
			}
		});
	});
}
