import { writable } from 'svelte/store';
import type { User } from '../types/auth.js';

interface AuthState {
	user: User | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	error: string | null;
}

const initialState: AuthState = {
	user: null,
	isAuthenticated: false,
	isLoading: true,
	error: null
};

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>(initialState);

	return {
		subscribe,
		
		// Set user after successful authentication
		setUser: (user: User) => {
			update(state => ({
				...state,
				user,
				isAuthenticated: true,
				isLoading: false,
				error: null
			}));
		},
		
		// Clear user on logout
		clearUser: () => {
			update(state => ({
				...state,
				user: null,
				isAuthenticated: false,
				isLoading: false,
				error: null
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
					error: null
				}));
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