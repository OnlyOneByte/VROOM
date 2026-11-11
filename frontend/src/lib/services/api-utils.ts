/**
 * Drops null/undefined values; other falsy values (0, '', false) are kept. Callers that want '' dropped
 * must coalesce it to undefined first.
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
