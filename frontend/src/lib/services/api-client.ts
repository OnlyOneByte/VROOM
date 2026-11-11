/** Single entry point for HTTP calls: credentials, error mapping, envelope unwrapping. */

import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { ApiError } from '$lib/utils/error-handling';

/** Empty string means same-origin. */
export function getApiBaseUrl(): string {
	return env['PUBLIC_API_URL'] ?? '';
}

// A 401 here means "not signed in", which the callers handle; the global expiry handler must skip it.
const SELF_REPORTED_401_PATHS = ['/api/v1/auth/me', '/api/v1/auth/refresh'];

/** One toast and one navigation per expiry, however many in-flight requests see the same 401. */
let sessionExpiryHandled = false;

/**
 * Clears the auth store and redirects to sign-in. Never throws: the caller is about to throw the
 * real ApiError and a secondary failure here must not replace it.
 */
async function handleSessionExpiry(url: string): Promise<void> {
	if (!browser || sessionExpiryHandled) return;
	if (SELF_REPORTED_401_PATHS.some(path => url.includes(path))) return;

	sessionExpiryHandled = true;
	setTimeout(() => {
		sessionExpiryHandled = false;
	}, 1000);

	try {
		// Lazy: the stores import this module, so static imports would be circular.
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
		// Not awaited: a navigation that stalls (e.g. a beforeNavigate hold) must not block the ApiError.
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
 * Shared fetch core for `request` and `requestFull`. Throws an ApiError built from the backend
 * `{ error: { message, code, details } }` envelope on non-ok responses; callers handle success bodies.
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
			// Error body is not JSON; keep the status-based message.
		}
		throw new ApiError(message, response.status, details, code);
	}

	return response;
}

async function request<T>(url: string, options: ApiOptions = {}): Promise<T> {
	const response = await fetchOrThrow(url, options);

	// Non-JSON bodies (e.g. 204) are returned as the raw Response.
	const contentType = response.headers.get('content-type');
	if (!contentType?.includes('application/json')) {
		return response as unknown as T;
	}

	const result = await response.json();

	return result.data !== undefined ? result.data : result;
}

async function requestFull<T>(url: string, options: ApiOptions = {}): Promise<T> {
	const response = await fetchOrThrow(url, options);
	return response.json();
}

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

	raw: (url: string, options: { method?: string; headers?: Record<string, string> } = {}) => {
		const fullUrl = url.startsWith('http') ? url : `${getApiBaseUrl()}${url}`;
		return fetch(fullUrl, { credentials: 'include', ...options });
	},

	// Unlike get(), keeps the { data, pagination } envelope.
	getPaginated: <T>(url: string, options?: ApiOptions) =>
		requestFull<{
			data: T[];
			pagination: { totalCount: number; limit: number; offset: number; hasMore: boolean };
		}>(url, { ...options, method: 'GET' })
};
