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
	test('reads the true cost per mile as one sentence, with the dial, the legend and three drums', async () => {
		render(CostPerMileHero, {
			summary: summary(),
			distance: 22360,
			distanceUnit: 'miles',
			name: 'Daily Driver'
		});

		expect(screen.getByText('What a mile really costs, all in')).toBeInTheDocument();
		expect(screen.getByTestId('cost-sentence')).toHaveTextContent(
			'Daily Driver costs 58¢ a mile over 22,360 miles: 13¢ to run it and 45¢ to own it.'
		);
		expect(screen.getByRole('list')).toHaveTextContent(/Running 13¢\s*Ownership 45¢/);
		const dial = await screen.findByRole('img', { name: 'True cost per mile, all in: 58¢' });
		expect(dial).toHaveTextContent('ALL-IN ¢ / MI');
		expect(screen.getByRole('img', { name: '$501' })).toBeInTheDocument();
		expect(screen.getByRole('img', { name: '$544' })).toBeInTheDocument();
		expect(screen.getByRole('img', { name: '$13,061' })).toBeInTheDocument();
		expect(screen.getAllByRole('term').map(t => t.textContent)).toEqual([
			'Last 30 days',
			'Per month',
			'All time'
		]);
	});

	test('a currency without cents and a km car use the currency on the dial and in the sentence', async () => {
		vi.spyOn(settingsStore, 'settings', 'get').mockReturnValue({
			currencyUnit: 'EUR'
		} as NonNullable<typeof settingsStore.settings>);
		render(CostPerMileHero, {
			summary: summary({
				costBuckets: { ownershipTotal: 0, runningTotal: 300, previous: null, byVehicle: [] }
			}),
			distance: 1500,
			distanceUnit: 'kilometers'
		});

		expect(screen.getByTestId('cost-sentence')).toHaveTextContent(
			'This car costs €0.20 a km to run over 1,500 km. No ownership costs logged yet.'
		);
		const dial = await screen.findByRole('img', { name: 'True cost per km, all in: €0.20' });
		expect(dial).toHaveTextContent('ALL-IN EUR / KM');
		expect(screen.getByRole('list')).not.toHaveTextContent('Ownership');
	});

	test('a cost past 80¢ widens the dial instead of pegging it', async () => {
		const { container } = render(CostPerMileHero, {
			summary: summary({
				costBuckets: { ownershipTotal: 9000, runningTotal: 3000, previous: null, byVehicle: [] }
			}),
			distance: 10000,
			distanceUnit: 'miles'
		});

		await screen.findByRole('img', { name: /all in: 120¢/ });
		const labels = [...container.querySelectorAll('text.dial-figure')].map(t => t.textContent);
		expect(labels).toEqual(['0', '40', '80', '120', '160']);
	});

	test('with no distance yet it says what is missing, with no dial', async () => {
		render(CostPerMileHero, {
			summary: summary(),
			distance: null,
			distanceUnit: 'miles',
			logMileageHref: '/vehicles/v1/odometer/new'
		});

		expect(
			screen.getByText('Log a newer odometer reading to see cost per mile')
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add an odometer reading' })).toHaveAttribute(
			'href',
			'/vehicles/v1/odometer/new'
		);
		expect(await screen.findByRole('img', { name: '$13,061' })).toBeInTheDocument();
		expect(screen.queryByRole('img', { name: /all in/ })).toBeNull();
	});

	test('reserves the dial and drums while loading', () => {
		const { container } = render(CostPerMileHero, {
			summary: null,
			distance: null,
			distanceUnit: 'miles'
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
			logMileageHref: '/vehicles/v1/odometer/new'
		});

		expect(screen.getByText('Loading cost per mile')).toBeInTheDocument();
		expect(screen.queryByText(/odometer reading/)).toBeNull();
	});

	test('says when the distance could not load, with Retry instead of asking for a new reading', () => {
		const onRetryDistance = vi.fn();
		render(CostPerMileHero, {
			summary: summary(),
			distance: null,
			distanceError: 'Check your connection and try again.',
			onRetryDistance,
			distanceUnit: 'miles',
			logMileageHref: '/vehicles/v1/odometer/new'
		});

		expect(screen.getByRole('alert')).toHaveTextContent("Cost per mile isn't available right now");
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Add an odometer reading' })).toBeNull();
	});
});
