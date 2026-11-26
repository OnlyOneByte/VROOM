import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { FuelAdvancedResponse, FuelStatsResponse } from '#lib/types/index.ts';
import FuelOverview from '../FuelOverview.svelte';
import { economyRows, priceSummary } from '../fuel-overview';

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
