import { describe, expect, test, vi } from 'vitest';
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
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve([vehicle])),
		getVehicle: vi.fn(() => Promise.reject(new Error('offline')))
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle: vi.fn(() => Promise.resolve({ data: [] })),
		createExpense: vi.fn()
	}
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

describe('a Save blocked by a failed vehicle load', () => {
	test('moves focus to Retry, which is described by the alert text', async () => {
		Element.prototype.scrollIntoView = vi.fn();
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
});
