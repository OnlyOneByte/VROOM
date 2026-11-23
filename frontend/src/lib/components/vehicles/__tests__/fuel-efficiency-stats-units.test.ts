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

	test('the three figures are the 12-month average, the best tank and the price per unit', () => {
		const { container } = render(FuelEfficiencyStatsCard, {
			props: {
				vehicleId: 'veh-1',
				vehicleStatsData: STATS,
				isLoadingStats: false,
				trend: [
					{ date: recentDay(10), efficiency: 30 },
					{ date: recentDay(40), efficiency: 34 },
					{ date: recentDay(500), efficiency: 99 }
				]
			}
		});
		const figures = [...container.querySelectorAll('dd')].map(dd => dd.textContent?.trim());

		expect(figures).toEqual(['32.0', '34.0', '$1.65']);
	});

	test('one sentence names a month that dipped well below the average', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 10, 23, 12));
		const { getByTestId } = render(FuelEfficiencyStatsCard, {
			props: {
				vehicleId: 'veh-1',
				vehicleStatsData: STATS,
				isLoadingStats: false,
				trend: [
					{ date: new Date(2026, 6, 4), efficiency: 19 },
					{ date: new Date(2026, 6, 20), efficiency: 19 },
					{ date: new Date(2026, 7, 3), efficiency: 32 },
					{ date: new Date(2026, 8, 3), efficiency: 33 }
				]
			}
		});
		vi.useRealTimers();

		expect(getByTestId('fuel-economy-insight').textContent).toMatch(
			/^July dipped to 19\.0 .+ over 2 tanks\.$/
		);
	});

	test.each([
		{
			name: 'with no dip, names a month that rose well above the average',
			trend: [30, 30, 30, 45],
			sentence: /^November rose to 45\.0 .+ over 1 tank\.$/
		},
		{
			name: 'says every month stayed close when none is 15% off the average',
			trend: [30, 31, 32, 31],
			sentence: /^Every month stayed within 15% of the 31\.0 .+ average\.$/
		}
	])('$name', ({ trend, sentence }) => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 10, 23, 12));
		const days = [
			new Date(2026, 8, 3),
			new Date(2026, 9, 3),
			new Date(2026, 9, 20),
			new Date(2026, 10, 3)
		];
		const { getByTestId } = render(FuelEfficiencyStatsCard, {
			props: {
				vehicleId: 'veh-1',
				vehicleStatsData: STATS,
				isLoadingStats: false,
				trend: trend.map((efficiency, i) => ({ date: days[i] as Date, efficiency }))
			}
		});
		vi.useRealTimers();

		expect(getByTestId('fuel-economy-insight').textContent).toMatch(sentence);
	});

	test('an electric vehicle reads as Efficiency, priced per kWh', () => {
		const { container } = render(FuelEfficiencyStatsCard, {
			props: {
				vehicleId: 'veh-1',
				vehicleStatsData: {
					...STATS,
					totalFuelConsumed: 0,
					totalFuelCost: 0,
					fuelExpenseCount: 0,
					totalChargeConsumed: 100,
					totalChargeCost: 14,
					chargeExpenseCount: 3,
					averageMpg: null,
					averageMilesPerKwh: 4.1
				},
				isLoadingStats: false,
				vehicleType: 'electric'
			}
		});
		const text = container.textContent ?? '';

		expect(text).toContain('Efficiency');
		expect(text).toContain('best session');
		expect(text).toContain('avg per kWh');
		expect(text).toContain('$0.14');
		expect(text).toContain('4.10');
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
