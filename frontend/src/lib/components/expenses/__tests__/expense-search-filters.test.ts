import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ExpenseSearchFilters from '../ExpenseSearchFilters.svelte';
import type { Expense, ExpenseFilters, Vehicle } from '#lib/types/index.ts';

const CAMRY: Vehicle = {
	id: 'v1',
	year: 2020,
	make: 'Toyota',
	model: 'Camry',
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
};
const RAV4: Vehicle = { ...CAMRY, id: 'v2', model: 'RAV4', nickname: 'Family Hauler' };

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
	vehicles?: Vehicle[];
	showVehicleSelector?: boolean;
	selectedVehicleId?: string;
}

function renderFilters(options: RenderOptions = {}) {
	const onSearchChange = vi.fn();
	const onVehicleChange = vi.fn();
	const onClearFilters = vi.fn();
	render(ExpenseSearchFilters, {
		searchTerm: options.searchTerm ?? '',
		filters: options.filters ?? {},
		expenses: EXPENSES,
		vehicles: options.vehicles ?? [],
		showVehicleSelector: options.showVehicleSelector ?? false,
		selectedVehicleId: options.selectedVehicleId,
		onSearchChange,
		onVehicleChange,
		onClearFilters
	});
	return { onSearchChange, onVehicleChange, onClearFilters };
}

function tagInput(): HTMLInputElement {
	return screen.getByLabelText('Search tags') as HTMLInputElement;
}

function suggestionButtons(): string[] {
	return screen
		.queryAllByRole('button')
		.filter(b => b.className.includes('px-3 py-2 hover:bg-accent'))
		.map(b => b.textContent?.trim() ?? '');
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
		['a selected vehicle', { selectedVehicleId: 'v1' }],
		['a category', { filters: { category: 'fuel' } }],
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
		await fireEvent.click(screen.getByRole('button', { name: 'tolls' }));

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
		await fireEvent.click(screen.getByRole('button', { name: 'tolls' }));
		await fireEvent.click(screen.getByRole('button', { name: 'parking' }));
		await fireEvent.keyDown(tagInput(), { key: 'Backspace' });

		expect(screen.queryByRole('button', { name: 'Remove tag parking' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Remove tag tolls' })).toBeInTheDocument();
	});

	test('Backspace with text in the box keeps the selected tags', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.click(screen.getByRole('button', { name: 'tolls' }));
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
		await fireEvent.click(screen.getByRole('button', { name: 'tolls' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove tag tolls' }));

		expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull();
		expect(tagInput().placeholder).toBe('Search and add tags...');
	});

	test('the any/all switch appears only with two or more tags and toggles', async () => {
		renderFilters();

		await fireEvent.focus(tagInput());
		await fireEvent.click(screen.getByRole('button', { name: 'tolls' }));
		expect(screen.queryByRole('radiogroup', { name: 'Tag match mode' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'parking' }));
		const any = screen.getByRole('radio', { name: 'Any' });
		const all = screen.getByRole('radio', { name: 'All' });
		expect(any).toHaveAttribute('aria-checked', 'true');

		await fireEvent.click(all);
		expect(all).toHaveAttribute('aria-checked', 'true');
		expect(any).toHaveAttribute('aria-checked', 'false');

		await fireEvent.click(any);
		expect(any).toHaveAttribute('aria-checked', 'true');
	});
});

describe('ExpenseSearchFilters: vehicle selector', () => {
	test('is hidden unless requested and vehicles exist', () => {
		renderFilters({ showVehicleSelector: true, vehicles: [] });
		expect(screen.queryByLabelText('Vehicle filter')).toBeNull();
	});

	test('shows the selected vehicle name', () => {
		renderFilters({ showVehicleSelector: true, vehicles: [CAMRY, RAV4], selectedVehicleId: 'v2' });

		expect(screen.getByLabelText('Vehicle filter')).toHaveTextContent('Family Hauler');
	});

	test('falls back to all vehicles for an unknown or missing selection', () => {
		renderFilters({
			showVehicleSelector: true,
			vehicles: [CAMRY],
			selectedVehicleId: 'gone'
		});

		expect(screen.getByLabelText('Vehicle filter')).toHaveTextContent('All Vehicles');
	});

	test('picking a vehicle reports its id', async () => {
		const { onVehicleChange } = renderFilters({
			showVehicleSelector: true,
			vehicles: [CAMRY, RAV4]
		});

		await pickOption(screen.getByLabelText('Vehicle filter'), '2020 Toyota Camry');

		expect(onVehicleChange).toHaveBeenCalledWith('v1');
	});

	test('picking all vehicles reports undefined', async () => {
		const { onVehicleChange } = renderFilters({
			showVehicleSelector: true,
			vehicles: [CAMRY, RAV4],
			selectedVehicleId: 'v1'
		});

		await pickOption(screen.getByLabelText('Vehicle filter'), 'All Vehicles');

		expect(onVehicleChange).toHaveBeenCalledWith(undefined);
	});
});
