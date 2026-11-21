import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, test } from 'vitest';
import { CardTitle } from '../index';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('Card.Title level', () => {
	test('without a level it stays a plain div, so it adds no heading', () => {
		render(CardTitle, { children: text('Readings') });
		expect(screen.queryByRole('heading')).toBeNull();
	});

	test.each([2, 3, 4] as const)(
		'level %i renders that heading with the card title styles',
		level => {
			render(CardTitle, { level, children: text('Your Fleet') });
			const heading = screen.getByRole('heading', { level, name: 'Your Fleet' });
			expect(heading).toHaveAttribute('data-slot', 'card-title');
			expect(heading).toHaveClass('font-semibold', 'leading-none');
		}
	);
});
