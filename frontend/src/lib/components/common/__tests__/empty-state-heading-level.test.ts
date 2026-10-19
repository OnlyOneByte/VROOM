/**
 * EmptyState is a top-level region of whatever page renders it, so its title sits directly under
 * that page's `h1`. It used to render an `h3`, which skips `h2` — an axe `heading-order` failure
 * on every route that shows an empty state (/reminders and /vehicles/[id] among them) and a
 * screen-reader outline with a hole in it.
 *
 * The level is asserted through the heading ROLE, so the guard reads what assistive tech reads
 * rather than a class string.
 */

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
