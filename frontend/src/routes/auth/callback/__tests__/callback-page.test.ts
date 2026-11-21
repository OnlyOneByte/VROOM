import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

const { page, authStore } = vi.hoisted(() => ({
	page: { url: new URL('https://app.example/auth/callback') },
	authStore: {
		isLoading: true,
		isAuthenticated: false,
		error: null as string | null,
		initialize: vi.fn<() => Promise<void>>()
	}
}));

vi.mock('$app/state', () => ({ page }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/stores/auth.svelte.ts', () => ({ authStore }));

const CallbackPage = (await import('../+page.svelte')).default;

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mountAt(search: string) {
	page.url = new URL(`https://app.example/auth/callback${search}`);
	render(CallbackPage);
	await settle();
}

beforeEach(() => {
	authStore.isLoading = true;
	authStore.isAuthenticated = false;
	authStore.error = null;
	authStore.initialize.mockReset();
});
afterEach(() => cleanup());

describe('sign-in callback errors', () => {
	test('a provider error shows a plain sentence, not the provider code', async () => {
		await mountAt('?error=access_denied');
		expect(
			screen.getByText('Sign-in was cancelled or declined. Please try again.')
		).toBeInTheDocument();
		expect(screen.queryByText(/access_denied|OAuth error/)).toBeNull();
	});

	test('a missing code shows a plain sentence', async () => {
		await mountAt('');
		expect(screen.getByText('Sign-in didn’t finish. Please try again.')).toBeInTheDocument();
		expect(screen.queryByText(/authorization code/)).toBeNull();
	});

	test('a failed session check never shows the server text', async () => {
		authStore.initialize.mockRejectedValue(new Error('Request failed with status 500'));
		await mountAt('?code=abc');
		expect(screen.getByText('We couldn’t sign you in. Please try again.')).toBeInTheDocument();
		expect(screen.queryByText(/status 500/)).toBeNull();
	});
});
