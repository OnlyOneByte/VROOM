import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type {
	QuickStatsResponse,
	FuelStatsResponse,
	FuelAdvancedResponse,
	AnalyticsSummaryResponse
} from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
import { dateOnlyToISO, toDateInputValue } from '#lib/utils/formatters.ts';

vi.mock('../api-client', async importOriginal => ({
	...(await importOriginal<typeof import('../api-client')>()),
	apiClient: {
		get: vi.fn()
	}
}));

const { apiClient } = await import('../api-client');
const { NetworkError } = await import('#lib/utils/error-handling.ts');
const { analyticsApi, getDefaultDateRange } = await import('../analytics-api');

const mockGet = vi.mocked(apiClient.get);
const ZONE = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);

const mockQuickStats: QuickStatsResponse = {
	vehicleCount: 3,
	ytdSpending: 4500.5,
	avgEfficiency: 28.3,
	costPerDistance: 0.21,
	fleetHealthScore: 85,
	units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
};

const mockFuelStats: FuelStatsResponse = {
	fillups: { currentYear: 48, previousYear: 52, currentMonth: 4, previousMonth: 5 },
	volume: { currentYear: 600, previousYear: 650, currentMonth: 50, previousMonth: 55 },
	fuelConsumption: { avgEfficiency: 28.3, bestEfficiency: 35.1, worstEfficiency: 22.0 },
	fillupDetails: { avgVolume: 12.5, minVolume: 8.0, maxVolume: 18.0 },
	averageCost: {
		perFillup: 45.0,
		bestCostPerDistance: 0.08,
		worstCostPerDistance: 0.15,
		avgCostPerDay: 12.3
	},
	distance: { totalDistance: 17000, avgPerDay: 46.6, avgPerMonth: 1416.7 },
	monthlyConsumption: [{ month: '2024-01', efficiency: 28.5, volume: 50 }],
	gasPriceHistory: [{ date: '2024-01-15', fuelType: '87 (Regular)', pricePerVolume: 3.45 }],
	fillupCostByVehicle: [{ month: '2024-01', vehicleId: 'v1', vehicleName: 'Civic', avgCost: 42.0 }],
	odometerProgression: [
		{ month: '2024-01', vehicleId: 'v1', vehicleName: 'Civic', mileage: 55000 }
	],
	costPerDistance: [
		{ month: '2024-01', vehicleId: 'v1', vehicleName: 'Civic', costPerDistance: 0.1 }
	]
};

const mockFuelAdvanced: FuelAdvancedResponse = {
	maintenanceTimeline: [
		{
			vehicleId: 'v1',
			vehicleName: 'Civic',
			service: 'Oil Change',
			lastServiceDate: '2024-01-15',
			nextDueDate: '2024-07-15',
			daysRemaining: 120,
			status: 'good'
		}
	],
	seasonalEfficiency: [{ season: 'Winter', avgEfficiency: 26.0, fillupCount: 12 }],
	vehicleRadar: [
		{
			vehicleId: 'v1',
			vehicleName: 'Civic',
			fuelEfficiency: 80,
			maintenanceCost: 60,
			reliability: 90,
			annualCost: 70,
			mileage: 75
		}
	],
	dayOfWeekPatterns: [{ day: 'Monday', fillupCount: 8, avgCost: 44.0, avgVolume: 12.0 }],
	monthlyCostHeatmap: [
		{
			month: '2024-01',
			fuel: 200,
			maintenance: 50,
			financial: 300,
			regulatory: 25,
			enhancement: 0,
			misc: 10
		}
	],
	fillupIntervals: [{ intervalLabel: '5-7 days', count: 15 }]
};

const mockSummaryResponse: AnalyticsSummaryResponse = {
	quickStats: mockQuickStats,
	fuelStats: mockFuelStats,
	fuelAdvanced: mockFuelAdvanced
};

const dateParams = { startDate: 1700000000, endDate: 1710000000 };

