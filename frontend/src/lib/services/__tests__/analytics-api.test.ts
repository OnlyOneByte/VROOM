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
const { analyticsApi } = await import('../analytics-api');

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
