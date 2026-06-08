import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { authStore } from '$lib/stores/auth.svelte';
import { routes } from '$lib/routes';

// Public routes — reachable WITHOUT authentication. This is the source of truth:
// everything NOT listed here is protected (deny-by-default), so a newly-added
// authed route (e.g. /insurance, /reminders, /profile, /trips) is guarded
// automatically instead of silently leaking a broken authed shell to logged-out
// visitors until someone remembers to extend an allowlist. The public set is small
// and stable (marketing + sign-in + legal); the authed surface is the one that grows.
//   '/'               — landing page (its own $effect bounces authed users to /dashboard)
//   '/auth'           — sign-in (login initiation + OAuth callback live under it)
//   '/privacypolicy', '/termsofservice' — legal pages, footer-linked, must be public
export const publicRoutes = ['/', '/auth', '/privacypolicy', '/termsofservice'];

// Routes that, when an authenticated user lands on them, redirect to the dashboard
// (you shouldn't sit on the sign-in page while signed in). The landing page handles
// its own authed redirect, and the legal pages are readable while signed in, so only
// '/auth' belongs here.
export const authRedirectRoutes = ['/auth'];

// A path is public if it exactly equals a public route or is a sub-path of one
// (e.g. /auth/callback). The exact-or-segment match avoids a prefix like '/trips'
// being treated as public just because some public route is a string prefix — and
// keeps '/' from matching everything (special-cased below).
function matchesRoute(pathname: string, routeList: string[]): boolean {
	return routeList.some((route) => {
		if (route === '/') return pathname === '/';
		return pathname === route || pathname.startsWith(`${route}/`);
	});
}

export function isPublicRoute(pathname: string): boolean {
	return matchesRoute(pathname, publicRoutes);
}

// Protected = anything that isn't public (deny-by-default).
export function isProtectedRoute(pathname: string): boolean {
	return !isPublicRoute(pathname);
}

export function handleRouteProtection(
	pathname: string,
	isAuthenticated: boolean,
	isLoading: boolean
) {
	if (isLoading) return;

	// Landing page — send an already-authenticated user straight to the dashboard.
	if (pathname === '/' && isAuthenticated) {
		goto(resolve(routes.dashboard));
		return;
	}

	// Protected routes (everything not public) — a logged-out visitor is redirected
	// to sign-in instead of being shown a broken authed shell that 401s on load.
	if (!isAuthenticated && isProtectedRoute(pathname)) {
		goto(resolve(routes.auth));
		return;
	}

	// Don't sit on the sign-in page while authenticated. (The legal pages are public
	// too but readable while signed in, so they are deliberately NOT redirected.)
	if (isAuthenticated && matchesRoute(pathname, authRedirectRoutes)) {
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
