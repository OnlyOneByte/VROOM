import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ChartCard from '../ChartCard.svelte';

const chart = createRawSnippet(() => ({ render: () => '<div>chart</div>' }));

describe('ChartCard title is a heading', () => {
	test('it is an h2 by default', () => {
		render(ChartCard, { title: 'Expense Trends', children: chart });

		expect(screen.getByRole('heading', { level: 2, name: 'Expense Trends' })).toBeInTheDocument();
	});

	test.each([3, 4] as const)('a chart inside a section can be an h%s', level => {
		render(ChartCard, { title: 'Loan Payment Breakdown', level, children: chart });

		expect(
			screen.getByRole('heading', { level, name: 'Loan Payment Breakdown' })
		).toBeInTheDocument();
	});
});
