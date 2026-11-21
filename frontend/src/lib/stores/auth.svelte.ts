import type { User } from '../types/index.js';
import { apiClient, getApiBaseUrl } from '#lib/services/api-client.ts';
import { ApiError, extractErrorMessage } from '#lib/utils/error-handling.ts';
import { clearOfflineCaches, setOfflineQueueOwner } from '#lib/utils/offline-storage.ts';
import { browser } from '$app/env';

const LAST_USER_KEY = 'vroom_last_user';

function rememberUser(user: User | null): void {
	if (!browser) return;
	try {
		if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
		else localStorage.removeItem(LAST_USER_KEY);
	} catch (error) {
		if (import.meta.env.DEV) console.warn('Failed to remember the signed-in user:', error);
	}
}

function lastKnownUser(): User | null {
	if (!browser) return null;
	try {
		const stored = localStorage.getItem(LAST_USER_KEY);
		return stored ? (JSON.parse(stored) as User) : null;
	} catch {
		return null;
	}
}

function isSignedOutResponse(error: unknown): boolean {
	return error instanceof ApiError && error.statusCode === 401;
}

function createAuthStore() {
	let user = $state<User | null>(null);
	let isAuthenticated = $state(false);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let token = $state<string | null>(null);
	let sessionUnverified = $state(false);
	let recheckingSession = $state(false);

	function signIn(nextUser: User): void {
		user = nextUser;
		isAuthenticated = true;
		isLoading = false;
		error = null;
		sessionUnverified = false;
		rememberUser(nextUser);
		setOfflineQueueOwner(nextUser.id);
	}

	function signOut(): void {
		user = null;
		isAuthenticated = false;
		isLoading = false;
		error = null;
		token = null;
		sessionUnverified = false;
		rememberUser(null);
		setOfflineQueueOwner(null);
	}

	return {
		get user() {
			return user;
		},
		get isAuthenticated() {
			return isAuthenticated;
		},
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get token() {
			return token;
		},
		get sessionUnverified() {
			return sessionUnverified;
		},
		get recheckingSession() {
			return recheckingSession;
		},

		async recheckSession() {
			if (recheckingSession) return;
			recheckingSession = true;
			try {
				await this.initialize();
			} finally {
				recheckingSession = false;
			}
		},

		setUser(newUser: User, newToken?: string) {
			signIn(newUser);
			if (newToken) token = newToken;
		},

		clearUser() {
			signOut();
		},

		setLoading(loading: boolean) {
			isLoading = loading;
		},

		setError(err: string | null) {
			error = err;
			isLoading = false;
		},

		async initialize() {
			if (!user) isLoading = true;
			try {
				const result = await apiClient.get<{
					user: User;
					session: { expiresAt: string };
				}>('/api/v1/auth/me');
				signIn(result.user);
			} catch (err) {
				const cached = isSignedOutResponse(err) ? null : (user ?? lastKnownUser());
				if (!cached) {
					signOut();
					return;
				}
				user = cached;
				isAuthenticated = true;
				isLoading = false;
				error = null;
				sessionUnverified = true;
				setOfflineQueueOwner(cached.id);
			}
		},

		async updateDisplayName(displayName: string) {
			const { authApi } = await import('#lib/services/auth-api.ts');
			const result = await authApi.updateProfile({ displayName });
			if (user) {
				user = { ...user, displayName: result.user.displayName };
				rememberUser(user);
			}
			return result.user;
		},

		loginWith(providerId: string) {
			if (browser) {
				window.location.href = `${getApiBaseUrl()}/api/v1/auth/login/${providerId}`;
			}
		},

		async refreshToken() {
			try {
				const data = await apiClient.post<{ token: string }>('/api/v1/auth/refresh');
				token = data.token;
				error = null;
				return data.token;
			} catch (err) {
				signOut();
				error = extractErrorMessage(err, 'Token refresh failed');
				throw err;
			}
		},

		async logout() {
			try {
				await apiClient.post('/api/v1/auth/logout');
				const signedOutUserId = user?.id ?? null;
				signOut();
				clearOfflineCaches(signedOutUserId);

				// Import appStore dynamically to avoid circular dependency
				const { appStore } = await import('./app.svelte');
				appStore.reset();
			} catch (err) {
				error = extractErrorMessage(err, 'Logout failed');
			}
		}
	};
}

export const authStore = createAuthStore();
