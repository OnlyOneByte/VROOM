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
	test('reads the true cost per mile as one sentence, with the dial, the legend and three drums', () => {
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
		const dial = screen.getByRole('img', {
			name: 'True cost per mile, all in: 58¢; running 13¢, ownership 45¢'
		});
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

	test('a currency without cents and a km car use the currency on the dial and in the sentence', () => {
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
		const dial = screen.getByRole('img', { name: 'True cost per km: €0.20, all running' });
		expect(dial).toHaveTextContent('ALL-IN EUR / KM');
		expect(screen.getByRole('list')).not.toHaveTextContent('Ownership');
	});

	test('a cost past 80¢ widens the dial instead of pegging it', () => {
		const { container } = render(CostPerMileHero, {
			summary: summary({
				costBuckets: { ownershipTotal: 6000, runningTotal: 3000, previous: null, byVehicle: [] }
			}),
			distance: 10000,
			distanceUnit: 'miles'
		});

		screen.getByRole('img', { name: /all in: 90¢/ });
		const labels = [...container.querySelectorAll('text.dial-figure')].map(t => t.textContent);
		expect(labels).toEqual(['0', '30', '60', '90', '120']);
	});

	test('a cost that rounds to a dollar reads $1.00, never 100¢', () => {
		render(CostPerMileHero, {
			summary: summary({
				costBuckets: { ownershipTotal: 0, runningTotal: 9960, previous: null, byVehicle: [] }
			}),
			distance: 10000,
			distanceUnit: 'miles'
		});
		expect(screen.getByTestId('cost-sentence')).toHaveTextContent(
			'This car costs $1.00 a mile to run over 10,000 miles.'
		);
		expect(screen.getByRole('img', { name: /\$1\.00, all running/ })).toHaveTextContent(
			'ALL-IN USD / MI'
		);
		expect(document.body.textContent).not.toContain('100¢');
	});

	test('from a dollar a mile up, the sentence, legend and dial read in dollars', () => {
		render(CostPerMileHero, {
			summary: summary({
				costBuckets: { ownershipTotal: 8300, runningTotal: 21300, previous: null, byVehicle: [] }
			}),
			distance: 10000,
			distanceUnit: 'miles',
			name: 'Daily Driver'
		});

		expect(screen.getByTestId('cost-sentence')).toHaveTextContent(
			'Daily Driver costs $2.96 a mile over 10,000 miles: $2.13 to run it and 83¢ to own it.'
		);
		expect(screen.getByRole('list')).toHaveTextContent(/Running \$2\.13\s*Ownership 83¢/);
		const dial = screen.getByRole('img', {
			name: 'True cost per mile, all in: $2.96; running $2.13, ownership 83¢'
		});
		expect(dial).toHaveTextContent('ALL-IN USD / MI');
		expect(dial).not.toHaveTextContent('296');
	});

	test('with no distance yet it says what is missing, with no dial', () => {
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
		expect(screen.getByRole('img', { name: '$13,061' })).toBeInTheDocument();
		expect(screen.queryByRole('img', { name: /all in/ })).toBeNull();
	});

	test('a negative ownership total counts as none, so the figures agree', () => {
		render(CostPerMileHero, {
			summary: summary({
				costBuckets: { ownershipTotal: -500, runningTotal: 3000, previous: null, byVehicle: [] }
			}),
			distance: 10000,
			distanceUnit: 'miles'
		});

		expect(screen.getByTestId('cost-sentence')).toHaveTextContent(
			'This car costs 30¢ a mile to run over 10,000 miles. No ownership costs logged yet.'
		);
		expect(screen.getByRole('img', { name: /: 30¢, all running/ })).toHaveTextContent('30¢');
		expect(screen.getByRole('list')).not.toHaveTextContent('Ownership');
	});

	test('reserves the dial and drums while loading, with the labels already in place', () => {
		const { container } = render(CostPerMileHero, {
			summary: null,
			distance: null,
			distanceUnit: 'miles'
		});

		expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(7);
		expect(screen.getByText('Loading cost per mile')).toBeInTheDocument();
		expect(screen.getByText('What a mile really costs, all in')).toBeInTheDocument();
		expect(screen.getAllByRole('term').map(t => t.textContent)).toEqual([
			'Last 30 days',
			'Per month',
			'All time'
		]);
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
