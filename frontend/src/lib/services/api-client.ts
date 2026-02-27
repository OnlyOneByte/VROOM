/**
 * Centralized API client
 *
 * All API calls should go through this client to ensure:
 * - Consistent credentials handling
 * - Consistent error handling
 * - Response envelope unwrapping (extracts `data` from `{ success, data }`)
 */

import { ApiError } from '$lib/utils/error-handling';

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

async function request<T>(url: string, options: ApiOptions = {}): Promise<T> {
	const { body, headers: customHeaders, method, signal } = options;

	const headers: Record<string, string> = {
		...(customHeaders || {})
	};

	if (body && !(body instanceof FormData)) {
		headers['Content-Type'] = 'application/json';
	}

	const response = await fetch(url, {
		method,
		credentials: 'include',
		headers,
		signal,
		body: toFetchBody(body)
	});

	if (!response.ok) {
		let message = `Request failed with status ${response.status}`;
		try {
			const errorBody = await response.json();
			message = errorBody.error?.message || errorBody.message || message;
		} catch {
			// ignore parse errors
		}
		throw new ApiError(message, response.status);
	}

	// Handle empty responses (204, etc.)
	const contentType = response.headers.get('content-type');
	if (!contentType?.includes('application/json')) {
		return response as unknown as T;
	}

	const result = await response.json();

	// Unwrap the { success, data } envelope
	return result.data !== undefined ? result.data : result;
}

export const apiClient = {
	get: <T>(url: string, options?: ApiOptions) => request<T>(url, { ...options, method: 'GET' }),

	post: <T>(url: string, body?: unknown, options?: ApiOptions) =>
		request<T>(url, { ...options, method: 'POST', body }),

	put: <T>(url: string, body?: unknown, options?: ApiOptions) =>
		request<T>(url, { ...options, method: 'PUT', body }),

	delete: <T>(url: string, options?: ApiOptions) =>
		request<T>(url, { ...options, method: 'DELETE' }),

	/** Returns the raw Response (for file downloads, etc.) */
	raw: (url: string, options: { method?: string; headers?: Record<string, string> } = {}) =>
		fetch(url, { credentials: 'include', ...options })
};
