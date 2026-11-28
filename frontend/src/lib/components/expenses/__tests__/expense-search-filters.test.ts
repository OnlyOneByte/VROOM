import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import ExpenseSearchFilters from '../ExpenseSearchFilters.svelte';
import type { Expense, ExpenseFilters } from '#lib/types/index.ts';

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

const EXPENSES = [
	expense('e1', ['road-trip', 'tolls']),
	expense('e2', ['parking', 'tolls']),
	expense('e3', ['Commute'])
];

interface RenderOptions {
	searchTerm?: string;
	filters?: ExpenseFilters;
	category?: string;
	sort?: 'date-desc' | 'date-asc' | 'amount-desc';
}

function renderFilters(options: RenderOptions = {}) {
	const onSearchChange = vi.fn();
	const onCategoryChange = vi.fn();
	const onSortChange = vi.fn();
	const onClearFilters = vi.fn();
	render(ExpenseSearchFilters, {
		searchTerm: options.searchTerm ?? '',
		filters: options.filters ?? {},
		expenses: EXPENSES,
		category: options.category ?? '',
		sort: options.sort ?? 'date-desc',
		onSearchChange,
		onCategoryChange,
		onSortChange,
		onClearFilters
	});
	return { onSearchChange, onCategoryChange, onSortChange, onClearFilters };
}

function tagInput(): HTMLInputElement {
	return screen.getByLabelText('Search tags') as HTMLInputElement;
}

function suggestionButtons(): string[] {
	return screen.queryAllByRole('option').map(b => b.textContent?.trim() ?? '');
}

async function pickOption(trigger: HTMLElement, name: string): Promise<void> {
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

describe('ExpenseSearchFilters: search and clearing', () => {
	test('typing in the search box reports the new term', async () => {
		const { onSearchChange } = renderFilters();

		await fireEvent.input(screen.getByLabelText('Search expenses'), {
			target: { value: 'oil change' }
		});

		expect(onSearchChange).toHaveBeenCalledWith('oil change');
	});

	test('the clear button is hidden when no filter is active', () => {
		renderFilters();

		expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull();
	});

	test.each<[string, RenderOptions]>([
		['a search term', { searchTerm: 'oil' }],
		['a category', { category: 'fuel' }],
		['a start date', { filters: { startDate: '2026-01-01' } }],
		['an end date', { filters: { endDate: '2026-02-01' } }]
	])('the clear button appears for %s and calls onClearFilters', async (_label, options) => {
		const { onClearFilters } = renderFilters(options);

		await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));

		expect(onClearFilters).toHaveBeenCalledTimes(1);
	});
});

