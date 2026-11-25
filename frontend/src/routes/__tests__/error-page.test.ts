import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const pageState = vi.hoisted(() => ({ status: 404 }));

vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const { default: ErrorPage } = await import('../+error.svelte');

describe('the app error page', () => {
	test('a missing page gets a titled h1, a document title and a way back to the dashboard', () => {
		pageState.status = 404;
		render(ErrorPage);

		expect(screen.getByRole('heading', { level: 1, name: 'Page Not Found' })).toBeInTheDocument();
		expect(document.title).toBe('Page Not Found - VROOM Car Tracker');
		const dashboardLink = screen.getByRole('link', { name: 'Go to Dashboard' });
		expect(dashboardLink).toHaveAttribute('href', '/dashboard');
		expect(dashboardLink).toHaveClass('h-10');
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	});

	test('a failed page offers a retry as well as the dashboard', () => {
		pageState.status = 500;
		render(ErrorPage);

		expect(screen.getByRole('heading', { level: 1, name: 'Page Unavailable' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toBeInTheDocument();
	});
});
