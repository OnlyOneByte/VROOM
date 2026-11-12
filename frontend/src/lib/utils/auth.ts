import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { routes } from '#lib/routes.ts';

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
