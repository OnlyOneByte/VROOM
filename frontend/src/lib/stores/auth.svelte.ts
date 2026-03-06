import type { User } from '../types/index.js';
import { apiClient, getApiBaseUrl } from '$lib/services/api-client';
import { browser } from '$app/environment';

function createAuthStore() {
	let user = $state<User | null>(null);
	let isAuthenticated = $state(false);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let token = $state<string | null>(null);

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

		setUser(newUser: User, newToken?: string) {
			user = newUser;
			isAuthenticated = true;
			isLoading = false;
			error = null;
			if (newToken) token = newToken;
		},

		clearUser() {
			user = null;
			isAuthenticated = false;
			isLoading = false;
			error = null;
			token = null;
		},

		setLoading(loading: boolean) {
			isLoading = loading;
		},

		setError(err: string | null) {
			error = err;
			isLoading = false;
		},

		async initialize() {
			isLoading = true;
			try {
				const result = await apiClient.get<User>('/api/v1/auth/me');
				user = result;
				isAuthenticated = true;
				isLoading = false;
				error = null;
			} catch {
				user = null;
				isAuthenticated = false;
				isLoading = false;
				error = null;
			}
		},

		loginWithGoogle() {
			if (browser) {
				window.location.href = `${getApiBaseUrl()}/api/v1/auth/login/google`;
			}
		},

		async refreshToken() {
			try {
				const data = await apiClient.post<{ token: string }>('/api/v1/auth/refresh');
				token = data.token;
				error = null;
				return data.token;
			} catch (err) {
				user = null;
				isAuthenticated = false;
				token = null;
				error = err instanceof Error ? err.message : 'Token refresh failed';
				throw err;
			}
		},

		async logout() {
			try {
				await apiClient.post('/api/v1/auth/logout');
				user = null;
				isAuthenticated = false;
				isLoading = false;
				error = null;
				token = null;

				// Import appStore dynamically to avoid circular dependency
				const { appStore } = await import('./app.svelte');
				appStore.reset();
			} catch (err) {
				error = err instanceof Error ? err.message : 'Logout failed';
			}
		}
	};
}

export const authStore = createAuthStore();
