import { render } from '@testing-library/svelte';
import { describe, expect, test, vi } from 'vitest';
import GalleryPage from '../+page.svelte';

vi.mock('$app/env', () => ({ browser: true, dev: true }));

describe('the component gallery', () => {
	test('has one h1, its own title', () => {
		const { container } = render(GalleryPage);
		const titles = [...container.querySelectorAll('h1')].map(h => h.textContent?.trim());

		expect(titles).toEqual(['Component Gallery']);
	});
});
