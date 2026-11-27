import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const LegalPage = (await import('../LegalPage.svelte')).default;

const body = createRawSnippet(() => ({ render: () => '<p>Body text</p>' }));

afterEach(cleanup);

describe('LegalPage', () => {
	test('shows the title, a way home and the body', () => {
		render(LegalPage, {
			props: { title: 'Privacy Policy', updated: 'November 2026', children: body }
		});

		expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
		expect(screen.getByText('Body text')).toBeInTheDocument();
	});

	test('the "Last updated" date is never hidden, even on short phone screens', () => {
		render(LegalPage, {
			props: { title: 'Terms of Service', updated: 'March 2026', children: body }
		});

		const date = screen.getByText('Last updated: March 2026');
		expect(date.className).not.toMatch(/hidden/);
	});
});
