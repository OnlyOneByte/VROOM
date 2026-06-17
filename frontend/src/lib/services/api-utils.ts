/**
 * Shared helpers for the API service layer.
 */

/**
 * Build a query string from a params object, dropping null/undefined values and prepending '?'
 * when non-empty (returns '' for an all-empty params object). The single source of truth for the
 * `new URLSearchParams` + `value != null` filter + `qs ? '?'+qs : ''` convention the service modules
 * repeated (analytics-api buildQuery, reminder-api buildReminderQuery).
 *
 * NOTE: the gate is `!= null` — undefined AND null are dropped, but other falsy values (0, '', false)
 * are KEPT and serialized. Callers that want a falsy value DROPPED (e.g. reminder-api's empty-string
 * vehicleId) must coalesce it to undefined before passing it in; callers that need a falsy value to
 * SURVIVE (e.g. isActive=false) pass it through as-is.
 */
export function buildQueryString(
	params: Record<string, string | number | boolean | undefined | null>
): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value != null) query.set(key, String(value));
	}
	const qs = query.toString();
	return qs ? `?${qs}` : '';
}
