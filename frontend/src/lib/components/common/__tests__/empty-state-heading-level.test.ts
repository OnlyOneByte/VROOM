import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import EmptyState from '../empty-state.svelte';

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

	test('centres its title like its description, so a wrapped title stays under the icon', () => {
		const { getByRole } = render(EmptyState, {
			title: text('No fill-ups in the last 12 months'),
			description: text('Log a fill-up to see your fuel stats.')
		});

		expect(getByRole('heading', { name: 'No fill-ups in the last 12 months' })).toHaveClass(
			'text-center'
		);
	});

	test.each([3, 4] as const)('takes level %i when it sits under a section heading', level => {
		const { getByRole } = render(EmptyState, {
			title: text('No recent activity'),
			description: text('Log an expense to see it here.'),
			level
		});

		expect(getByRole('heading', { name: 'No recent activity' }).tagName).toBe(`H${level}`);
	});
});
