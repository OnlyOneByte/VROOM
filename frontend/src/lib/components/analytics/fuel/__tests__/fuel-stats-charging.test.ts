import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { FuelAdvancedResponse, FuelStatsResponse } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

const getAllExpenses = vi.fn();
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: { getAllExpenses: (...args: unknown[]) => getAllExpenses(...args) }
}));

import FuelStatsTab from '../FuelStatsTab.svelte';

function fuelExpenseCount(totalCount: number) {
	getAllExpenses.mockResolvedValue({ data: [], pagination: { totalCount } });
}

beforeEach(() => {
	getAllExpenses.mockReset();
	fuelExpenseCount(0);
});

const zero = { currentYear: 0, previousYear: 0, currentMonth: 0, previousMonth: 0 };

function stats(over: Partial<FuelStatsResponse>): FuelStatsResponse {
	return {
		fillups: zero,
		volume: zero,
		fuelConsumption: { avgEfficiency: null, bestEfficiency: null, worstEfficiency: null },
		fillupDetails: { avgVolume: null, minVolume: null, maxVolume: null },
		averageCost: {
			perFillup: null,
			bestCostPerDistance: null,
			worstCostPerDistance: null,
			avgCostPerDay: null
		},
		distance: { totalDistance: 0, avgPerDay: null, avgPerMonth: null },
		monthlyConsumption: [],
		gasPriceHistory: [],
		fillupCostByVehicle: [],
		odometerProgression: [],
		costPerDistance: [],
		units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
		...over
	};
}

const advanced = {
	maintenanceTimeline: [],
	seasonalEfficiency: [],
	vehicleRadar: [],
	dayOfWeekPatterns: [],
	monthlyCostHeatmap: [],
	fillupIntervals: []
} as unknown as FuelAdvancedResponse;

const charging: NonNullable<FuelStatsResponse['charging']> = {
	sessions: { currentYear: 3, previousYear: 1, currentMonth: 1, previousMonth: 0 },
	energy: { currentYear: 45, previousYear: 50, currentMonth: 15, previousMonth: 0 },
	efficiency: { avgEfficiency: 4, bestEfficiency: 4.5, worstEfficiency: 3.5 },
	sessionDetails: { avgEnergy: 15, minEnergy: 12, maxEnergy: 18 },
	averageCost: { perSession: 7, perEnergyUnit: 0.467 },
	priceHistory: [{ date: '2024-01-05', fuelType: 'Level 2 (AC)', pricePerVolume: 0.467 }]
};

