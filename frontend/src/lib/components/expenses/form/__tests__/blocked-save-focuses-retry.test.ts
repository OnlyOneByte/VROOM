import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
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
const { getVehicle, getExpensesByVehicle, createExpense } = vi.hoisted(() => ({
	getVehicle: vi.fn(),
	getExpensesByVehicle: vi.fn(),
	createExpense: vi.fn()
}));

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve([vehicle])),
		getVehicle
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle,
		createExpense
	}
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

beforeEach(() => {
	getVehicle.mockReset();
	getVehicle.mockRejectedValue(new Error('offline'));
	getExpensesByVehicle.mockReset();
	getExpensesByVehicle.mockResolvedValue({ data: [] });
	createExpense.mockReset();
	vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
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

function failHistoryOnly(): void {
	getVehicle.mockResolvedValue(vehicle);
	getExpensesByVehicle.mockImplementation((_id: string, opts: { category?: string }) =>
		opts.category === 'fuel'
			? Promise.resolve({ data: [] })
			: Promise.reject(new Error('Server error'))
	);
}

async function fillValidFuelEntry(): Promise<void> {
	await fireEvent.input(screen.getByLabelText(/Amount/), { target: { value: '40' } });
	await fireEvent.input(screen.getByLabelText(/Odometer/), { target: { value: '45000' } });
}

describe("a fill-up when the vehicle loads but its history doesn't", () => {
	test('is blocked online, and focus moves to Retry', async () => {
		failHistoryOnly();
		render(ExpenseForm, { props: { preselectedCategory: 'fuel' } });
		const alert = await screen.findByTestId('vehicle-load-error');
		const retry = alert.querySelector('button') as HTMLButtonElement;
		expect(alert.textContent).toContain("can't be saved yet");
		await fillValidFuelEntry();

		await fireEvent.click(saveBarButton());
		await vi.waitFor(() => expect(document.activeElement).toBe(retry));
		expect(createExpense).not.toHaveBeenCalled();
	});

	test('a failed last fill-up alone does not block or warn', async () => {
		getVehicle.mockResolvedValue(vehicle);
		getExpensesByVehicle.mockImplementation((_id: string, opts: { category?: string }) =>
			opts.category === 'fuel'
				? Promise.reject(new Error('Server error'))
				: Promise.resolve({ data: [] })
		);
		render(ExpenseForm, { props: { preselectedCategory: 'fuel' } });
		await screen.findByLabelText(/Gallons|Liters/);
		await Promise.allSettled(getExpensesByVehicle.mock.results.map(r => r.value));
		await tick();

		expect(screen.queryByTestId('vehicle-load-error')).toBeNull();
	});
});

describe('a Save blocked by another validation error', () => {
	test('moves focus to the first invalid field, even with the vehicle alert and its Retry on screen', async () => {
		render(ExpenseForm, { props: { preselectedCategory: 'maintenance' } });
		await screen.findByTestId('vehicle-load-error');
		const save = saveBarButton();
		save.focus();

		await fireEvent.click(save);
		await vi.waitFor(() => expect(document.getElementById('amount-error')).not.toBeNull());
		await vi.waitFor(() => expect(document.activeElement).toBe(document.getElementById('amount')));
		expect(screen.getByTestId('vehicle-load-error')).toBeInTheDocument();
	});

	test('with the vehicle loaded, moves focus from Save to the first invalid field', async () => {
		getVehicle.mockResolvedValue(vehicle);
		render(ExpenseForm, { props: { preselectedCategory: 'fuel' } });
		await screen.findByLabelText(/Gallons|Liters/);
		const save = saveBarButton();
		save.focus();

		await fireEvent.click(save);
		await vi.waitFor(() => expect(document.getElementById('amount-error')).not.toBeNull());
		expect(screen.queryByTestId('vehicle-load-error')).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).not.toBe(save));
		expect(document.activeElement).toHaveAttribute('aria-invalid', 'true');
	});
});
