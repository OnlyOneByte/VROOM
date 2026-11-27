import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { FuelAdvancedResponse, FuelStatsResponse } from '#lib/types/index.ts';
import FuelOverview from '../FuelOverview.svelte';
import { chargerRows, economyRows, fillupRows, homeSplit, priceSummary } from '../fuel-overview';

type Charger = NonNullable<FuelStatsResponse['charging']>['byChargerType'][number];
const charger = (
	chargerType: Charger['chargerType'],
	sessions: number,
	energyShare: number,
	pricePerEnergyUnit: number | null
): Charger => ({
	chargerType,
	sessions,
	energy: energyShare * 100,
	energyShare,
	pricePerEnergyUnit
});

const fill = (month: string, pricePerVolume: number, fuelType = 'Regular') => ({
	date: `${month}-10`,
	month,
	fuelType,
	pricePerVolume
});

type Radar = FuelAdvancedResponse['vehicleRadar'][number];
const car = (vehicleId: string, vehicleName: string, value: number | null): Radar => ({
	vehicleId,
	vehicleName,
	fuelEfficiency: value == null ? null : 50,
	fuelEfficiencyValue: value,
	maintenanceCost: 0,
	reliability: 0,
	annualCost: 0,
	mileage: 0
});

describe('fuel overview figures', () => {
	test('the hero averages the main fuel type only; range and cheapest month use monthly averages', () => {
		const summary = priceSummary([
			fill('2026-10', 3.6),
			fill('2026-10', 3.7),
			fill('2026-11', 3.5),
			fill('2026-12', 3.8),
			fill('2026-11', 5.9, 'Diesel')
		]);
		expect(summary).toMatchObject({
			fuelType: 'Regular',
			low: 3.5,
			high: 3.8,
			cheapestMonth: '2026-11',
			months: 3
		});
		expect(summary?.average).toBeCloseTo(3.65);
		expect(priceSummary([])).toBeNull();
	});

	test('a tie in fill-up count goes to the fuel type used most recently', () => {
		const history = [
			{ ...fill('2026-10', 3.5), date: '2026-10-01' },
			{ ...fill('2026-11', 4.2, 'Premium'), date: '2026-11-20' },
			{ ...fill('2026-11', 3.6), date: '2026-11-05' },
			{ ...fill('2026-09', 4.1, 'Premium'), date: '2026-09-01' }
		];
		expect(priceSummary(history)?.fuelType).toBe('Premium');
		expect(priceSummary([...history].reverse())?.fuelType).toBe('Premium');
	});

	test('the average and monthly averages weight each fill-up by its volume', () => {
		const summary = priceSummary([
			{ ...fill('2026-10', 3), volume: 2 },
			{ ...fill('2026-10', 4), volume: 14 },
			{ ...fill('2026-11', 3.5), volume: 16 }
		]);
		expect(summary?.average).toBeCloseTo((3 * 2 + 4 * 14 + 3.5 * 16) / 32);
		expect(summary?.high).toBeCloseTo((3 * 2 + 4 * 14) / 16);
		expect(summary?.cheapestMonth).toBe('2026-11');
	});

	test('fill-up rows give each car its volume-weighted price', () => {
		expect(
			fillupRows([
				{ vehicleId: 'a', vehicleName: 'Daily', count: 36, volume: 400, cost: 1448 },
				{ vehicleId: 'b', vehicleName: 'Free', count: 1, volume: 10, cost: 0 }
			])
		).toEqual([
			{ vehicleId: 'a', label: 'Daily', count: 36, volume: 400, avgPrice: 3.62 },
			{ vehicleId: 'b', label: 'Free', count: 1, volume: 10, avgPrice: null }
		]);
		expect(fillupRows(undefined)).toEqual([]);
	});

	test('charger rows skip unused types; the home split compares home with priced public charging', () => {
		const byType = [
			charger('home', 40, 0.84, 0.14),
			charger('workplace', 0, 0, null),
			charger('public_l2', 2, 0.04, 0.3),
			charger('dc_fast', 5, 0.12, 0.42),
			charger('unspecified', 1, 0, null)
		];
		expect(chargerRows(byType).map(r => [r.label, r.sessions])).toEqual([
			['Home', 40],
			['Public Level 2', 2],
			['DC fast', 5],
			['Not set', 1]
		]);
		const split = homeSplit(byType);
		expect(split).toMatchObject({ homeShare: 0.84, homeRate: 0.14 });
		expect(split?.awayRate).toBeCloseTo((0.3 * 4 + 0.42 * 12) / 16);
		expect(homeSplit([charger('home', 40, 1, 0.14)])).toBeNull();
		expect(homeSplit([charger('dc_fast', 5, 1, 0.42)])).toBeNull();
	});

	test('economy bars use the real economy, skip cars without one, best first', () => {
		const rows = economyRows([
			car('a', 'Daily', 31),
			car('b', 'EV', null),
			car('c', 'Weekend', 35)
		]);
		expect(rows.map(r => [r.label, r.value])).toEqual([
			['Weekend', 35],
			['Daily', 31]
		]);
		expect(rows[1]?.share).toBeCloseTo(31 / 35);
	});
});

