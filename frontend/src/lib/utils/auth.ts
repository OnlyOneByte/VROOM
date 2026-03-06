import { goto } from '$app/navigation';
import { authStore } from '$lib/stores/auth.js';

// Protected routes that require authentication
export const protectedRoutes = ['/dashboard', '/vehicles', '/expenses', '/analytics', '/settings'];

// Public routes that redirect to vehicles if authenticated
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
	if (isLoading) return;

	// Handle root path
	if (pathname === '/') {
		goto(isAuthenticated ? '/dashboard' : '/auth');
		return;
	}

	// Handle protected routes
	if (isProtectedRoute(pathname) && !isAuthenticated) {
		goto('/auth');
		return;
	}

	// Handle public routes
	if (isPublicRoute(pathname) && isAuthenticated) {
		goto('/dashboard');
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
