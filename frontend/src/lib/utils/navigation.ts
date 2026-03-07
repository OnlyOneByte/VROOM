import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

/**
 * Navigate to a dynamic path that isn't known at compile time
 * (e.g., `returnTo` from URL search params).
 *
 * Calls resolve() internally for base-path safety.
 */
export function gotoDynamic(path: string): ReturnType<typeof goto> {
	// Cast needed: resolve() expects typed route literals, but dynamic paths
	// (e.g. returnTo from URL params) are plain strings at runtime.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return goto(resolve(path as any));
}

/**
 * Navigate to a route with query parameters.
 * Accepts a resolved path (from resolve()) and a query params object.
 *
 * Example:
 *   gotoWithQuery(resolve(routes.expenseNew), { vehicleId: id, returnTo: '/dashboard' })
 *   gotoWithQuery(resolve(paramRoutes.insurancePolicyEdit, { id }), { returnTo: '/vehicles/123' })
 */
export function gotoWithQuery(
	resolvedPath: string,
	query: Record<string, string>
): ReturnType<typeof goto> {
	const qs = new URLSearchParams(query).toString();
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is pre-resolved by caller
	return goto(qs ? `${resolvedPath}?${qs}` : resolvedPath);
}
