import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { ExpenseSummary } from '#lib/types/index.ts';
import { settingsStore } from '#lib/stores/settings.svelte.ts';
import CostPerMileHero from '../CostPerMileHero.svelte';

function summary(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
	return {
		totalAmount: 13061,
		expenseCount: 61,
		recentAmount: 500.79,
		monthlyAverage: 544.2,
		categoryBreakdown: [
			{ category: 'financial', amount: 10154, count: 24 },
			{ category: 'fuel', amount: 1900, count: 30 },
			{ category: 'maintenance', amount: 1007, count: 7 }
		],
		monthlyTrend: [],
		costBuckets: { ownershipTotal: 10154, runningTotal: 2907, previous: null, byVehicle: [] },
		...overrides
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('CostPerMileHero', () => {
	test('leads with the true cost per mile and its running and ownership parts', () => {
		const { container } = render(CostPerMileHero, {
			summary: summary(),
			distance: 22360,
			distanceUnit: 'miles',
			vehicleType: 'gas'
		});

		expect(screen.getByText('True cost per mile, all time')).toBeInTheDocument();
		expect(screen.getByText('$0.58')).toBeInTheDocument();
		expect(screen.getByText(/\$0\.13 running\s*\+ \$0\.45 ownership/)).toBeInTheDocument();
		expect(screen.getByText(/over 22,360\s*mi/)).toBeInTheDocument();
		expect(screen.getByRole('list')).toHaveTextContent(
			/Ownership\s*\$10,154\.00.*Fuel\s*\$1,900\.00.*Upkeep\s*\$1,007\.00/
		);
		const figures = container.querySelector('dl') as HTMLElement;
		expect(figures).toHaveTextContent(/Last 30 days\s*\$500\.79/);
		expect(figures).toHaveTextContent(/Per month\s*\$544/);
		expect(figures).toHaveTextContent(/All time\s*\$13,061/);
	});

	test('uses the vehicle distance unit and the user currency', () => {
		vi.spyOn(settingsStore, 'settings', 'get').mockReturnValue({
			currencyUnit: 'EUR'
		} as NonNullable<typeof settingsStore.settings>);
		render(CostPerMileHero, {
			summary: summary({
				costBuckets: { ownershipTotal: 0, runningTotal: 300, previous: null, byVehicle: [] }
			}),
			distance: 1500,
			distanceUnit: 'kilometers',
			vehicleType: 'gas'
		});

		expect(screen.getByText('True cost per km, all time')).toBeInTheDocument();
		expect(screen.getByText('€0.20')).toBeInTheDocument();
		expect(screen.getByText(/no ownership costs logged/)).toBeInTheDocument();
		expect(screen.getByText(/over 1,500\s*km/)).toBeInTheDocument();
	});

	test('with no distance yet it says what is missing instead of $0.00', () => {
		render(CostPerMileHero, {
			summary: summary(),
			distance: null,
			distanceUnit: 'miles',
			vehicleType: 'gas',
			logMileageHref: '/vehicles/v1/odometer/new'
		});

		expect(
			screen.getByText('Log a newer odometer reading to see cost per mile')
		).toBeInTheDocument();
		expect(screen.queryByText('$0.00')).toBeNull();
		expect(screen.getByRole('link', { name: 'Add an odometer reading' })).toHaveAttribute(
			'href',
			'/vehicles/v1/odometer/new'
		);
	});

	test.each([
		['electric', 'Charging'],
		['hybrid', 'Energy']
	] as const)('names the energy bucket for a %s vehicle', (vehicleType, label) => {
		render(CostPerMileHero, {
			summary: summary(),
			distance: 22360,
			distanceUnit: 'miles',
			vehicleType
		});

		expect(screen.getByRole('list')).toHaveTextContent(label);
	});

	test('reserves its lines while loading', () => {
		const { container } = render(CostPerMileHero, {
			summary: null,
			distance: null,
			distanceUnit: 'miles',
			vehicleType: 'gas'
		});

		expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(7);
		expect(screen.getByText('Loading cost per mile')).toBeInTheDocument();
	});

	test('waits for the distance instead of showing the missing-mileage message', () => {
		render(CostPerMileHero, {
			summary: summary(),
			distance: null,
			distanceLoading: true,
			distanceUnit: 'miles',
			vehicleType: 'gas',
			logMileageHref: '/vehicles/v1/odometer/new'
		});

		expect(screen.getByText('Loading cost per mile')).toBeInTheDocument();
		expect(screen.queryByText(/odometer reading/)).toBeNull();
	});

	test('says when the distance could not load, without asking for a new reading', () => {
		render(CostPerMileHero, {
			summary: summary(),
			distance: null,
			distanceUnavailable: true,
			distanceUnit: 'miles',
			vehicleType: 'gas',
			logMileageHref: '/vehicles/v1/odometer/new'
		});

		expect(screen.getByText("Cost per mile isn't available right now")).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Add an odometer reading' })).toBeNull();
	});
});