const base = {
	vehicleColors: {},
	rangeText: 'Last 12 months',
	volumeUnit: 'gal',
	chargeUnit: 'kWh',
	efficiencyUnit: 'mpg',
	electricEfficiencyUnit: 'mi/kWh'
};

function stats(over: Partial<FuelStatsResponse>): FuelStatsResponse {
	return { gasPriceHistory: [], ...over } as FuelStatsResponse;
}

describe('FuelOverview', () => {
	test('shows each car its own economy, not the comparison score', () => {
		render(FuelOverview, {
			...base,
			fuelStats: stats({ gasPriceHistory: [fill('2026-10', 3.6), fill('2026-11', 3.5)] }),
			fuelAdvanced: {
				vehicleRadar: [car('c', 'Weekend', 35), car('a', 'Daily', 31)]
			} as FuelAdvancedResponse,
			showCharging: false
		});
		const list = screen.getByRole('list', { name: 'Fuel economy' });
		expect(list.textContent).toMatch(/Weekend\s*35\.0\s*mpg/);
		expect(list.textContent).toMatch(/Daily\s*31\.0\s*mpg/);
		expect(screen.getByRole('heading', { name: 'Regular, last 12 months' })).toBeTruthy();
		expect(screen.getByText(/November 2026 was the cheapest month/)).toBeTruthy();
	});

	test('one month of fill-ups gives the average without a range, and a custom range keeps its case', () => {
		render(FuelOverview, {
			...base,
			rangeText: 'Jun 1, 2026 – Nov 30, 2026',
			fuelStats: stats({ gasPriceHistory: [fill('2026-10', 3.6)] }),
			showCharging: false
		});
		expect(
			screen.getByRole('heading', { name: 'Regular, Jun 1, 2026 – Nov 30, 2026' })
		).toBeTruthy();
		expect(screen.queryByText(/cheapest month/)).toBeNull();
	});

	test('the fill-ups and charging tables, and the home share of charging', () => {
		render(FuelOverview, {
			...base,
			fuelStats: stats({
				gasPriceHistory: [fill('2026-10', 3.6)],
				fillupsByVehicle: [
					{ vehicleId: 'a', vehicleName: 'Daily Driver', count: 36, volume: 400, cost: 1448 }
				],
				charging: {
					sessions: { currentYear: 47, previousYear: 0, currentMonth: 4, previousMonth: 3 },
					efficiency: { avgEfficiency: 4.7, bestEfficiency: null, worstEfficiency: null },
					averageCost: { perSession: 2, perEnergyUnit: 0.193 },
					byChargerType: [charger('home', 40, 0.84, 0.14), charger('dc_fast', 7, 0.16, 0.42)]
				} as FuelStatsResponse['charging']
			}),
			showCharging: true
		});
		const fillups = screen.getByRole('table', { name: 'Fill-ups' });
		expect(fillups.textContent).toMatch(/Daily Driver\s*36\s*400\s*\$3\.62/);
		const chargingTable = screen.getByRole('table', { name: 'Charging' });
		expect(chargingTable.textContent).toMatch(/Home\s*40\s*84%\s*\$0\.140/);
		expect(chargingTable.textContent).toMatch(/DC fast\s*7\s*16%\s*\$0\.420/);
		expect(screen.getByRole('region', { name: 'Fuel and charging overview' }).textContent).toMatch(
			/84%\s*of energy came from home at\s*\$0\.140\s*per kWh; away from home it cost\s*\$0\.420\./
		);
	});

	test('an EV-only fleet gets the charging line and no fuel hero or economy bars', () => {
		render(FuelOverview, {
			...base,
			fuelStats: stats({
				charging: {
					sessions: { currentYear: 3, previousYear: 0, currentMonth: 1, previousMonth: 0 },
					efficiency: { avgEfficiency: 4.2, bestEfficiency: null, worstEfficiency: null },
					averageCost: { perSession: null, perEnergyUnit: null }
				} as FuelStatsResponse['charging']
			}),
			fuelAdvanced: { vehicleRadar: [car('e', 'EV', null)] } as FuelAdvancedResponse,
			showCharging: true
		});
		const region = screen.getByRole('region', { name: 'Fuel and charging overview' });
		expect(region.textContent).toMatch(
			/3\s*sessions,\s*at\s*4\.2\s*mi\/kWh, with no\s+costs recorded\./
		);
		expect(screen.queryByRole('list', { name: 'Fuel economy' })).toBeNull();
		expect(screen.queryByRole('heading', { name: /last 12 months/ })).toBeNull();
	});
});
