export interface User {
	id: string;
	email: string;
	displayName: string;
	createdAt: string;
	updatedAt: string;
}

export interface LinkedAuthProvider {
	id: string;
	providerType: string;
	displayName: string;
	email: string;
	avatarUrl?: string;
	createdAt: string;
}
