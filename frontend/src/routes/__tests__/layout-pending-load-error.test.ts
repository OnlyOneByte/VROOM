import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

vi.mock('$app/state', () => ({
	get page() {
		return { url: new URL('http://localhost/dashboard') };
	}
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn()
}));
vi.mock('virtual:pwa-info', () => ({ pwaInfo: undefined }));
vi.mock('#lib/components/layout/AccountPending.svelte', () => {
	throw new Error('Failed to fetch dynamically imported module');
});

let logoutFails = false;

global.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
	String(input).includes('/auth/logout') && logoutFails
		? new Response(JSON.stringify({ success: false, error: { message: 'Server unavailable' } }), {
				status: 503,
				headers: { 'content-type': 'application/json' }
			})
		: new Response(
				JSON.stringify({
					success: true,
					data: {
						user: {
							id: 'kim',
							email: 'kim@example.com',
							displayName: 'Kim',
							createdAt: '2024-01-01T00:00:00Z',
							updatedAt: '2024-01-01T00:00:00Z'
						},
						session: { expiresAt: '2099-01-01' },
						pendingApproval: true
					}
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
);

const Layout = (await import('../+layout.svelte')).default;
const { appStore } = await import('#lib/stores/app.svelte.ts');

afterEach(() => {
	logoutFails = false;
	vi.restoreAllMocks();
});

function stubLocation() {
	const assign = vi.fn();
	vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location);
	return assign;
}
const pageContent = createRawSnippet(() => ({ render: () => '<p>Page content</p>' }));

describe('a waiting account whose waiting page fails to load', () => {
	it('says so, offers a reload and a way to sign out, and shows no app', async () => {
		render(Layout, { children: pageContent });

		expect(await screen.findByText("Couldn't load this page")).toBeVisible();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
		expect(screen.queryByText('Page content')).toBeNull();
		expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
	});

	it('a failed Sign out says so and stays on the page, with the button usable again', async () => {
		logoutFails = true;
		const assign = stubLocation();
		const showError = vi.spyOn(appStore, 'showError');
		render(Layout, { children: pageContent });

		await fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

		await waitFor(() =>
			expect(showError).toHaveBeenCalledWith(expect.stringMatching(/^Couldn’t sign out\./))
		);
		expect(assign).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
	});

	it('a Sign out that works goes to the sign-in page', async () => {
		const assign = stubLocation();
		render(Layout, { children: pageContent });

		await fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

		await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth'));
	});
});
