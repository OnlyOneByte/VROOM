import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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

global.fetch = vi.fn(
	async () =>
		new Response(
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
const pageContent = createRawSnippet(() => ({ render: () => '<p>Page content</p>' }));

describe('a waiting account whose waiting page fails to load', () => {
	it('says so, offers a reload and a way to sign out, and shows no app', async () => {
		render(Layout, { children: pageContent });

		expect(await screen.findByText("Couldn't load this page")).toBeVisible();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
		expect(screen.queryByText('Page content')).toBeNull();
		expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
	});
});
