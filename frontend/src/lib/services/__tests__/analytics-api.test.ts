import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
	QuickStatsResponse,
	FuelStatsResponse,
	FuelAdvancedResponse,
	AnalyticsSummaryResponse
} from '$lib/types';
import { ApiError } from '$lib/utils/error-handling';

// Mock apiClient
vi.mock('../api-client', () => ({
	apiClient: {
		get: vi.fn()
	}
}));

// Import after mock setup
const { apiClient } = await import('../api-client');
const { analyticsApi, getDefaultDateRange } = await import('../analytics-api');

const mockGet = vi.mocked(apiClient.get);

const mockQuickStats: QuickStatsResponse = {
	vehicleCount: 3,
	ytdSpending: 4500.5,
	avgEfficiency: 28.3,
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
		expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/api/v1/analytics/summary'));
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

		// Summary call + 3 individual fallback calls
		expect(mockGet).toHaveBeenCalledTimes(4);
		expect(mockGet).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('/api/v1/analytics/summary')
		);
		expect(mockGet).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('/api/v1/analytics/quick-stats')
		);
		expect(mockGet).toHaveBeenNthCalledWith(
			3,
			expect.stringContaining('/api/v1/analytics/fuel-stats')
		);
		expect(mockGet).toHaveBeenNthCalledWith(
			4,
			expect.stringContaining('/api/v1/analytics/fuel-advanced')
		);
		expect(result).toEqual(mockSummaryResponse);
	});

	it('falls back to individual endpoints on network error', async () => {
		mockGet
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce(mockQuickStats)
			.mockResolvedValueOnce(mockFuelStats)
			.mockResolvedValueOnce(mockFuelAdvanced);

		const result = await analyticsApi.getSummary(dateParams);

		expect(mockGet).toHaveBeenCalledTimes(4);
		expect(result).toEqual(mockSummaryResponse);
	});

	it('re-throws non-404 API errors instead of falling back', async () => {
		mockGet.mockRejectedValueOnce(new ApiError('Server unavailable', 503));

		await expect(analyticsApi.getSummary(dateParams)).rejects.toThrow('Server unavailable');
		expect(mockGet).toHaveBeenCalledTimes(1);
	});

	it('fallback produces the same AnalyticsSummaryResponse shape as direct call', async () => {
		// Direct success path
		mockGet.mockResolvedValueOnce(mockSummaryResponse);
		const directResult = await analyticsApi.getSummary(dateParams);

		vi.clearAllMocks();

		// Fallback path (404 triggers fallback)
		mockGet
			.mockRejectedValueOnce(new ApiError('Not Found', 404))
			.mockResolvedValueOnce(mockQuickStats)
			.mockResolvedValueOnce(mockFuelStats)
			.mockResolvedValueOnce(mockFuelAdvanced);
		const fallbackResult = await analyticsApi.getSummary(dateParams);

		// Both paths produce identical shape and data
		expect(Object.keys(fallbackResult).sort()).toEqual(Object.keys(directResult).sort());
		expect(fallbackResult).toEqual(directResult);
		expect(fallbackResult.quickStats).toBeDefined();
		expect(fallbackResult.fuelStats).toBeDefined();
		expect(fallbackResult.fuelAdvanced).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// getDefaultDateRange — the last-12-months window every analytics page seeds with (C212).
// Pure, exported, previously untested; a regression in the offset would skew every analytics query.
// ---------------------------------------------------------------------------
describe('getDefaultDateRange', () => {
	it('returns unix-SECONDS (not ms) — both bounds are ~10-digit, not ~13', () => {
		const { startDate, endDate } = getDefaultDateRange();
		// seconds since epoch are ~1.7e9 (10 digits); ms would be ~1.7e12 (13). Guards the /1000.
		expect(endDate).toBeLessThan(1e12);
		expect(startDate).toBeLessThan(1e12);
		expect(Number.isInteger(startDate)).toBe(true);
		expect(Number.isInteger(endDate)).toBe(true);
	});

	it('start is exactly one year before end (same month/day)', () => {
		const { startDate, endDate } = getDefaultDateRange();
		const start = new Date(startDate * 1000);
		const end = new Date(endDate * 1000);
		expect(end.getFullYear() - start.getFullYear()).toBe(1);
		expect(start.getMonth()).toBe(end.getMonth());
		expect(start.getDate()).toBe(end.getDate());
	});

	it('end is at/just-before now (window ends at the present, not the future)', () => {
		const nowSec = Math.floor(Date.now() / 1000);
		const { endDate } = getDefaultDateRange();
		expect(endDate).toBeLessThanOrEqual(nowSec + 2); // tiny clock slop
		expect(endDate).toBeGreaterThan(nowSec - 5);
	});
});

// ---------------------------------------------------------------------------
// Method→endpoint wiring + buildQuery (C212). The 12 thin wrappers the getSummary-only suite left
// uncovered (the ~36% func gap). Mock apiClient, assert the EXACT path + query, and that the wrapper
// returns the apiClient result verbatim (apiClient.get already unwraps the {success,data} envelope).
// ---------------------------------------------------------------------------
describe('analyticsApi — method→endpoint wiring', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGet.mockResolvedValue({} as never);
	});

	/** The single URL string a wrapper passed to apiClient.get. */
	function calledUrl(): string {
		return mockGet.mock.calls[0]?.[0] as string;
	}

	it('getFuelEfficiency: no vehicleId → bare path (buildQuery emits no "?")', async () => {
		await analyticsApi.getFuelEfficiency();
		expect(calledUrl()).toBe('/api/v1/analytics/fuel-efficiency');
	});

	it('getFuelEfficiency: a vehicleId is appended as a query param', async () => {
		await analyticsApi.getFuelEfficiency({ vehicleId: 'veh-1' });
		expect(calledUrl()).toBe('/api/v1/analytics/fuel-efficiency?vehicleId=veh-1');
	});

	it('getQuickStats: serializes startDate + endDate', async () => {
		await analyticsApi.getQuickStats(dateParams);
		const url = calledUrl();
		expect(url).toContain('/api/v1/analytics/quick-stats?');
		expect(url).toContain('startDate=1700000000');
		expect(url).toContain('endDate=1710000000');
	});

	it('getFuelStats: omits an undefined vehicleId but keeps the dates', async () => {
		await analyticsApi.getFuelStats(dateParams);
		const url = calledUrl();
		expect(url).toContain('/api/v1/analytics/fuel-stats?');
		expect(url).not.toContain('vehicleId');
	});

	it('getFuelStats: includes a provided vehicleId', async () => {
		await analyticsApi.getFuelStats({ ...dateParams, vehicleId: 'veh-9' });
		expect(calledUrl()).toContain('vehicleId=veh-9');
	});

	it('getFuelAdvanced: hits the fuel-advanced endpoint', async () => {
		await analyticsApi.getFuelAdvanced(dateParams);
		expect(calledUrl()).toContain('/api/v1/analytics/fuel-advanced?');
	});

	it('getCrossVehicle: hits the cross-vehicle endpoint', async () => {
		await analyticsApi.getCrossVehicle(dateParams);
		expect(calledUrl()).toContain('/api/v1/analytics/cross-vehicle?');
	});

	it('getFinancing: bare path, no query', async () => {
		await analyticsApi.getFinancing();
		expect(calledUrl()).toBe('/api/v1/analytics/financing');
	});

	it('getInsurance: bare path, no query', async () => {
		await analyticsApi.getInsurance();
		expect(calledUrl()).toBe('/api/v1/analytics/insurance');
	});

	it('getVehicleHealth: appends the vehicleId', async () => {
		await analyticsApi.getVehicleHealth('veh-2');
		expect(calledUrl()).toBe('/api/v1/analytics/vehicle-health?vehicleId=veh-2');
	});

	it('getVehicleTCO: vehicleId only when no year', async () => {
		await analyticsApi.getVehicleTCO('veh-3');
		const url = calledUrl();
		expect(url).toContain('/api/v1/analytics/vehicle-tco?vehicleId=veh-3');
		expect(url).not.toContain('year');
	});

	it('getVehicleTCO: includes year when provided', async () => {
		await analyticsApi.getVehicleTCO('veh-3', { year: 2024 });
		expect(calledUrl()).toContain('year=2024');
	});

	it('getVehicleExpenses: serializes vehicleId + date range', async () => {
		await analyticsApi.getVehicleExpenses('veh-4', dateParams);
		const url = calledUrl();
		expect(url).toContain('/api/v1/analytics/vehicle-expenses?');
		expect(url).toContain('vehicleId=veh-4');
		expect(url).toContain('startDate=1700000000');
	});

	it('getYearEnd: no year → bare path (no "?")', async () => {
		await analyticsApi.getYearEnd();
		expect(calledUrl()).toBe('/api/v1/analytics/year-end');
	});

	it('getYearEnd: includes a provided year', async () => {
		await analyticsApi.getYearEnd({ year: 2023 });
		expect(calledUrl()).toBe('/api/v1/analytics/year-end?year=2023');
	});

	it('a wrapper returns the apiClient result verbatim (envelope already unwrapped)', async () => {
		mockGet.mockResolvedValueOnce(mockQuickStats as never);
		const result = await analyticsApi.getQuickStats(dateParams);
		expect(result).toBe(mockQuickStats);
	});
});
