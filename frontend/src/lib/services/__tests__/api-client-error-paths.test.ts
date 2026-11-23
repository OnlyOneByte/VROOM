import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { apiClient } from '../api-client';
import { authStore } from '../../stores/auth.svelte';
import { appStore } from '../../stores/app.svelte';
import { ApiError, NetworkError } from '../../utils/error-handling';
import type { User } from '../../types/index.js';

const env = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/env', () => ({
	get browser() {
		return env.browser;
	}
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockUser: User = {
	id: 'u1',
	email: 'test@example.com',
	displayName: 'Test User',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function sessionExpired(): Response {
	return jsonResponse(401, { error: { code: 'AuthenticationError', message: 'expired' } });
}

async function rejection(request: Promise<unknown>): Promise<unknown> {
	return request.then(
		() => {
			throw new Error('expected the request to fail');
		},
		(error: unknown) => error
	);
}

describe('api client error responses', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('falls back to the status message when the error body names no message', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse(418, { error: { code: 'Teapot' } }));

		const error = await rejection(apiClient.get('/vehicles'));

		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).message).toBe('Request failed with status 418');
		expect((error as ApiError).code).toBe('Teapot');
	});

	it('passes object details through unchanged', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse(409, { error: { message: 'Conflict', details: { field: 'vin' } } })
		);

		const error = await rejection(apiClient.post('/vehicles', { vin: 'x' }));

		expect((error as ApiError).details).toEqual({ field: 'vin' });
	});

	it('reports a non-Error fetch failure as a generic network error', async () => {
		mockFetch.mockRejectedValueOnce('offline');

		const error = await rejection(apiClient.get('/vehicles'));

		expect(error).toBeInstanceOf(NetworkError);
		expect((error as NetworkError).message).toBe('Network request failed');
		expect((error as NetworkError).cause).toBe('offline');
	});
});

describe('api client session expiry failures', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		env.browser = true;
		appStore.reset();
		authStore.setUser(mockUser);
		mockFetch.mockImplementation(() => Promise.resolve(sessionExpired()));
	});

	afterEach(() => {
		vi.advanceTimersByTime(2000);
		vi.useRealTimers();
		vi.restoreAllMocks();
		env.browser = true;
	});

	it('leaves the session alone during server rendering', async () => {
		env.browser = false;

		await expect(apiClient.get('/expenses')).rejects.toBeInstanceOf(ApiError);

		expect(authStore.isAuthenticated).toBe(true);
		expect(goto).not.toHaveBeenCalled();
	});

	it('still throws the ApiError when the redirect fails', async () => {
		const redirectFailure = new Error('navigation cancelled');
		vi.mocked(goto).mockRejectedValueOnce(redirectFailure);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(apiClient.get('/expenses')).rejects.toBeInstanceOf(ApiError);
		await vi.waitFor(() =>
			expect(consoleError).toHaveBeenCalledWith('Session-expiry redirect failed:', redirectFailure)
		);

		expect(authStore.isAuthenticated).toBe(false);
	});

	it('still throws the ApiError when ending the session fails', async () => {
		const clearFailure = new Error('store unavailable');
		vi.spyOn(authStore, 'clearUser').mockImplementationOnce(() => {
			throw clearFailure;
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(apiClient.get('/expenses')).rejects.toBeInstanceOf(ApiError);

		expect(consoleError).toHaveBeenCalledWith('Failed to handle session expiry:', clearFailure);
		expect(goto).not.toHaveBeenCalled();
	});
});
