export interface User {
	id: string;
	email: string;
	displayName: string;
	createdAt: string;
	updatedAt: string;
}

export interface AuthUser {
	id: string;
	email: string;
	displayName: string;
}

export interface AuthState {
	user: User | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	error: string | null;
	token: string | null;
}
