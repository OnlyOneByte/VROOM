import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const Page = (await import('../+page.svelte')).default;

describe('landing page', () => {
	test('shows six feature cards, so the grid has no orphan', () => {
		render(Page);
		const features = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent?.trim());
		expect(features).toEqual([
			'Multi-Vehicle Tracking',
			'Cost Analytics',
			'Your Own Storage',
			'Privacy First',
			'Install as an App',
			'Open Source, Open Format'
		]);
	});

	test('the copy does not assume a particular sign-in or storage provider', () => {
		const { container } = render(Page);
		expect(container.textContent).not.toMatch(/google/i);
		expect(screen.getByText('Sign in to get started. No credit card required.')).toBeTruthy();
	});

	test('the product shot has a light and a dark variant with set dimensions', () => {
		render(Page);
		const shots = screen.getAllByRole('img', { name: /The VROOM Dashboard/ });
		expect(shots.map(img => img.getAttribute('src'))).toEqual([
			'/landing/dashboard-light.webp',
			'/landing/dashboard-dark.webp'
		]);
		for (const img of shots) {
			expect(img.getAttribute('width')).toBe('1280');
			expect(img.getAttribute('height')).toBe('1180');
		}
	});

	test('below sm each variant swaps in a phone-width capture with its own dimensions', () => {
		render(Page);
		const shots = screen.getAllByRole('img', { name: /The VROOM Dashboard/ });
		const sources = shots.map(img => img.closest('picture')?.querySelector('source'));
		expect(sources.map(source => source?.getAttribute('srcset'))).toEqual([
			'/landing/dashboard-phone-light.webp',
			'/landing/dashboard-phone-dark.webp'
		]);
		for (const source of sources) {
			expect(source?.getAttribute('media')).toBe('(max-width: 639px)');
			expect(source?.getAttribute('width')).toBe('750');
			expect(source?.getAttribute('height')).toBe('1360');
		}
	});

	test('the stacked footer links are 40px tap targets on phones', () => {
		render(Page);
		for (const name of ['Privacy Policy', 'Terms of Service']) {
			expect(screen.getByRole('link', { name })).toHaveClass('min-h-10');
		}
	});
});