describe('ExpenseSearchFilters: tag picking', () => {
	test('focusing the tag box lists every unique tag from the expenses, sorted', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());

		expect(suggestionButtons()).toEqual(['Commute', 'parking', 'road-trip', 'tolls']);
	});

	test('typing narrows suggestions case-insensitively', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.input(tagInput(), { target: { value: 'COMM' } });

		expect(suggestionButtons()).toEqual(['Commute']);
	});

	test('clicking a suggestion selects it, removes it from suggestions and activates clearing', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.click(screen.getByRole('option', { name: 'tolls' }));

		expect(screen.getByRole('button', { name: 'Remove tag tolls' })).toBeInTheDocument();
		expect(suggestionButtons()).not.toContain('tolls');
		expect(tagInput().placeholder).toBe('Add more tags...');
		expect(screen.getByRole('button', { name: 'Clear Filters' })).toBeInTheDocument();
	});

	test('Enter selects an exact case-insensitive match over the first suggestion', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.input(tagInput(), { target: { value: 'TOLLS' } });
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });

		expect(screen.getByRole('button', { name: 'Remove tag tolls' })).toBeInTheDocument();
		expect(tagInput().value).toBe('');
	});

	test('Enter on a partial term selects the first matching suggestion', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.input(tagInput(), { target: { value: 'r' } });
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });

		expect(screen.getByRole('button', { name: 'Remove tag parking' })).toBeInTheDocument();
	});

	test('Enter with no matching tag selects nothing', async () => {
		renderFilters();

		await fireEvent.input(tagInput(), { target: { value: 'nope' } });
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });

		expect(screen.queryByRole('button', { name: /^Remove tag/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull();
	});

	test('Backspace in an empty box removes the most recently selected tag', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.click(screen.getByRole('option', { name: 'tolls' }));
		await fireEvent.click(screen.getByRole('option', { name: 'parking' }));
		await fireEvent.keyDown(tagInput(), { key: 'Backspace' });

		expect(screen.queryByRole('button', { name: 'Remove tag parking' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Remove tag tolls' })).toBeInTheDocument();
	});

	test('Backspace with text in the box keeps the selected tags', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.click(screen.getByRole('option', { name: 'tolls' }));
		await fireEvent.input(tagInput(), { target: { value: 'pa' } });
		await fireEvent.keyDown(tagInput(), { key: 'Backspace' });

		expect(screen.getByRole('button', { name: 'Remove tag tolls' })).toBeInTheDocument();
	});

	test('Escape hides the suggestion list', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		expect(suggestionButtons()).not.toHaveLength(0);

		await fireEvent.keyDown(tagInput(), { key: 'Escape' });

		expect(suggestionButtons()).toHaveLength(0);
	});

	test('removing the only tag clears the active-filter state', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.click(screen.getByRole('option', { name: 'tolls' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove tag tolls' }));

		expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull();
		expect(tagInput().placeholder).toBe('Search and add tags...');
	});

	test('offers no Any/All switch and says every selected tag must match', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.click(screen.getByRole('option', { name: 'tolls' }));
		expect(screen.queryByText('Matching all selected tags')).toBeNull();

		await fireEvent.click(screen.getByRole('option', { name: 'parking' }));
		expect(screen.queryByRole('radiogroup')).toBeNull();
		expect(screen.queryByRole('radio', { name: 'Any' })).toBeNull();
		expect(screen.getByText('Matching all selected tags')).toBeInTheDocument();
	});
});

describe('ExpenseSearchFilters: category chips and sort', () => {
	test('one chip per category plus All, with the current one pressed', () => {
		renderFilters({ category: 'maintenance' });
		const chips = within(screen.getByRole('group', { name: 'Category' })).getAllByRole('button');
		expect(chips.map(c => c.textContent?.trim())).toEqual([
			'All',
			'Fuel',
			'Maintenance',
			'Financial',
			'Regulatory',
			'Enhancement',
			'Misc'
		]);
		expect(
			chips.filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.textContent?.trim())
		).toEqual(['Maintenance']);
	});

	test('a chip reports its category, and All reports none', async () => {
		const { onCategoryChange } = renderFilters({ category: 'fuel' });
		await fireEvent.click(screen.getByRole('button', { name: 'Misc' }));
		expect(onCategoryChange).toHaveBeenLastCalledWith('misc');
		await fireEvent.click(screen.getByRole('button', { name: 'All' }));
		expect(onCategoryChange).toHaveBeenLastCalledWith('');
	});

	test('each category chip is a 40px tap target', () => {
		renderFilters({ category: '' });
		expect(screen.getByRole('button', { name: 'All' })).toHaveClass('h-10');
	});

	test('the sort menu names the current order and reports a new one', async () => {
		const { onSortChange } = renderFilters({ sort: 'date-desc' });
		const trigger = screen.getByLabelText('Newest first, sort order');
		expect(trigger).toHaveTextContent('Newest first');
		await pickOption(trigger, 'Largest first');
		expect(onSortChange).toHaveBeenCalledWith('amount-desc');
	});

	test('sits in a search landmark, with no card around it', () => {
		const { container } = render(ExpenseSearchFilters, {
			searchTerm: '',
			filters: {},
			expenses: EXPENSES,
			category: '',
			sort: 'date-desc',
			onSearchChange: vi.fn(),
			onCategoryChange: vi.fn(),
			onSortChange: vi.fn(),
			onClearFilters: vi.fn()
		});
		expect(screen.getByRole('search', { name: 'Find expenses' })).toBeTruthy();
		expect(container.querySelector('[data-slot="card"]')).toBeNull();
	});
});
