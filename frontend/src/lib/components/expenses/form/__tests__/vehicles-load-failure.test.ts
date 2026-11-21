import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const { addNotification, getVehicle, getExpensesByVehicle } = vi.hoisted(() => ({
	addNotification: vi.fn(),
	getVehicle: vi.fn(() => Promise.reject(new Error('offline'))),
	getExpensesByVehicle: vi.fn(() => Promise.reject(new Error('offline')))
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));
vi.mock('#lib/stores/app.svelte.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/stores/app.svelte.ts')>();
	return { appStore: Object.assign(actual.appStore, { addNotification }) };
});
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: vi.fn(() => Promise.reject(new Error('offline'))), getVehicle }
}));
vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: { getExpensesByVehicle } }));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

describe('a failed vehicle list on the expense form', () => {
	test('shows one inline error with Retry, one toast, and skips the vehicle loads', async () => {
		render(ExpenseForm, { props: { preselectedVehicleId: 'v1' } });
		const card = await screen.findByTestId('vehicles-load-error');
		expect(card.textContent).toContain("Couldn't load your vehicles");
		expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(addNotification).toHaveBeenCalledTimes(1);
		expect(getVehicle).not.toHaveBeenCalled();
		expect(getExpensesByVehicle).not.toHaveBeenCalled();
	});
});
