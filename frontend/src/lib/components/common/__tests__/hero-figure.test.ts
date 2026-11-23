import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import HeroFigure from '../hero-figure.svelte';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('HeroFigure', () => {
	test('shows the label, then the figure at hero size with aligned digits', () => {
		render(HeroFigure, { props: { label: 'Spent in the last 30 days', value: '$624.04' } });
		const figure = screen.getByText('$624.04');
		expect(screen.getByText('Spent in the last 30 days')).toHaveClass('text-muted-foreground');
		for (const name of ['text-4xl', 'lg:text-5xl', 'font-bold', 'tabular-nums']) {
			expect(figure).toHaveClass(name);
		}
	});

	test('renders the comparison line and the action only when given', () => {
		const { container } = render(HeroFigure, {
			props: {
				label: 'Spent',
				value: '$1',
				meta: text('6% less than the 30 days before'),
				action: text('30 days')
			}
		});
		expect(screen.getByText('6% less than the 30 days before').parentElement).toHaveClass(
			'text-xs'
		);
		expect(screen.getByText('30 days')).toBeInTheDocument();
		expect(container.querySelectorAll('[data-slot="hero-figure"] > div')).toHaveLength(2);
	});

	test('with no comparison there is no empty meta line', () => {
		const { container } = render(HeroFigure, { props: { label: 'Spent', value: '$1' } });
		expect(container.querySelectorAll('[data-slot="hero-figure"] > div')).toHaveLength(1);
	});
});
