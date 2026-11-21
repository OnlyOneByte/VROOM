import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { ApiError } from '#lib/utils/error-handling.ts';

const { page, authApi } = vi.hoisted(() => ({
	page: { url: new URL('https://app.example/auth') },
	authApi: { getProviders: vi.fn<() => Promise<{ id: string; displayName: string }[]>>() }
}));

vi.mock('$app/state', () => ({ page }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('#lib/services/auth-api.ts', () => ({ authApi }));

const AuthPage = (await import('../+page.svelte')).default;

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
	});
});
