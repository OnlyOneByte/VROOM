import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

const vehicle: Vehicle = {
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
};

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));
const { getVehicle } = vi.hoisted(() => ({ getVehicle: vi.fn() }));

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve([vehicle])),
		getVehicle
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle: vi.fn(() => Promise.resolve({ data: [] })),
		createExpense: vi.fn()
	}
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

beforeEach(() => {
	getVehicle.mockReset();
	getVehicle.mockRejectedValue(new Error('offline'));
	Element.prototype.scrollIntoView = vi.fn();
});

function saveBarButton(): HTMLButtonElement {
	return screen.getByRole('button', { name: /Save Expense/ });
}

describe('a Save blocked by a failed vehicle load', () => {
	test('moves focus to Retry, which is described by the alert text', async () => {
		const { container } = render(ExpenseForm, { props: { preselectedCategory: 'fuel' } });
		const alert = await screen.findByTestId('vehicle-load-error');
		const retry = alert.querySelector('button') as HTMLButtonElement;
		expect(retry.getAttribute('aria-describedby')).toBe('vehicle-load-message');
		expect(document.getElementById('vehicle-load-message')?.textContent).toContain(
			"can't be saved yet"
		);

		await fireEvent.submit(container.querySelector('form') as HTMLFormElement);
		await vi.waitFor(() => expect(document.activeElement).toBe(retry));
		expect(retry.scrollIntoView).toHaveBeenCalled();
	});

	test("the action bar's Save moves focus to Retry too", async () => {
		render(ExpenseForm, { props: { preselectedCategory: 'fuel' } });
		const alert = await screen.findByTestId('vehicle-load-error');
		const retry = alert.querySelector('button') as HTMLButtonElement;

		await fireEvent.click(saveBarButton());
		await vi.waitFor(() => expect(document.activeElement).toBe(retry));
		expect(retry.scrollIntoView).toHaveBeenCalled();
	});
});

describe('a Save blocked by another validation error', () => {
	test('leaves focus where it was and does not scroll', async () => {
		getVehicle.mockResolvedValue(vehicle);
		render(ExpenseForm, { props: { preselectedCategory: 'maintenance' } });
		await vi.waitFor(() => expect(getVehicle).toHaveBeenCalled());
		const save = saveBarButton();
		save.focus();

		await fireEvent.click(save);
		await vi.waitFor(() => expect(document.getElementById('amount-error')).not.toBeNull());
		expect(screen.queryByTestId('vehicle-load-error')).toBeNull();
		expect(document.activeElement).toBe(save);
		expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
	});
});
