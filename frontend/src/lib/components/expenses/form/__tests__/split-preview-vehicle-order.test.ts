import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));

const VEHICLES = [
	{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 },
	{ id: 'v2', make: 'Honda', model: 'Civic', year: 2021 }
];
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve(VEHICLES)),
		getVehicle: vi.fn((id: string) => Promise.resolve(VEHICLES.find(v => v.id === id)))
	}
}));

const createSplitExpense = vi.fn(() => new Promise(() => {}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		createExpense: vi.fn(),
		createSplitExpense,
		getExpensesByVehicle: vi.fn(() => Promise.resolve({ data: [] }))
	}
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

function rowText(name: string): string | undefined {
	return screen.getAllByText(name).at(-1)?.parentElement?.textContent?.replace(/\s+/g, ' ').trim();
}

describe('ExpenseForm — even split preview order', () => {
	test('lists vehicles in the order they were ticked, the order the split is saved in', async () => {
		render(ExpenseForm, {
			props: { preselectedVehicleId: 'v2', preselectedCategory: 'misc', preselectedAmount: '10.01' }
		});
		await vi.waitFor(() => expect(screen.getByDisplayValue('10.01')).toBeTruthy());

		await fireEvent.click(screen.getByRole('button', { name: /split cost across vehicles/i }));
		await vi.waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
		await fireEvent.click(screen.getByRole('checkbox', { name: '2020 Toyota Camry' }));

		await vi.waitFor(() => expect(rowText('2021 Honda Civic')).toBe('2021 Honda Civic $5.01'));
		expect(rowText('2020 Toyota Camry')).toBe('2020 Toyota Camry $5.00');

		await fireEvent.click(screen.getByRole('button', { name: /save expense/i }));
		await vi.waitFor(() => expect(createSplitExpense).toHaveBeenCalled());
		expect(createSplitExpense).toHaveBeenCalledWith(
			expect.objectContaining({ splitConfig: { method: 'even', vehicleIds: ['v2', 'v1'] } })
		);
	});
});