describe('analyticsApi.getSummary()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns combined data when summary endpoint succeeds', async () => {
		mockGet.mockResolvedValueOnce(mockSummaryResponse);

		const result = await analyticsApi.getSummary(dateParams);

		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/analytics/summary'));
		expect(result).toEqual(mockSummaryResponse);
		expect(result.quickStats).toEqual(mockQuickStats);
		expect(result.fuelStats).toEqual(mockFuelStats);
		expect(result.fuelAdvanced).toEqual(mockFuelAdvanced);
	});

	it('falls back to individual endpoints on 404 error', async () => {
		mockGet
			.mockRejectedValueOnce(new ApiError('Not Found', 404))
			.mockResolvedValueOnce(mockQuickStats)
			.mockResolvedValueOnce(mockFuelStats)
			.mockResolvedValueOnce(mockFuelAdvanced);

		const result = await analyticsApi.getSummary(dateParams);

		expect(mockGet).toHaveBeenCalledTimes(4);
		expect(mockGet).toHaveBeenNthCalledWith(1, expect.stringContaining('/analytics/summary'));
		expect(mockGet).toHaveBeenNthCalledWith(2, expect.stringContaining('/analytics/quick-stats'));
		expect(mockGet).toHaveBeenNthCalledWith(3, expect.stringContaining('/analytics/fuel-stats'));
		expect(mockGet).toHaveBeenNthCalledWith(4, expect.stringContaining('/analytics/fuel-advanced'));
		expect(result).toEqual(mockSummaryResponse);
	});

	it('falls back to individual endpoints on network error', async () => {
		mockGet
			.mockRejectedValueOnce(new NetworkError(new TypeError('Load failed')))
			.mockResolvedValueOnce(mockQuickStats)
			.mockResolvedValueOnce(mockFuelStats)
			.mockResolvedValueOnce(mockFuelAdvanced);

		const result = await analyticsApi.getSummary(dateParams);

		expect(mockGet).toHaveBeenCalledTimes(4);
		expect(result).toEqual(mockSummaryResponse);
	});

	it('re-throws a TypeError that is not a network failure instead of falling back', async () => {
		const bug = new TypeError("Cannot read properties of undefined (reading 'quickStats')");
		mockGet.mockRejectedValueOnce(bug);

		await expect(analyticsApi.getSummary(dateParams)).rejects.toBe(bug);
		expect(mockGet).toHaveBeenCalledTimes(1);
	});

	it('re-throws non-404 API errors instead of falling back', async () => {
		mockGet.mockRejectedValueOnce(new ApiError('Server unavailable', 503));

		await expect(analyticsApi.getSummary(dateParams)).rejects.toThrow('Server unavailable');
		expect(mockGet).toHaveBeenCalledTimes(1);
	});

	it('fallback produces the same AnalyticsSummaryResponse shape as direct call', async () => {
		mockGet.mockResolvedValueOnce(mockSummaryResponse);
		const directResult = await analyticsApi.getSummary(dateParams);

		vi.clearAllMocks();

		mockGet
			.mockRejectedValueOnce(new ApiError('Not Found', 404))
			.mockResolvedValueOnce(mockQuickStats)
			.mockResolvedValueOnce(mockFuelStats)
			.mockResolvedValueOnce(mockFuelAdvanced);
		const fallbackResult = await analyticsApi.getSummary(dateParams);

		expect(Object.keys(fallbackResult).sort()).toEqual(Object.keys(directResult).sort());
		expect(fallbackResult).toEqual(directResult);
		expect(fallbackResult.quickStats).toBeDefined();
		expect(fallbackResult.fuelStats).toBeDefined();
		expect(fallbackResult.fuelAdvanced).toBeDefined();
	});
});

