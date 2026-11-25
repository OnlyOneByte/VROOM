import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { goto, authStore, showInfo } = vi.hoisted(() => ({
	goto: vi.fn(),
	showInfo: vi.fn(),
	authStore: {
		user: { email: 'kim@example.com', pendingApproval: true },
		recheckingSession: false,
		recheckSession: vi.fn(async () => undefined),
		logout: vi.fn(async () => undefined)
	}
}));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/stores/auth.svelte.ts', () => ({ authStore }));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showInfo, showError: vi.fn() }
}));

const AccountPending = (await import('../AccountPending.svelte')).default;

afterEach(cleanup);

describe('AccountPending', () => {
	test('names the waiting email, rechecks, and signs out to the sign-in page', async () => {
		render(AccountPending);
		expect(screen.getByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
		expect(screen.getByText('kim@example.com')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));
		await waitFor(() => expect(showInfo).toHaveBeenCalledWith('Still waiting for an admin.'));
		expect(authStore.recheckSession).toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/auth'));
		expect(authStore.logout).toHaveBeenCalled();
	});
});
