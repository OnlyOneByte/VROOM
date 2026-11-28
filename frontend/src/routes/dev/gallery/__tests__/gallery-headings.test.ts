import { render } from '@testing-library/svelte';
import { describe, expect, test, vi } from 'vitest';
import GalleryPage from '../+page.svelte';

vi.mock('$app/env', () => ({ browser: true, dev: true }));

describe('the component gallery', () => {
	test('has one h1, its own title', () => {
		const { container } = render(GalleryPage);
		const titles = [...container.querySelectorAll('h1')].map(h => h.textContent?.trim());

		expect(titles).toEqual(['Component gallery']);
	});

	test('shows the shared How it works disclosure, closed', () => {
		const { container } = render(GalleryPage);
		const details = container.querySelector(
			'[data-slot="how-it-works"]'
		) as HTMLDetailsElement | null;
		expect(details?.open).toBe(false);
		expect(details?.querySelector('summary')).toHaveTextContent('How it works');
	});
});
