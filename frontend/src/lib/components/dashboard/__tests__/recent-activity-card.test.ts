import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import RecentActivityCard from '../RecentActivityCard.svelte';
import type { ExpenseCategory } from '#lib/types/index.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

interface RecentExpense {
	id: string;
	amount: number;
	category: ExpenseCategory;
	date: Date;
	description?: string | null;
	location?: string | null;
	vehicleName?: string;
}

const ARCO: RecentExpense = {
	id: 'e1',
	amount: 28.99,
	category: 'fuel',
	date: new Date(2026, 10, 20, 12),
	description: 'Arco',
	vehicleName: 'Weekend Car'
};

function rows(): string[] {
	return screen
		.getAllByRole('listitem')
		.map(item => item.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

describe('RecentActivityCard', () => {
	test('leads each row with the merchant, then category, vehicle and date, with the amount last', () => {
		render(RecentActivityCard, { props: { expenses: [ARCO] } });

		const [row] = screen.getAllByRole('listitem');
		expect(within(row!).getByText('Arco')).toHaveClass('font-medium');
		expect(rows()).toEqual(['Arco Fuel & charging · Weekend Car · Nov 20 $28.99']);
	});

	test('falls back to the location, then the category, when there is no description', () => {
		render(RecentActivityCard, {
			props: {
				expenses: [
					{ ...ARCO, id: 'e2', description: null, location: 'Shell, Main St' },
					{ ...ARCO, id: 'e3', description: '  ', location: null, category: 'misc' }
				]
			}
		});

		expect(rows()[0]).toMatch(/^Shell, Main St Fuel & charging/);
		expect(rows()[1]).toMatch(/^Misc Weekend Car · Nov 20/);
	});

	test('the rows are one divided list, not a card each', () => {
		render(RecentActivityCard, { props: { expenses: [ARCO, { ...ARCO, id: 'e2' }] } });
		const list = screen.getByRole('list');
		expect(list).toHaveClass('divide-y');
		expect(list.querySelector('.border.rounded-lg')).toBeNull();
	});

	test('All expenses links to the expenses page and names where it goes', () => {
		render(RecentActivityCard, { props: { expenses: [ARCO] } });
		expect(screen.getByRole('link', { name: 'All expenses' })).toHaveAttribute('href', '/expenses');
	});

	test('with no expenses it says so, under one card heading', () => {
		render(RecentActivityCard, { props: { expenses: [] } });
		expect(screen.getByRole('heading', { level: 2, name: 'Recent' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { level: 3, name: 'No expenses yet' })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'All expenses' })).toBeNull();
	});

	test('on a vehicle page it drops the vehicle name, and See all with the count runs its handler', async () => {
		const onSeeAll = vi.fn();
		render(RecentActivityCard, {
			props: {
				title: 'Recent expenses',
				expenses: [{ ...ARCO, vehicleName: undefined }],
				totalCount: 61,
				onSeeAll
			}
		});

		expect(screen.getByRole('heading', { name: 'Recent expenses' })).toBeInTheDocument();
		expect(rows()).toEqual(['Arco Fuel & charging · Nov 20 $28.99']);
		const seeAll = screen.getByRole('button', { name: 'See all 61 expenses' });
		await fireEvent.click(seeAll);
		expect(onSeeAll).toHaveBeenCalledOnce();
	});
});
