import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { ApiError, NetworkError } from '$lib/utils/error-handling';
import { buildQueryString } from './api-utils';

export function getApiBaseUrl(): string {
	return env['PUBLIC_API_URL'] ?? '';
}

const SELF_REPORTED_401_PATHS = ['/api/v1/auth/me', '/api/v1/auth/refresh'];

let sessionExpiryHandled = false;

async function handleSessionExpiry(url: string): Promise<void> {
	if (!browser || sessionExpiryHandled) return;
	if (SELF_REPORTED_401_PATHS.some(path => url.includes(path))) return;

	sessionExpiryHandled = true;
	setTimeout(() => {
		sessionExpiryHandled = false;
	}, 1000);

	try {
		// Dynamic import: the stores import this module, so a static import is circular.
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
		// Not awaited: a stalled navigation must not block the ApiError.
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

async function fetchOrThrow(url: string, options: ApiOptions): Promise<Response> {
	const { body, headers: customHeaders, method, signal } = options;
	const fullUrl = url.startsWith('http') ? url : `${getApiBaseUrl()}${url}`;

	const headers: Record<string, string> = {
		...(customHeaders || {})
	};

	if (body && !(body instanceof FormData)) {
		headers['Content-Type'] = 'application/json';
	}

	let response: Response;
	try {
		response = await fetch(fullUrl, {
			method,
			credentials: 'include',
			headers,
			signal,
			body: toFetchBody(body)
		});
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new NetworkError(error);
	}

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
			// Non-JSON error body: keep the status-based message.
		}
		throw new ApiError(message, response.status, details, code);
	}

	return response;
}

async function request<T>(url: string, options: ApiOptions = {}): Promise<T> {
	const response = await fetchOrThrow(url, options);

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
	return `${url}${buildQueryString({ limit: params?.limit, offset: params?.offset })}`;
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

	raw: (url: string, options: Omit<ApiOptions, 'body'> = {}) => fetchOrThrow(url, options),

	getPaginated: <T>(url: string, options?: ApiOptions) =>
		requestFull<{
			data: T[];
			pagination: { totalCount: number; limit: number; offset: number; hasMore: boolean };
		}>(url, { ...options, method: 'GET' })
};
