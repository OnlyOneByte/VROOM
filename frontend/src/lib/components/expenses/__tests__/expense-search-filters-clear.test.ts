import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ExpenseSearchFilters from '../ExpenseSearchFilters.svelte';
import type { Expense } from '#lib/types/index.ts';

function expense(id: string, tags: string[]): Expense {
	return {
		id,
		vehicleId: 'v1',
		userId: 'u1',
		tags,
		category: 'fuel',
		amount: 10,
		date: '2026-01-05T12:00:00.000Z',
		createdAt: '2026-01-05T12:00:00.000Z',
		updatedAt: '2026-01-05T12:00:00.000Z'
	};
}

const EXPENSES = [expense('e1', ['road-trip', 'tolls']), expense('e2', ['parking', 'tolls'])];

function renderFilters() {
	return render(ExpenseSearchFilters, {
		searchTerm: '',
		filters: {},
		expenses: EXPENSES,
		onSearchChange: vi.fn(),
		onClearFilters: vi.fn()
	});
}

async function selectTag(tag: string) {
	await fireEvent.focus(screen.getByLabelText('Search tags'));
	await fireEvent.click(screen.getByRole('button', { name: tag }));
}

describe('ExpenseSearchFilters: tags follow the filters the page applies', () => {
	test('clearing the filters from the page also clears the tag chips and the hint', async () => {
		const { rerender } = renderFilters();
		await selectTag('tolls');
		await selectTag('parking');
		expect(screen.getByRole('button', { name: 'Remove tag tolls' })).toBeInTheDocument();
		expect(screen.getByText('Matching all selected tags')).toBeInTheDocument();

		await rerender({ filters: {} });

		expect(screen.queryByRole('button', { name: 'Remove tag tolls' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove tag parking' })).toBeNull();
		expect(screen.queryByText('Matching all selected tags')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull();
	});

	test('tags the page sets are shown as chips', async () => {
		const { rerender } = renderFilters();

		await rerender({ filters: { tags: ['road-trip'] } });

		expect(screen.getByRole('button', { name: 'Remove tag road-trip' })).toBeInTheDocument();
	});
});
