import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { ApiError } from '#lib/utils/error-handling.ts';

const { authApi, authStore, showError } = vi.hoisted(() => ({
	authApi: {
		isDemoAvailable: vi.fn<() => Promise<boolean>>(),
		startDemo: vi.fn<() => Promise<unknown>>()
	},
	authStore: {
		isLoading: false,
		isAuthenticated: false,
		initialize: vi.fn(() => Promise.resolve())
	},
	showError: vi.fn<(message: string) => void>()
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/auth-api.ts', () => ({ authApi }));
vi.mock('#lib/stores/auth.svelte.ts', () => ({ authStore }));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { showError } }));

const Page = (await import('../+page.svelte')).default;

beforeEach(() => {
	vi.clearAllMocks();
	authApi.isDemoAvailable.mockResolvedValue(false);
	authApi.startDemo.mockResolvedValue({ session: { expiresAt: '2026-12-01T00:00:00Z' } });
});

describe('landing page', () => {
	test('leads with what the car really costs, on the real dial', () => {
		render(Page);

		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
			'What your car really costs.'
		);
		expect(
			screen.getByRole('img', { name: /true cost per mile, all in: 58¢/ })
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/auth');
	});

	test('names three things VROOM does', () => {
		render(Page);

		expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent?.trim())).toEqual([
			'Ten-second logging',
			'Never miss a service',
			'Your storage, your data'
		]);
	});

	test('the copy does not assume a particular sign-in or storage provider', () => {
		const { container } = render(Page);

		expect(container.textContent).not.toMatch(/google|drive\b|s3\b/i);
	});

	test('offers no demo garage when the server has it turned off', async () => {
		render(Page);

		await waitFor(() => expect(authApi.isDemoAvailable).toHaveBeenCalled());
		expect(screen.queryByRole('button', { name: 'See a demo garage' })).not.toBeInTheDocument();
	});

	test('opens the demo garage when the server offers one', async () => {
		authApi.isDemoAvailable.mockResolvedValue(true);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'See a demo garage' }));

		await waitFor(() => expect(authStore.initialize).toHaveBeenCalled());
		expect(authApi.startDemo).toHaveBeenCalledTimes(1);
		expect(showError).not.toHaveBeenCalled();
	});

	test('says so when the demo garage cannot open', async () => {
		authApi.isDemoAvailable.mockResolvedValue(true);
		authApi.startDemo.mockRejectedValue(new ApiError('Too many requests', 429));
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'See a demo garage' }));

		await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
		expect(showError.mock.calls[0]?.[0]).toMatch(/^Couldn't open the demo garage\./);
		expect(authStore.initialize).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'See a demo garage' })).toBeEnabled();
	});

	test('the footer links are 40px tap targets', () => {
		render(Page);

		for (const name of ['Privacy Policy', 'Terms of Service']) {
			expect(screen.getByRole('link', { name })).toHaveClass('min-h-10');
		}
	});
});
