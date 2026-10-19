/**
 * A 401 on an app request means the server-side session is gone, so the auth store still reporting
 * an authenticated user is a lie. The handler that clears it, warns the user and sends them to sign
 * in used to live in `hooks.client.ts` as a `handleFetch` export — a SERVER hook the generated
 * client manifest never reads — so it had never run: an expired session left the signed-in shell
 * rendered, every surface showing its own generic failure, and no way back to /auth. It now lives
 * in the api client, the single place app code reaches the network and therefore the only place
 * that sees every 401.
 *
 * The auth probe and refresh endpoints are excluded deliberately: both read a 401 as "not signed
 * in" and report it themselves, so running the global handler for them would warn and redirect
 * every logged-out visitor on page load.
 */

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
		// Release the once-per-expiry latch so the next case starts from a clean slate.
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

		// Untouched — not merely un-redirected, which is what a latched handler would also look like.
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
