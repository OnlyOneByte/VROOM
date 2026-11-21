import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { VehicleFinancing } from '#lib/types/index.ts';

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: { settings: { currencyUnit: 'EUR' } }
}));

const PaymentPlannerDialog = (await import('../PaymentPlannerDialog.svelte')).default;

const LOAN: VehicleFinancing = {
	id: 'fin-1',
	vehicleId: 'veh-1',
	financingType: 'loan',
	provider: 'Credit Union',
	originalAmount: 20000,
	computedBalance: 15000,
	apr: 4.5,
	termMonths: 60,
	startDate: '2024-01-15T12:00:00.000Z',
	paymentAmount: 373,
	paymentFrequency: 'monthly',
	paymentDayOfMonth: 15,
	isActive: true,
	createdAt: '2024-01-15T12:00:00.000Z',
	updatedAt: '2024-01-15T12:00:00.000Z'
};

describe('PaymentPlannerDialog currency', () => {
	test("labels the payment input with the user's currency instead of a hardcoded $", async () => {
		render(PaymentPlannerDialog, {
			props: { financing: LOAN, open: true, onPaymentAmountSaved: vi.fn() }
		});

		expect(await screen.findByLabelText('Monthly Payment (€)')).toBeTruthy();
		const dialog = screen.getByRole('dialog');
		expect([...dialog.querySelectorAll('span')].some(s => s.textContent?.trim() === '$')).toBe(
			false
		);
	});
});
