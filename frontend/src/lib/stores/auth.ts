import { writable } from 'svelte/store';
import type { User, AuthState } from '../types/index.js';
import { apiClient, getApiBaseUrl } from '$lib/services/api-client';

const initialState: AuthState = {
	user: null,
	isAuthenticated: false,
	isLoading: true,
	error: null,
	token: null
};

function createAuthStore() {
	const { subscribe, update } = writable<AuthState>(initialState);

	return {
		subscribe,

		// Set user after successful authentication
		setUser: (user: User, token?: string) => {
			update(state => ({
				...state,
				user,
				isAuthenticated: true,
				isLoading: false,
				error: null,
				token: token || state.token
			}));
		},

		// Clear user on logout
		clearUser: () => {
			update(state => ({
				...state,
				user: null,
				isAuthenticated: false,
				isLoading: false,
				error: null,
				token: null
			}));
		},

		// Set loading state
		setLoading: (isLoading: boolean) => {
			update(state => ({
				...state,
				isLoading
			}));
		},

		// Set error state
		setError: (error: string | null) => {
			update(state => ({
				...state,
				error,
				isLoading: false
			}));
		},

		// Initialize auth state (check for existing session)
		initialize: async () => {
			update(state => ({ ...state, isLoading: true }));

			try {
				const user = await apiClient.get<User>('/api/v1/auth/me');
				update(state => ({
					...state,
					user,
					isAuthenticated: true,
					isLoading: false,
					error: null
				}));
			} catch {
				update(state => ({
					...state,
					user: null,
					isAuthenticated: false,
					isLoading: false,
					error: null
				}));
			}
		},

		// Login with Google OAuth
		loginWithGoogle: () => {
			window.location.href = `${getApiBaseUrl()}/api/v1/auth/login/google`;
		},

		// Refresh token
		refreshToken: async () => {
			try {
				const data = await apiClient.post<{ token: string }>('/api/v1/auth/refresh');
				update(state => ({
					...state,
					token: data.token,
					error: null
				}));
				return data.token;
			} catch (error) {
				update(state => ({
					...state,
					user: null,
					isAuthenticated: false,
					token: null,
					error: error instanceof Error ? error.message : 'Token refresh failed'
				}));
				throw error;
			}
		},

		// Logout
		logout: async () => {
			try {
				await apiClient.post('/api/v1/auth/logout');

				update(state => ({
					...state,
					user: null,
					isAuthenticated: false,
					isLoading: false,
					error: null,
					token: null
				}));

				// Import appStore dynamically to avoid circular dependency
				const { appStore } = await import('./app.js');
				appStore.reset();
			} catch (error) {
				update(state => ({
					...state,
					error: error instanceof Error ? error.message : 'Logout failed'
				}));
			}
		}
	};
}

export const authStore = createAuthStore();
