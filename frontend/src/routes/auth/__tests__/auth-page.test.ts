import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { ApiError } from '#lib/utils/error-handling.ts';

const { page, authApi } = vi.hoisted(() => ({
	page: { url: new URL('https://app.example/auth') },
	authApi: {
		getProviders: vi.fn<() => Promise<{ id: string; displayName: string }[]>>(),
		getSignupInfo: vi.fn<() => Promise<{ mode: string; domainRestricted: boolean }>>()
	}
}));

vi.mock('$app/state', () => ({ page }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('#lib/services/auth-api.ts', () => ({ authApi }));

const AuthPage = (await import('../+page.svelte')).default;

beforeEach(() => {
	vi.clearAllMocks();
	authApi.getSignupInfo.mockResolvedValue({ mode: 'invite', domainRestricted: false });
});

afterEach(() => {
	page.url = new URL('https://app.example/auth');
});

async function signupInfoSettled() {
	await waitFor(() => expect(authApi.getSignupInfo).toHaveBeenCalled());
	await Promise.allSettled(authApi.getSignupInfo.mock.results.map(r => r.value));
	await tick();
}

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
		['signup_closed', 'This server isn’t taking new accounts'],
		['signup_invite_required', 'This server is invite only'],
		['signup_domain_not_allowed', 'only takes accounts from certain email domains'],
		['provider_error', 'The sign-in provider refused the request']
	])('a refused sign-in (%s) says why', async (code, message) => {
		authApi.getProviders.mockResolvedValue([]);
		page.url = new URL(`https://app.example/auth?auth_error=${code}`);
		render(AuthPage);
		expect(await screen.findByRole('alert')).toHaveTextContent(message);
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

	test.each([
		['open', false, 'New here? Signing in creates your garage.'],
		['open', true, 'New here? Signing in with an allowed email creates your garage.'],
		[
			'approval',
			false,
			'New here? Sign in to ask for an account. An admin approves it first, unless they invited you.'
		],
		[
			'invite',
			false,
			'New here? You need an invite, from this server’s admin or from someone who wants to share a vehicle with you.'
		],
		['closed', false, 'This server isn’t taking new accounts.']
	])(
		'the new-here line follows the %s mode (domains limited: %s)',
		async (mode, domainRestricted, line) => {
			authApi.getProviders.mockResolvedValue([{ id: 'google', displayName: 'Google' }]);
			authApi.getSignupInfo.mockResolvedValue({ mode, domainRestricted });
			render(AuthPage);
			expect(await screen.findByTestId('signup-mode-line')).toHaveTextContent(line);
		}
	);

	test('when the sign-up mode cannot load, the page makes no promise about new accounts', async () => {
		authApi.getProviders.mockResolvedValue([{ id: 'google', displayName: 'Google' }]);
		authApi.getSignupInfo.mockRejectedValue(new ApiError('Network error', 0));
		render(AuthPage);
		await screen.findByRole('button', { name: 'Continue with Google' });
		await signupInfoSettled();
		expect(screen.queryByTestId('signup-mode-line')).not.toBeInTheDocument();
		expect(screen.queryByText(/New here/)).not.toBeInTheDocument();
	});

	test('a sign-up refusal is said once: the new-here line steps aside for the alert', async () => {
		page.url = new URL('https://app.example/auth?auth_error=signup_invite_required');
		authApi.getProviders.mockResolvedValue([{ id: 'google', displayName: 'Google' }]);
		render(AuthPage);
		await screen.findByRole('button', { name: 'Continue with Google' });
		expect(screen.getByRole('alert')).toHaveTextContent('This server is invite only');
		await signupInfoSettled();
		expect(screen.queryByTestId('signup-mode-line')).not.toBeInTheDocument();
	});

	test('a sign-up code with no message shows no alert, so the new-here line stays', async () => {
		page.url = new URL('https://app.example/auth?auth_error=signup_something_new');
		authApi.getProviders.mockResolvedValue([{ id: 'google', displayName: 'Google' }]);
		render(AuthPage);
		expect(await screen.findByTestId('signup-mode-line')).toBeInTheDocument();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	test('the invite-only refusal names both kinds of invite', async () => {
		page.url = new URL('https://app.example/auth?auth_error=signup_invite_required');
		authApi.getProviders.mockResolvedValue([]);
		render(AuthPage);
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Ask its admin for an invite, or someone who wants to share a vehicle with you.'
		);
	});

	test('a non-sign-up error keeps the new-here line', async () => {
		page.url = new URL('https://app.example/auth?auth_error=cancelled');
		authApi.getProviders.mockResolvedValue([{ id: 'google', displayName: 'Google' }]);
		render(AuthPage);
		expect(await screen.findByTestId('signup-mode-line')).toBeInTheDocument();
	});

	test('with no sign-in options, or while they fail to load, there is no new-here line', async () => {
		authApi.getProviders.mockResolvedValueOnce([]);
		const { unmount } = render(AuthPage);
		await screen.findByText('Sign-in is currently unavailable. No providers are enabled.');
		await signupInfoSettled();
		expect(screen.queryByTestId('signup-mode-line')).not.toBeInTheDocument();
		unmount();

		authApi.getProviders.mockRejectedValueOnce(new ApiError('Network error', 0));
		render(AuthPage);
		await screen.findByRole('button', { name: 'Retry' });
		await signupInfoSettled();
		expect(screen.queryByTestId('signup-mode-line')).not.toBeInTheDocument();
	});

	test.each([
		'invalid_state',
		'email_exists',
		'provider_unavailable',
		'no_email',
		'unknown_provider',
		'cancelled',
		'signup_closed',
		'signup_invite_required',
		'signup_domain_not_allowed'
	])('the %s message uses curly apostrophes', async code => {
		page.url = new URL(`https://app.example/auth?auth_error=${code}`);
		authApi.getProviders.mockResolvedValue([]);
		render(AuthPage);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent?.trim()).not.toBe('');
		expect(alert.textContent).not.toContain("'");
	});
});