describe('FuelStatsTab with nothing in the window', () => {
	test('with older fill-ups, says the window is 12 months and points to the expenses that are still there', async () => {
		fuelExpenseCount(3);
		render(FuelStatsTab, { fuelStats: stats({}), fuelAdvanced: advanced });
		expect(await screen.findByText('No fill-ups in the last 12 months')).toBeTruthy();
		expect(getAllExpenses).toHaveBeenCalledWith({ category: 'fuel', limit: 1 });
		expect(screen.queryByText(/No fuel data yet/)).toBeNull();
		expect(screen.getByRole('link', { name: 'View Expenses' })).toHaveAttribute(
			'href',
			'/expenses'
		);
		expect(screen.getByRole('button', { name: 'Log a Fill-up' })).toBeTruthy();
	});

	test('with no fill-up ever logged, keeps the first-run empty state', async () => {
		render(FuelStatsTab, { fuelStats: stats({}), fuelAdvanced: advanced });
		expect(await screen.findByText('No fuel data yet')).toBeTruthy();
		expect(screen.queryByText('No fill-ups in the last 12 months')).toBeNull();
		expect(screen.queryByRole('heading', { name: /fill-ups/i })).toBeNull();
		expect(screen.queryByRole('link', { name: 'View Expenses' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Log a Fill-up' })).toHaveClass('h-10');
	});

	test('shows neither empty state until the history check answers', async () => {
		getAllExpenses.mockReturnValue(new Promise(() => {}));
		render(FuelStatsTab, { fuelStats: stats({}), fuelAdvanced: advanced });
		await vi.waitFor(() => expect(getAllExpenses).toHaveBeenCalled());
		expect(screen.queryByText('No fuel data yet')).toBeNull();
		expect(screen.queryByText('No fill-ups in the last 12 months')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Log a Fill-up' })).toBeNull();
	});

	test('when the history check fails, falls back to the 12-month wording, which is always true', async () => {
		getAllExpenses.mockRejectedValue(new ApiError('boom', 500));
		render(FuelStatsTab, { fuelStats: stats({}), fuelAdvanced: advanced });
		expect(await screen.findByText('No fill-ups in the last 12 months')).toBeTruthy();
	});

	test('a fleet with fuel data in the window never asks for its history', () => {
		render(FuelStatsTab, {
			fuelStats: stats({
				fillups: { currentYear: 4, previousYear: 0, currentMonth: 0, previousMonth: 0 }
			}),
			fuelAdvanced: advanced
		});
		expect(screen.getByText('Fill-ups')).toBeTruthy();
		expect(getAllExpenses).not.toHaveBeenCalled();
	});
});

describe('FuelStatsTab charging series', () => {
	test('an EV-only fleet sees its charging cards instead of the empty state or zeroed gas cards', () => {
		render(FuelStatsTab, { fuelStats: stats({ charging }), fuelAdvanced: advanced });
		expect(screen.queryByText('No fill-ups in the last 12 months')).toBeNull();
		expect(screen.getByText('Charging Sessions')).toBeTruthy();
		expect(screen.getByText('Energy (kWh)')).toBeTruthy();
		expect(screen.getAllByText('Average mi/kWh')).toHaveLength(2);
		expect(screen.getByText('Worst mi/kWh')).toBeTruthy();
		expect(screen.getByText('Charging Details')).toBeTruthy();
		expect(screen.getByText('18.0 kWh')).toBeTruthy();
		expect(screen.getByText('$0.467')).toBeTruthy();
		expect(screen.getByText('Average Cost')).toBeTruthy();
		expect(screen.getByText('Per Session')).toBeTruthy();
		expect(screen.queryByText('Per Fill-up')).toBeNull();
		expect(screen.queryByText('Fill-ups')).toBeNull();
		expect(screen.queryByText('Fill-up Details')).toBeNull();
	});

	test('an EV-only fleet does not get empty gas-only charts', () => {
		render(FuelStatsTab, { fuelStats: stats({ charging }), fuelAdvanced: advanced });
		expect(screen.getByText('Charging Price')).toBeTruthy();
		expect(screen.queryByText('Gas Price on Fill-up')).toBeNull();
		expect(screen.queryByText('Fill-up Cost by Vehicle')).toBeNull();
		expect(screen.queryByText('Fill-up Patterns by Day of Week')).toBeNull();
		expect(screen.queryByText('Fuel Consumption')).toBeNull();
		expect(screen.getByText('Total Odometer')).toBeTruthy();
	});

	test('a plug-in hybrid fleet sees both the gas and the charging cards', () => {
		render(FuelStatsTab, {
			fuelStats: stats({
				fillups: { currentYear: 4, previousYear: 0, currentMonth: 0, previousMonth: 0 },
				charging
			}),
			fuelAdvanced: advanced
		});
		expect(screen.getByText('Fill-ups')).toBeTruthy();
		expect(screen.getByText('Charging Sessions')).toBeTruthy();
		expect(screen.getByText('Gas Price on Fill-up')).toBeTruthy();
		expect(screen.getByText('Charging Price')).toBeTruthy();
	});

	test('a gas-only fleet shows no charging cards', () => {
		render(FuelStatsTab, {
			fuelStats: stats({
				fillups: { currentYear: 4, previousYear: 0, currentMonth: 0, previousMonth: 0 },
				charging: { ...charging, sessions: zero, energy: zero }
			}),
			fuelAdvanced: advanced
		});
		expect(screen.getByText('Fill-ups')).toBeTruthy();
		expect(screen.queryByText('Charging Sessions')).toBeNull();
	});
});

describe('FuelStatsTab summary and groups', () => {
	const gas = {
		fillups: { currentYear: 4, previousYear: 0, currentMonth: 1, previousMonth: 2 },
		fuelConsumption: { avgEfficiency: 32.14, bestEfficiency: 36, worstEfficiency: 29 },
		averageCost: {
			perFillup: 35,
			bestCostPerDistance: 0.1,
			worstCostPerDistance: 0.14,
			avgCostPerDay: 5.2
		},
		distance: { totalDistance: 16000, avgPerDay: 40, avgPerMonth: 1200 }
	};

	test('leads with cost per distance, monthly fuel spend and average efficiency', () => {
		render(FuelStatsTab, { fuelStats: stats(gas), fuelAdvanced: advanced });
		expect(screen.getByText('Cost per mi')).toBeTruthy();
		expect(screen.getByText('$0.13')).toBeTruthy();
		expect(screen.getByText('Fuel spend per month')).toBeTruthy();
		expect(screen.getByText('$158.28')).toBeTruthy();
		expect(screen.getAllByText('32.1').length).toBeGreaterThan(0);
	});

	test('shows N/A in the summary when there is no daily distance to divide by', () => {
		render(FuelStatsTab, {
			fuelStats: stats({
				...gas,
				distance: { totalDistance: 0, avgPerDay: null, avgPerMonth: null }
			}),
			fuelAdvanced: advanced
		});
		expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
	});

	test('hides the Last Period row when there is nothing to compare with', () => {
		render(FuelStatsTab, { fuelStats: stats(gas), fuelAdvanced: advanced });
		expect(screen.queryByText('Last Period')).toBeNull();
		expect(screen.getAllByText('Last Month').length).toBeGreaterThan(0);
	});

	test('puts the details, patterns and comparisons in groups that start closed below lg', () => {
		const { container } = render(FuelStatsTab, { fuelStats: stats(gas), fuelAdvanced: advanced });
		const groups = [...container.querySelectorAll('details[data-slot="chart-group"]')];
		expect(groups.map(g => g.querySelector('summary span span')?.textContent)).toEqual([
			'Fill-up details',
			'Patterns',
			'Comparisons'
		]);
		expect(groups.every(g => !(g as HTMLDetailsElement).open)).toBe(true);
	});
});
