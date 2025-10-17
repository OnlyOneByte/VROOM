import { writable } from 'svelte/store';
import type { User, AuthState } from '../types/index.js';

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
				const response = await fetch('/api/auth/me', {
					credentials: 'include'
				});

				if (response.ok) {
					const user = await response.json();
					update(state => ({
						...state,
						user,
						isAuthenticated: true,
						isLoading: false,
						error: null
					}));
				} else {
					update(state => ({
						...state,
						user: null,
						isAuthenticated: false,
						isLoading: false,
						error: null
					}));
				}
			} catch (error) {
				update(state => ({
					...state,
					user: null,
					isAuthenticated: false,
					isLoading: false,
					error: error instanceof Error ? error.message : 'Authentication failed'
				}));
			}
		},

		// Login with Google OAuth
		loginWithGoogle: () => {
			window.location.href = '/api/auth/login/google';
		},

		// Refresh token
		refreshToken: async () => {
			try {
				const response = await fetch('/api/auth/refresh', {
					method: 'POST',
					credentials: 'include'
				});

				if (response.ok) {
					const data = await response.json();
					update(state => ({
						...state,
						token: data.token,
						error: null
					}));
					return data.token;
				} else {
					throw new Error('Token refresh failed');
				}
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
				await fetch('/api/auth/logout', {
					method: 'POST',
					credentials: 'include'
				});

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
