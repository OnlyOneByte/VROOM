import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { authStore } from '$lib/stores/auth.svelte';
import { routes } from '$lib/routes';

export const publicRoutes = ['/', '/auth', '/privacypolicy', '/termsofservice'];

const authRedirectRoutes = ['/auth'];

function matchesRoute(pathname: string, routeList: string[]): boolean {
	return routeList.some(route => {
		if (route === '/') return pathname === '/';
		return pathname === route || pathname.startsWith(`${route}/`);
	});
}

export function isPublicRoute(pathname: string): boolean {
	return matchesRoute(pathname, publicRoutes);
}

export function isProtectedRoute(pathname: string): boolean {
	return !isPublicRoute(pathname);
}

export function handleRouteProtection(
	pathname: string,
	isAuthenticated: boolean,
	isLoading: boolean
) {
	if (isLoading) return;

	if (pathname === '/' && isAuthenticated) {
		goto(resolve(routes.dashboard));
		return;
	}

	if (!isAuthenticated && isProtectedRoute(pathname)) {
		goto(resolve(routes.auth));
		return;
	}

	if (isAuthenticated && matchesRoute(pathname, authRedirectRoutes)) {
		goto(resolve(routes.dashboard));
	}
}

export function requireAuth(): Promise<boolean> {
	if (!authStore.isLoading) {
		if (!authStore.isAuthenticated) {
			goto(resolve(routes.auth));
			return Promise.resolve(false);
		}
		return Promise.resolve(true);
	}

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
