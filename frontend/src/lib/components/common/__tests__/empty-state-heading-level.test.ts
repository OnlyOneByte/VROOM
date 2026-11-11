// EmptyState's title is an h2, so it sits directly under the page's h1 and the heading outline has no gap.

import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import EmptyState from '../empty-state.svelte';

vi.mock('svelte', () => import('../../../../../node_modules/svelte/src/index-client.js' as string));

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('the shared empty state', () => {
	test('titles itself with a level-2 heading, so it cannot skip a level under a page h1', () => {
		const { getByRole } = render(EmptyState, {
			title: text('No reminders yet'),
			description: text('Add one to get started.')
		});

		const heading = getByRole('heading', { name: 'No reminders yet' });

		expect(heading.tagName).toBe('H2');
		expect(heading.getAttribute('aria-level')).toBeNull();
	});
});
