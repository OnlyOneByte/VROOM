// A 401 clears the auth store and redirects to sign-in. The auth probe and refresh endpoints are excluded because they report 401 themselves.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { apiClient } from '../api-client';
import { authStore } from '../../stores/auth.svelte';
import { appStore } from '../../stores/app.svelte';
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

function unauthorized(): Response {
	return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
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
		appStore.clearNotifications();
		authStore.setUser(mockUser);
		mockFetch.mockResolvedValue(unauthorized());
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
});
