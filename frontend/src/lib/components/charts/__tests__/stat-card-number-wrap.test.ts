import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import StatCard from '../StatCard.svelte';

describe('StatCard keeps numbers whole', () => {
	test('dual values never break mid-number and the halves stack below sm', () => {
		const { container } = render(StatCard, {
			props: {
				label: 'Current Odometer',
				value: '25,850',
				unit: 'Kilometers',
				secondaryLabel: 'Distance Driven',
				secondaryValue: '850',
				secondaryUnit: 'lifetime'
			}
		});

		for (const text of ['25,850', '850']) {
			const value = screen.getByText(text, { exact: true });
			expect(value).toHaveClass('tabular-nums', 'whitespace-nowrap');
			expect(value).not.toHaveClass('break-words');
		}
		for (const text of ['Current Odometer', 'Distance Driven']) {
			expect(screen.getByText(text)).toHaveClass('break-words');
		}
		const halves = container.querySelector('[data-slot="card-content"] > div');
		expect(halves).toHaveClass('flex-col', 'sm:flex-row');
	});

	test('a single value uses tabular figures', () => {
		render(StatCard, { props: { label: 'Total Expenses', value: '$799.16' } });

		expect(screen.getByText('$799.16')).toHaveClass('tabular-nums');
	});
});
