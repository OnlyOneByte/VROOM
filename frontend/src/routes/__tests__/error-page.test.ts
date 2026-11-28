import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const pageState = vi.hoisted(() => ({ status: 404 }));

vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const { default: ErrorPage } = await import('../+error.svelte');

describe('the app error page', () => {
	test('a missing page says "Wrong turn", keeps its document title and offers the dashboard', () => {
		pageState.status = 404;
		render(ErrorPage);

		expect(screen.getByRole('heading', { level: 1, name: 'Wrong turn' })).toBeInTheDocument();
		expect(document.title).toBe('Page not found - VROOM Car Tracker');
		const dashboardLink = screen.getByRole('link', { name: 'Go to the dashboard' });
		expect(dashboardLink).toHaveAttribute('href', '/dashboard');
		expect(dashboardLink).toHaveClass('h-10');
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	});

	test('a failed page offers a retry as well as the dashboard', () => {
		pageState.status = 500;
		render(ErrorPage);

		expect(
			screen.getByRole('heading', { level: 1, name: "This page couldn't load" })
		).toBeInTheDocument();
		expect(document.title).toBe('Page unavailable - VROOM Car Tracker');
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toBeInTheDocument();
	});
});
