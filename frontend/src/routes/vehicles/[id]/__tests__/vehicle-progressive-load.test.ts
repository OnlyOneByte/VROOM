import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const insuranceRequested = vi.hoisted(() => ({ value: false }));
vi.mock('#lib/components/insurance/InsuranceTab.svelte', () => {
	insuranceRequested.value = true;
	return { default: () => {} };
});
vi.mock('#lib/components/vehicles/FinanceTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/OdometerTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppPieChart: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/FuelEfficiencyTrendChart.svelte', () => ({ default: () => {} }));
const carouselProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock('#lib/components/vehicles/VehiclePhotoCarousel.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		carouselProps.value = props;
	}
}));
vi.mock('#lib/components/vehicles/FuelEfficiencyStatsCard.svelte', () => ({ default: () => {} }));

const never = <T>() => new Promise<T>(() => {});

vi.mock('#lib/services/reminder-api.ts', () => ({ reminderApi: { list: () => never() } }));
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: { getPoliciesForVehicle: () => never() }
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle: () => never(),
		getExpenseSummary: () => never()
	}
}));

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getFuelEfficiency: () => never() }
}));

const VEHICLE = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

const vehicleCall = vi.hoisted(() => ({ release: (_vehicle: Vehicle) => {} }));
const getPhotos = vi.fn(() => Promise.resolve({ data: [] as unknown[] }));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle: () =>
			new Promise<Vehicle>(resolve => {
				vehicleCall.release = resolve;
			}),
		getVehicleStats: () => never(),
		getPhotos: () => getPhotos(),
		getPhotoThumbnailUrl: () => ''
	}
}));

import Page from '../+page.svelte';

describe('vehicle page draws as soon as the vehicle loads', () => {
	test('the page and photos follow the vehicle alone, and the Insurance chunk waits for the page', async () => {
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await new Promise(resolve => setTimeout(resolve, 100));
		expect(insuranceRequested.value).toBe(false);
		expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument();
		expect(getPhotos).not.toHaveBeenCalled();

		vehicleCall.release(VEHICLE);

		expect(await screen.findByRole('tab', { name: 'Overview' })).toBeInTheDocument();
		await waitFor(() => expect(getPhotos).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(insuranceRequested.value).toBe(true), { timeout: 3000 });
		expect(screen.queryByText('No expenses yet')).not.toBeInTheDocument();
		expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
		expect(
			screen.getAllByRole('tabpanel')[0]?.querySelectorAll('[data-slot="skeleton"]').length
		).toBeGreaterThan(0);
	});

	test('the photo card shows its loading state until the photos arrive', async () => {
		let releasePhotos: (value: { data: unknown[] }) => void = () => {};
		getPhotos.mockImplementationOnce(
			() =>
				new Promise(resolve => {
					releasePhotos = resolve;
				})
		);
		render(Page, { props: { data: { vehicleId: 'v1' } } });
		vehicleCall.release(VEHICLE);
		await fireEvent.click(
			await screen.findByRole('button', { name: 'Details, insurance and photos' })
		);

		await waitFor(() => expect(carouselProps.value?.['isLoading']).toBe(true));
		releasePhotos({ data: [] });
		await waitFor(() => expect(carouselProps.value?.['isLoading']).toBe(false));
	});
});
