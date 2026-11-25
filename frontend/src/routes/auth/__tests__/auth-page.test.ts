import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { ApiError } from '#lib/utils/error-handling.ts';

const { page, authApi } = vi.hoisted(() => ({
	page: { url: new URL('https://app.example/auth') },
	authApi: { getProviders: vi.fn<() => Promise<{ id: string; displayName: string }[]>>() }
}));

vi.mock('$app/state', () => ({ page }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('#lib/services/auth-api.ts', () => ({ authApi }));

const AuthPage = (await import('../+page.svelte')).default;

afterEach(() => {
	page.url = new URL('https://app.example/auth');
});

describe('sign-in page', () => {
	test('a providers load failure offers a 40px Retry that loads the sign-in options', async () => {
		authApi.getProviders
			.mockRejectedValueOnce(new ApiError('Network error', 0))
			.mockResolvedValueOnce([{ id: 'google', displayName: 'Google' }]);
		render(AuthPage);

		const retry = await screen.findByRole('button', { name: 'Retry' });
		expect(screen.getByText(/Couldn't load the sign-in options/)).toBeInTheDocument();
		expect(retry.className).toMatch(/(^|\s)h-10(\s|$)/);

		await fireEvent.click(retry);

		expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
		expect(authApi.getProviders).toHaveBeenCalledTimes(2);
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Continue with Google' })).toHaveFocus()
		);
	});

	test('a failed Retry announces the error and keeps focus on the new Retry', async () => {
		authApi.getProviders.mockRejectedValue(new ApiError('Network error', 0));
		render(AuthPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus());
		expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the sign-in options");
	});

	test('a returning sign-in error shows its title and what to do, as an alert', async () => {
		page.url = new URL('https://app.example/auth?auth_error=cancelled');
		authApi.getProviders.mockResolvedValue([{ id: 'google', displayName: 'Google' }]);
		render(AuthPage);

		const alert = screen.getByRole('alert');
		expect(alert).toHaveTextContent('Sign-in was cancelled');
		expect(alert).toHaveTextContent('Try again, or pick another option.');
		expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeEnabled();
	});

	test('an unknown sign-in error code shows no error card', async () => {
		page.url = new URL('https://app.example/auth?auth_error=something_new');
		authApi.getProviders.mockResolvedValue([{ id: 'google', displayName: 'Google' }]);
		render(AuthPage);

		await screen.findByRole('button', { name: 'Continue with Google' });
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	test.each([
		['signup_closed', "This server isn't taking new accounts"],
		['signup_invite_required', 'This server is invite only'],
		['signup_domain_not_allowed', 'only takes accounts from certain email domains']
	])('a refused sign-up (%s) says why', async (code, message) => {
		authApi.getProviders.mockResolvedValue([]);
		page.url = new URL(`https://app.example/auth?auth_error=${code}`);
		render(AuthPage);
		expect(await screen.findByRole('alert')).toHaveTextContent(message);
		page.url = new URL('https://app.example/auth');
	});

	test('a Retry that finds no enabled providers announces that sign-in is unavailable', async () => {
		authApi.getProviders
			.mockRejectedValueOnce(new ApiError('Network error', 0))
			.mockResolvedValueOnce([]);
		render(AuthPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

		expect(await screen.findByRole('status')).toHaveTextContent(
			'Sign-in is currently unavailable. No providers are enabled.'
		);
	});
});
