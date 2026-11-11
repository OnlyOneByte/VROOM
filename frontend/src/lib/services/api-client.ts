/**
 * Centralized API client
 *
 * All API calls should go through this client to ensure:
 * - Consistent credentials handling
 * - Consistent error handling
 * - Response envelope unwrapping (extracts `data` from `{ success, data }`)
 */

import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { ApiError } from '$lib/utils/error-handling';

/** Returns the API base URL (e.g. "https://api.vroom.ryang.dev") or empty string for same-origin. */
export function getApiBaseUrl(): string {
	return env['PUBLIC_API_URL'] ?? '';
}

/**
 * Auth endpoints for which a 401 is an ordinary answer rather than an expiry: the startup probe
 * (`authStore.initialize`) and the refresh call both read it as "not signed in" and handle it
 * themselves. Running the global handler for them would toast and redirect on every page load
 * made by a visitor who is simply not logged in.
 */
const SELF_REPORTED_401_PATHS = ['/api/v1/auth/me', '/api/v1/auth/refresh'];

/** One toast and one navigation per expiry, however many in-flight requests see the same 401. */
let sessionExpiryHandled = false;

/**
 * A 401 on an app request means the server-side session is gone, so the auth store still claiming
 * an authenticated user is a lie: clear it, say why, and send the user to sign in. This is the only
 * place the app reaches the network, which is why it is the only place that can see every 401.
 *
 * Clearing the store also makes the layout's route-protection effect navigate — to the same
 * destination, so the duplicate is harmless; the latch above is about repeated 401s, not that.
 *
 * Total by construction: the caller is about to throw an `ApiError` describing the real failure,
 * and a secondary fault in notifying or navigating must not replace it with an unrelated one.
 */
async function handleSessionExpiry(url: string): Promise<void> {
	if (!browser || sessionExpiryHandled) return;
	if (SELF_REPORTED_401_PATHS.some(path => url.includes(path))) return;

	sessionExpiryHandled = true;
	setTimeout(() => {
		sessionExpiryHandled = false;
	}, 1000);

	try {
		// Imported lazily: the stores import this module, so a static import would be circular.
		const [{ authStore }, { appStore }] = await Promise.all([
			import('$lib/stores/auth.svelte'),
			import('$lib/stores/app.svelte')
		]);
		authStore.clearUser();
		appStore.addNotification({
			type: 'warning',
			message: 'Your session has expired. Please sign in again.',
			duration: 5000
		});

		const [{ goto }, { resolve }, { routes }] = await Promise.all([
			import('$app/navigation'),
			import('$app/paths'),
			import('$lib/routes')
		]);
		// Started, not awaited: the caller is blocked on this before it can throw its own ApiError,
		// and a navigation that stalls (a `beforeNavigate` hold, say) must not strand that error.
		void goto(resolve(routes.auth)).catch((error: unknown) => {
			if (import.meta.env.DEV) console.error('Session-expiry redirect failed:', error);
		});
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to handle session expiry:', error);
	}
}

interface ApiOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	signal?: AbortSignal;
}

function toFetchBody(body: unknown): globalThis.BodyInit | undefined {
	if (body instanceof FormData) return body;
	if (body) return JSON.stringify(body);
	return undefined;
}

/**
 * Shared fetch core for `request`/`requestFull`: resolves the URL, sets the JSON Content-Type
 * (skipped for FormData), sends with `credentials: 'include'`, and on a non-ok response parses the
 * backend `{ error: { message, code, details } }` envelope into a thrown `ApiError`. Returns the
 * ok Response so each caller does its OWN success-body handling (unwrap-data vs raw-JSON). The
 * fetch-setup + error-parsing block was byte-identical across both wrappers — one
 * source of truth so an error-shape fix can't land in one path and be forgotten in the other.
 */
async function fetchOrThrow(url: string, options: ApiOptions): Promise<Response> {
	const { body, headers: customHeaders, method, signal } = options;
	const fullUrl = url.startsWith('http') ? url : `${getApiBaseUrl()}${url}`;

	const headers: Record<string, string> = {
		...(customHeaders || {})
	};

	if (body && !(body instanceof FormData)) {
		headers['Content-Type'] = 'application/json';
	}

	const response = await fetch(fullUrl, {
		method,
		credentials: 'include',
		headers,
		signal,
		body: toFetchBody(body)
	});

	if (!response.ok) {
		if (response.status === 401) await handleSessionExpiry(fullUrl);

		let message = `Request failed with status ${response.status}`;
		let code: string | undefined;
		let details: Record<string, unknown> | undefined;
		try {
			const errorBody = await response.json();
			message = errorBody.error?.message || errorBody.message || message;
			code = errorBody.error?.code;
			if (errorBody.error?.details) {
				details = Array.isArray(errorBody.error.details)
					? { validationErrors: errorBody.error.details }
					: (errorBody.error.details as Record<string, unknown>);
			}
		} catch {
			// ignore parse errors
		}
		throw new ApiError(message, response.status, details, code);
	}

	return response;
}

async function request<T>(url: string, options: ApiOptions = {}): Promise<T> {
	const response = await fetchOrThrow(url, options);

	// Handle empty responses (204, etc.)
	const contentType = response.headers.get('content-type');
	if (!contentType?.includes('application/json')) {
		return response as unknown as T;
	}

	const result = await response.json();

	// Unwrap the { success, data } envelope
	return result.data !== undefined ? result.data : result;
}

/**
 * Like `request`, but returns the full JSON body without unwrapping the
 * `data` field. Used for paginated endpoints where we need `{ data, pagination }`.
 */
async function requestFull<T>(url: string, options: ApiOptions = {}): Promise<T> {
	const response = await fetchOrThrow(url, options);
	return response.json();
}

/** Append limit/offset query params to a URL path. */
export function withPagination(url: string, params?: { limit?: number; offset?: number }): string {
	const query = new URLSearchParams();
	if (params?.limit !== undefined) query.set('limit', String(params.limit));
	if (params?.offset !== undefined) query.set('offset', String(params.offset));
	const qs = query.toString();
	return qs ? `${url}?${qs}` : url;
}

export const apiClient = {
	get: <T>(url: string, options?: ApiOptions) => request<T>(url, { ...options, method: 'GET' }),

	post: <T>(url: string, body?: unknown, options?: ApiOptions) =>
		request<T>(url, { ...options, method: 'POST', body }),

	put: <T>(url: string, body?: unknown, options?: ApiOptions) =>
		request<T>(url, { ...options, method: 'PUT', body }),

	patch: <T>(url: string, body?: unknown, options?: ApiOptions) =>
		request<T>(url, { ...options, method: 'PATCH', body }),

	delete: <T>(url: string, options?: ApiOptions) =>
		request<T>(url, { ...options, method: 'DELETE' }),

	/** Returns the raw Response (for file downloads, etc.) */
	raw: (url: string, options: { method?: string; headers?: Record<string, string> } = {}) => {
		const fullUrl = url.startsWith('http') ? url : `${getApiBaseUrl()}${url}`;
		return fetch(fullUrl, { credentials: 'include', ...options });
	},

	/**
	 * GET a paginated endpoint and return the full envelope (data + pagination).
	 * Unlike `get()`, this does NOT unwrap the `data` field — it returns the
	 * complete `{ data, pagination }` response so callers keep metadata.
	 */
	getPaginated: <T>(url: string, options?: ApiOptions) =>
		requestFull<{
			data: T[];
			pagination: { totalCount: number; limit: number; offset: number; hasMore: boolean };
		}>(url, { ...options, method: 'GET' })
};
