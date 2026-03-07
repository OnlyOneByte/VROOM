import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { authStore } from '$lib/stores/auth.svelte';
import { routes } from '$lib/routes';

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

	// Handle root path — only redirect authenticated users to dashboard
	if (pathname === '/' && isAuthenticated) {
		goto(resolve(routes.dashboard));
		return;
	}

	// Handle protected routes
	if (isProtectedRoute(pathname) && !isAuthenticated) {
		goto(resolve(routes.auth));
		return;
	}

	// Handle public routes
	if (isPublicRoute(pathname) && isAuthenticated) {
		goto(resolve(routes.dashboard));
	}
}

export function requireAuth(): Promise<boolean> {
	// With runes store, check state directly
	if (!authStore.isLoading) {
		if (!authStore.isAuthenticated) {
			goto(resolve(routes.auth));
			return Promise.resolve(false);
		}
		return Promise.resolve(true);
	}

	// If still loading, poll until resolved
	return new Promise(resolve_ => {
		const check = () => {
			if (!authStore.isLoading) {
				if (!authStore.isAuthenticated) {
					goto(resolve(routes.auth));
					resolve_(false);
				} else {
					resolve_(true);
				}
			} else {
				setTimeout(check, 50);
			}
		};
		check();
	});
}
