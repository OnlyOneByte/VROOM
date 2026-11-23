import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { VehicleStats } from '#lib/types/index.ts';

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
		settings: { currencyUnit: 'USD' }
	}
}));

const FuelEfficiencyStatsCard = (await import('../FuelEfficiencyStatsCard.svelte')).default;

const STATS: VehicleStats = {
	period: 'all',
	totalMileage: 1200,
	currentMileage: 46200,
	currentOdometer: 46200,
	totalFuelConsumed: 85,
	totalChargeConsumed: 0,
	averageMpg: 7.1,
	averageMilesPerKwh: null,
	totalFuelCost: 140,
	totalChargeCost: 0,
	costPerMile: 0.12,
	fuelExpenseCount: 3,
	chargeExpenseCount: 0
};

function renderCard(unitPreferences?: {
	distanceUnit: 'miles' | 'kilometers';
	volumeUnit: 'gallons_us' | 'gallons_uk' | 'liters';
	chargeUnit: 'kwh';
}) {
	return render(FuelEfficiencyStatsCard, {
		props: {
			vehicleId: 'veh-1',
			vehicleStatsData: STATS,
			yearStats: STATS,
			isLoadingStats: false,
			unitPreferences
		}
	});
}

describe('FuelEfficiencyStatsCard units', () => {
	const recentDay = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

	test("labels a metric vehicle's economy in its own units, not the user's", () => {
		const { container } = renderCard({
			distanceUnit: 'kilometers',
			volumeUnit: 'liters',
			chargeUnit: 'kwh'
		});
		const text = container.textContent ?? '';

		expect(text).toContain('Fuel economy');
		expect(text).toContain('avg per L');
		expect(text).not.toContain('gal');
	});

	test("falls back to the user's units when the vehicle has none", () => {
		const text = renderCard().container.textContent ?? '';

		expect(text).toContain('avg per gal');
		expect(text).toContain('$1.65');
	});

	test('the three figures all cover the last 12 months', () => {
		const { container } = render(FuelEfficiencyStatsCard, {
			props: {
				vehicleId: 'veh-1',
				vehicleStatsData: STATS,
				yearStats: { ...STATS, totalFuelCost: 120, totalFuelConsumed: 40 },
				isLoadingStats: false,
				trend: [
					{ date: recentDay(10), efficiency: 30 },
					{ date: recentDay(40), efficiency: 34 },
					{ date: recentDay(500), efficiency: 99 }
				]
			}
		});
		const figures = [...container.querySelectorAll('dd')].map(dd => dd.textContent?.trim());

		expect(figures).toEqual(['32.0', '34.0', '$3.00']);
	});

	test('the figures hold skeletons while the trend loads, and never show an all-time average', () => {
		const props = {
			vehicleId: 'veh-1',
			vehicleStatsData: STATS,
			isLoadingStats: false,
			trendLoading: true
		};
		const loading = render(FuelEfficiencyStatsCard, { props });

		expect(loading.container.querySelectorAll('dd [data-slot="skeleton"]')).toHaveLength(3);
		loading.unmount();

		const loaded = render(FuelEfficiencyStatsCard, {
			props: { ...props, trendLoading: false, yearStats: STATS }
		});
		const figures = [...loaded.container.querySelectorAll('dd')].map(dd => dd.textContent?.trim());

		expect(figures).toEqual(['—', '—', '$1.65']);
	});

	const sentenceFor = (now: Date, trend: Array<[Date, number]>) => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(now);
		const { getByTestId, queryByTestId } = render(FuelEfficiencyStatsCard, {
			props: {
				vehicleId: 'veh-1',
				vehicleStatsData: STATS,
				isLoadingStats: false,
				trend: trend.map(([date, efficiency]) => ({ date, efficiency }))
			}
		});
		vi.useRealTimers();
		return queryByTestId('fuel-economy-insight')
			? getByTestId('fuel-economy-insight').textContent
			: null;
	};
	const tanks = (y: number, m: number, values: number[]): Array<[Date, number]> =>
		values.map((v, i) => [new Date(y, m, 3 + i * 10), v]);

	test.each([
		{
			name: 'names a month that dipped well below the average',
			trend: [
				...tanks(2026, 6, [19, 19]),
				...tanks(2026, 7, [32, 32]),
				...tanks(2026, 8, [33, 33])
			],
			sentence: /^July dipped to 19\.0 .+ over 2 tanks\.$/
		},
		{
			name: 'with no dip, names a month that rose well above the average',
			trend: [
				...tanks(2026, 8, [30, 30]),
				...tanks(2026, 9, [30, 30]),
				...tanks(2026, 10, [40, 44])
			],
			sentence: /^November rose to 42\.0 .+ over 2 tanks\.$/
		},
		{
			name: 'says every month stayed close when none is 15% off the average',
			trend: [...tanks(2026, 8, [30, 31]), ...tanks(2026, 9, [32, 31])],
			sentence: /^Every month stayed within 15% of the 31\.0 .+ average\.$/
		}
	])('one sentence $name', ({ trend, sentence }) => {
		expect(sentenceFor(new Date(2026, 10, 23, 12), trend)).toMatch(sentence);
	});

	test('a month from last year is named with its year', () => {
		const trend = [
			...tanks(2025, 10, [19, 19]),
			...tanks(2025, 11, [32, 32]),
			...tanks(2026, 0, [33, 33])
		];

		expect(sentenceFor(new Date(2026, 1, 10, 12), trend)).toMatch(/^November 2025 dipped to 19\.0/);
	});

	test('says nothing when too few months have two or more tanks', () => {
		const trend = [...tanks(2026, 8, [30, 31]), ...tanks(2026, 9, [84])];

		expect(sentenceFor(new Date(2026, 10, 23, 12), trend)).toBeNull();
	});

	test('an electric vehicle reads as Efficiency, priced per kWh', () => {
		const charging = {
			...STATS,
			totalFuelConsumed: 0,
			totalFuelCost: 0,
			fuelExpenseCount: 0,
			totalChargeConsumed: 100,
			totalChargeCost: 14,
			chargeExpenseCount: 3,
			averageMpg: null,
			averageMilesPerKwh: 4.1
		};
		const { container } = render(FuelEfficiencyStatsCard, {
			props: {
				vehicleId: 'veh-1',
				vehicleStatsData: charging,
				yearStats: charging,
				isLoadingStats: false,
				vehicleType: 'electric'
			}
		});
		const text = container.textContent ?? '';

		expect(text).toContain('Efficiency');
		expect(text).toContain('best session');
		expect(text).toContain('avg per kWh');
		expect(text).toContain('$0.14');
	});
});

describe('FuelEfficiencyStatsCard empty state', () => {
	test.each([
		['electric', 'No charging data yet', 'Add Charging Session'],
		['gas', 'No fuel data yet', 'Add Fuel Expense']
	] as const)('a %s vehicle with no data gets matching wording', (vehicleType, title, action) => {
		const { container } = render(FuelEfficiencyStatsCard, {
			props: {
				vehicleId: 'veh-1',
				vehicleStatsData: { ...STATS, fuelExpenseCount: 0, chargeExpenseCount: 0 },
				isLoadingStats: false,
				vehicleType
			}
		});
		const text = container.textContent ?? '';

		expect(text).toContain(title);
		expect(text).toContain(action);
		if (vehicleType === 'electric') expect(text.toLowerCase()).not.toContain('fuel');
	});
});
