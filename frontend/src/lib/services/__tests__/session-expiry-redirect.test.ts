import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { apiClient } from '../api-client';
import { authStore } from '../../stores/auth.svelte';
import { appStore } from '../../stores/app.svelte';
import { handleErrorWithNotification } from '../../utils/error-handling';
import type { User } from '../../types/index.js';

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

function unauthorized(code = 'AuthenticationError'): Response {
	return new Response(JSON.stringify({ error: { code, message: 'Invalid or expired session' } }), {
		status: 401,
		headers: { 'content-type': 'application/json' }
	});
}

function expiryWarningShown(): boolean {
	return appStore.notifications.some(n => n.message.includes('session has expired'));
}

describe('api client — global session expiry on 401', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		appStore.reset();
		authStore.setUser(mockUser);
		mockFetch.mockImplementation(() => Promise.resolve(unauthorized()));
	});

	afterEach(() => {
		vi.advanceTimersByTime(2000);
		vi.useRealTimers();
	});

	it('clears the session, warns the user, and redirects on a 401 from an app request', async () => {
		await expect(apiClient.get('/api/v1/expenses')).rejects.toThrow();

		expect(authStore.isAuthenticated).toBe(false);
		expect(expiryWarningShown()).toBe(true);
		expect(goto).toHaveBeenCalledWith('/auth');
	});

	it('handles a 401 on a raw download the same way', async () => {
		await expect(apiClient.raw('/api/v1/sync/backups/download')).rejects.toThrow();

		expect(authStore.isAuthenticated).toBe(false);
		expect(expiryWarningShown()).toBe(true);
		expect(goto).toHaveBeenCalledWith('/auth');
	});

	it('leaves the startup auth probe to report its own 401', async () => {
		await expect(apiClient.get('/api/v1/auth/me')).rejects.toThrow();

		expect(authStore.isAuthenticated).toBe(true);
		expect(expiryWarningShown()).toBe(false);
		expect(goto).not.toHaveBeenCalled();
	});

	it('reacts once when several requests all see the same expiry', async () => {
		await expect(apiClient.get('/api/v1/expenses')).rejects.toThrow();
		await expect(apiClient.get('/api/v1/vehicles')).rejects.toThrow();

		expect(goto).toHaveBeenCalledTimes(1);
		expect(
			appStore.notifications.filter(n => n.message.includes('session has expired'))
		).toHaveLength(1);
	});

	it('keeps the user signed in when a storage provider rejects its credentials', async () => {
		mockFetch.mockResolvedValue(unauthorized('AUTH_INVALID'));

		const error = await apiClient.get('/api/v1/providers/p1/photos').catch((e: unknown) => e);
		handleErrorWithNotification(error, "Couldn't load the photos");

		expect(authStore.isAuthenticated).toBe(true);
		expect(expiryWarningShown()).toBe(false);
		expect(goto).not.toHaveBeenCalled();
		expect(appStore.notifications.map(n => n.message)).toEqual([
			"Couldn't load the photos. Your storage account needs to be reconnected. Reconnect it in Settings."
		]);
	});

	it('shows only the expiry notice when the failed requests also report their errors', async () => {
		await Promise.all(
			['/api/v1/expenses', '/api/v1/vehicles'].map(url =>
				apiClient.get(url).catch((error: unknown) => {
					handleErrorWithNotification(error, "Couldn't load the page");
				})
			)
		);

		expect(appStore.notifications).toHaveLength(1);
		expect(expiryWarningShown()).toBe(true);
	});

	it('shows error toasts again once the expiry has been handled', async () => {
		await expect(apiClient.get('/api/v1/expenses')).rejects.toThrow();
		vi.advanceTimersByTime(1000);

		appStore.showError("Couldn't save the trip.");

		expect(appStore.notifications.map(n => n.message)).toContain("Couldn't save the trip.");
	});
});
