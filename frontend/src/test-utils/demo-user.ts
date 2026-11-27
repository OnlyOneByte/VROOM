import { authStore } from '#lib/stores/auth.svelte.ts';

export function signInAsDemo(): () => void {
	authStore.setUser({
		id: 'demo-garage',
		email: 'demo@example.com',
		displayName: 'Demo',
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		demo: true
	});
	return () => authStore.clearUser();
}