describe('getDefaultDateRange', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function freezeLocal(hour: number, minute = 0): Date {
		const at = new Date(2026, 4, 14, hour, minute, 30, 123);
		vi.useFakeTimers();
		vi.setSystemTime(at);
		return at;
	}

	it('ytdStart is local midnight on Jan 1 of the current local year', () => {
		const now = new Date(2026, 11, 31, 22, 15);
		expect(new Date(getDefaultDateRange(now).ytdStart * 1000)).toEqual(new Date(2026, 0, 1));
	});

	it('every analytics request sends the browser time zone', async () => {
		mockGet.mockResolvedValue({});
		const range = { startDate: 1, endDate: 2 };
		await analyticsApi.getQuickStats(range);
		await analyticsApi.getFuelStats(range);
		await analyticsApi.getFuelAdvanced(range);
		await analyticsApi.getCrossVehicle(range);
		await analyticsApi.getFinancing();
		await analyticsApi.getInsurance();
		await analyticsApi.getVehicleTCO('v1');
		await analyticsApi.getVehicleExpenses('v1', range);
		await analyticsApi.getYearEnd();
		await analyticsApi.getVehicleHealth('v1');
		for (const [url] of mockGet.mock.calls.slice(-10)) {
			expect(url).toContain(`timeZone=${ZONE}`);
		}
	});

	it('getSummary and getQuickStats pass ytdStart to the API', async () => {
		mockGet.mockResolvedValue(mockQuickStats);
		await analyticsApi.getQuickStats({ startDate: 1, endDate: 2, ytdStart: 3 });
		expect(mockGet).toHaveBeenLastCalledWith(expect.stringContaining('ytdStart=3'));
		mockGet.mockResolvedValue(mockSummaryResponse);
		await analyticsApi.getSummary({ startDate: 1, endDate: 2, ytdStart: 3 });
		expect(mockGet).toHaveBeenLastCalledWith(expect.stringContaining('ytdStart=3'));
	});

	it('returns unix-SECONDS (not ms) — both bounds are ~10-digit, not ~13', () => {
		const { startDate, endDate } = getDefaultDateRange();
		expect(endDate).toBeLessThan(1e12);
		expect(startDate).toBeLessThan(1e12);
		expect(Number.isInteger(startDate)).toBe(true);
		expect(Number.isInteger(endDate)).toBe(true);
	});

	it('spans one year of local calendar days: [local midnight a year ago, local midnight tomorrow)', () => {
		const now = freezeLocal(8);
		const { startDate, endDate } = getDefaultDateRange();
		expect(new Date(startDate * 1000)).toEqual(
			new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
		);
		expect(new Date(endDate * 1000)).toEqual(
			new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
		);
	});

	for (const hour of [0, 8, 11, 12, 13, 23]) {
		it(`includes an expense dated today when the local clock reads ${String(hour).padStart(2, '0')}:00`, () => {
			const now = freezeLocal(hour);
			const { startDate, endDate } = getDefaultDateRange();
			const storedSec = new Date(dateOnlyToISO(toDateInputValue(now))).getTime() / 1000;

			expect(storedSec).toBeGreaterThanOrEqual(startDate);
			expect(storedSec).toBeLessThan(endDate);
		});
	}

	it('excludes an expense dated tomorrow (the window stops at the end of today)', () => {
		const now = freezeLocal(8);
		const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
		const { endDate } = getDefaultDateRange();
		const storedSec = new Date(dateOnlyToISO(toDateInputValue(tomorrow))).getTime() / 1000;

		expect(storedSec).toBeGreaterThanOrEqual(endDate);
	});

	it('includes an expense dated the first day of the window, excludes the day before it', () => {
		const now = freezeLocal(8);
		const { startDate } = getDefaultDateRange();
		const firstDay = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
		const dayBefore = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() - 1);

		expect(
			new Date(dateOnlyToISO(toDateInputValue(firstDay))).getTime() / 1000
		).toBeGreaterThanOrEqual(startDate);
		expect(new Date(dateOnlyToISO(toDateInputValue(dayBefore))).getTime() / 1000).toBeLessThan(
			startDate
		);
	});
});

