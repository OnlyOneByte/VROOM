import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));

const store = vi.hoisted(() => ({ finish: (_currencyUnit: string) => {} }));

vi.mock('#lib/stores/settings.svelte.ts', () => {
	const state = $state<{ settings: { currencyUnit: string } | null }>({ settings: null });
	return {
		settingsStore: {
			get settings() {
				return state.settings;
			},
			load: () =>
				new Promise<void>(resolve => {
					store.finish = currencyUnit => {
						state.settings = { currencyUnit };
						resolve();
					};
				})
		}
	};
});

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: vi.fn(() => new Promise(() => {})) }
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

describe('the quick-add loading figure', () => {
	test("keeps the currency symbol hidden until the car loads, since it is the owner's currency", async () => {
		render(ExpenseForm);
		await tick();

		expect(screen.getByTestId('loading-currency')).toHaveClass('invisible');

		store.finish('EUR');
		await tick();
		await tick();
		expect(screen.getByTestId('loading-currency')).toHaveClass('invisible');
	});
});
