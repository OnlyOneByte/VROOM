import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, test } from 'vitest';
import { Card } from '../index';

const body = createRawSnippet(() => ({ render: () => '<p>Body</p>' }));

describe('Card variant', () => {
	test('the default card has the surface fill and the C3 card radius', () => {
		const { container } = render(Card, { children: body });
		const card = container.querySelector('[data-slot="card"]');
		expect(card).toHaveAttribute('data-variant', 'default');
		expect(card).toHaveClass('bg-card', 'border', 'rounded-[var(--r-lg)]');
	});

	test('a section is a rule above with no fill, and its header and content sit flush', () => {
		const { container } = render(Card, { variant: 'section', children: body });
		const card = container.querySelector('[data-slot="card"]');
		expect(card).toHaveAttribute('data-variant', 'section');
		expect(card).toHaveClass('border-t', '[&>[data-slot^=card-]]:px-0');
		expect(card).not.toHaveClass('bg-card');
		expect(card?.className).not.toMatch(/\brounded-/);
	});
});