describe('analyticsApi — method→endpoint wiring', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGet.mockResolvedValue({} as never);
	});

	function calledUrl(): string {
		return mockGet.mock.calls[0]?.[0] as string;
	}

	it('getFuelEfficiency: no vehicleId → bare path (no "?")', async () => {
		await analyticsApi.getFuelEfficiency();
		expect(calledUrl()).toBe('/analytics/fuel-efficiency');
	});

	it('getFuelEfficiency: a vehicleId is appended as a query param', async () => {
		await analyticsApi.getFuelEfficiency({ vehicleId: 'veh-1' });
		expect(calledUrl()).toBe('/analytics/fuel-efficiency?vehicleId=veh-1');
	});

	it('getQuickStats: serializes startDate + endDate', async () => {
		await analyticsApi.getQuickStats(dateParams);
		const url = calledUrl();
		expect(url).toContain('/analytics/quick-stats?');
		expect(url).toContain('startDate=1700000000');
		expect(url).toContain('endDate=1710000000');
	});

	it('getFuelStats: omits an undefined vehicleId but keeps the dates', async () => {
		await analyticsApi.getFuelStats(dateParams);
		const url = calledUrl();
		expect(url).toContain('/analytics/fuel-stats?');
		expect(url).not.toContain('vehicleId');
	});

	it('getFuelStats: includes a provided vehicleId', async () => {
		await analyticsApi.getFuelStats({ ...dateParams, vehicleId: 'veh-9' });
		expect(calledUrl()).toContain('vehicleId=veh-9');
	});

	it('getFuelAdvanced: hits the fuel-advanced endpoint', async () => {
		await analyticsApi.getFuelAdvanced(dateParams);
		expect(calledUrl()).toContain('/analytics/fuel-advanced?');
	});

	it('getCrossVehicle: hits the cross-vehicle endpoint', async () => {
		await analyticsApi.getCrossVehicle(dateParams);
		expect(calledUrl()).toContain('/analytics/cross-vehicle?');
	});

	it('getFinancing: only the browser time zone in the query', async () => {
		await analyticsApi.getFinancing();
		expect(calledUrl()).toBe(`/analytics/financing?timeZone=${ZONE}`);
	});

	it('getInsurance: only the browser time zone in the query', async () => {
		await analyticsApi.getInsurance();
		expect(calledUrl()).toBe(`/analytics/insurance?timeZone=${ZONE}`);
	});

	it('getVehicleHealth: appends the vehicleId and the browser time zone', async () => {
		await analyticsApi.getVehicleHealth('veh-2');
		expect(calledUrl()).toBe(`/analytics/vehicle-health?vehicleId=veh-2&timeZone=${ZONE}`);
	});

	it('getVehicleTCO: vehicleId only when no year', async () => {
		await analyticsApi.getVehicleTCO('veh-3');
		const url = calledUrl();
		expect(url).toContain('/analytics/vehicle-tco?vehicleId=veh-3');
		expect(url).not.toContain('year');
	});

	it('getVehicleTCO: includes year when provided', async () => {
		await analyticsApi.getVehicleTCO('veh-3', { year: 2024 });
		expect(calledUrl()).toContain('year=2024');
	});

	it('getVehicleExpenses: serializes vehicleId + date range', async () => {
		await analyticsApi.getVehicleExpenses('veh-4', dateParams);
		const url = calledUrl();
		expect(url).toContain('/analytics/vehicle-expenses?');
		expect(url).toContain('vehicleId=veh-4');
		expect(url).toContain('startDate=1700000000');
	});

	it('getYearEnd: no year → only the time zone', async () => {
		await analyticsApi.getYearEnd();
		expect(calledUrl()).toBe(`/analytics/year-end?timeZone=${ZONE}`);
	});

	it('getYearEnd: includes a provided year', async () => {
		await analyticsApi.getYearEnd({ year: 2023 });
		expect(calledUrl()).toBe(`/analytics/year-end?year=2023&timeZone=${ZONE}`);
	});

	it('a wrapper returns the apiClient result verbatim (envelope already unwrapped)', async () => {
		mockGet.mockResolvedValueOnce(mockQuickStats as never);
		const result = await analyticsApi.getQuickStats(dateParams);
		expect(result).toBe(mockQuickStats);
	});
});

describe('analyticsApi.query()', () => {
	beforeEach(() => mockGet.mockReset());

	it('joins list params with commas, sends the time zone and passes the abort signal', async () => {
		mockGet.mockResolvedValueOnce({} as never);
		const controller = new AbortController();
		await analyticsApi.query(
			{
				metric: 'cost',
				interval: 'month',
				groupBy: 'category',
				vehicleIds: ['a', 'b'],
				categories: ['fuel', 'maintenance'],
				start: 100,
				end: 200
			},
			{ signal: controller.signal }
		);
		expect(mockGet).toHaveBeenCalledWith(
			`/analytics/query?metric=cost&interval=month&groupBy=category&start=100&end=200&vehicleIds=a%2Cb&categories=fuel%2Cmaintenance&timeZone=${ZONE}`,
			{ signal: controller.signal }
		);
	});

	it('leaves out list params that were not given', async () => {
		mockGet.mockResolvedValueOnce({} as never);
		await analyticsApi.query({ metric: 'count' });
		expect(mockGet).toHaveBeenCalledWith(
			`/analytics/query?metric=count&timeZone=${ZONE}`,
			undefined
		);
	});
});
