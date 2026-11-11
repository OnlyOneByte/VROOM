import { ApiError } from '$lib/utils/error-handling';

/**
 * How a failed offline-expense delivery should be treated.
 *
 *  - `transient`: the request never reached a verdict (no response, a timeout, a rate limit) or the
 *    server failed on its own side. The SAME request can succeed later, so queue it and retry.
 *  - `auth`: the payload is fine, the caller just isn't signed in (401). Retrying on a timer can't
 *    fix that, but the row must still be kept and delivered after the next sign-in — so it neither
 *    burns the retry budget nor gets parked as broken.
 *  - `terminal`: the server examined the request and rejected it (any other 4xx, including a 403
 *    authorization verdict that signing in again would not change). It will be rejected identically
 *    forever, so retrying is an unbounded loop and calling it a connection problem is a lie —
 *    surface it to the user instead. 408 and 429 are 4xx by number but self-resolving, so they are
 *    transient.
 *
 * This lives in its own module because both delivery paths need it — `sync-manager`'s `syncAll` and
 * `offline-storage`'s `syncOfflineExpenses` — and `sync-manager` already imports from
 * `offline-storage`, so putting it in either would make the pair circular.
 */
export type SyncFailureKind = 'transient' | 'auth' | 'terminal';

export function classifySyncFailure(error: unknown): SyncFailureKind {
	const status = error instanceof ApiError ? error.statusCode : undefined;
	// No HTTP status at all (fetch rejected, request aborted, a non-API throw) — treat as transport.
	if (status === undefined) return 'transient';
	if (status === 401) return 'auth';
	if (status === 408 || status === 429) return 'transient';
	if (status >= 400 && status < 500) return 'terminal';
	return 'transient';
}
