import type {
	FuelEfficiencyPoint,
	QuickStatsResponse,
	FuelStatsResponse,
	FuelAdvancedResponse,
	CrossVehicleResponse,
	FinancingResponse,
	InsuranceResponse,
	VehicleHealthResponse,
	VehicleTCOResponse,
	VehicleExpensesResponse,
	YearEndResponse,
	AnalyticsSummaryResponse
} from '$lib/types';
import { ApiError } from '$lib/utils/error-handling';
import { apiClient } from './api-client';
import { buildQueryString } from './api-utils';

/** Parameters accepted by the fuel efficiency endpoint. */
interface FuelEfficiencyParams {
	vehicleId?: string;
}

/** Response shape returned by the fuel efficiency endpoint. */
interface FuelEfficiencyResponse {
	fuelEfficiencyTrend: FuelEfficiencyPoint[];
}

/**
 * Default analytics window: the twelve local calendar months ending with TODAY, as unix seconds.
 *
 * Both bounds are LOCAL midnights, never the current instant. A date-only expense is stored
 * anchored at NOON local (`dateOnlyToISO`) and the backend's upper bound is exclusive
 * (`date < end`), so an end bound at "now" puts everything dated today in the FUTURE until the
 * clock passes noon — a fill-up logged at 08:00 would be missing from every chart and total on the
 * page. Ending at the start of TOMORROW covers the whole local day whatever time-of-day a row is
 * anchored at. Same exclusive-day-after bound the list filter uses.
 */
export function getDefaultDateRange(): { startDate: number; endDate: number } {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth();
	const day = now.getDate();
	// Day/month overflow is normalized by the Date constructor, so day + 1 is rollover-safe.
	const start = Math.floor(new Date(year - 1, month, day).getTime() / 1000);
	const end = Math.floor(new Date(year, month, day + 1).getTime() / 1000);
	return { startDate: start, endDate: end };
}

/** Build a query string from optional params, prepending '?' if non-empty. */
function buildQuery(params: Record<string, string | number | undefined>): string {
	return buildQueryString(params);
}

/**
 * Analytics API service
 * Centralized API calls for analytics-related operations
 */
export const analyticsApi = {
	async getFuelEfficiency(params?: FuelEfficiencyParams): Promise<FuelEfficiencyResponse> {
		return apiClient.get<FuelEfficiencyResponse>(
			`/api/v1/analytics/fuel-efficiency${buildQuery({ vehicleId: params?.vehicleId })}`
		);
	},

	async getQuickStats(params: { startDate: number; endDate: number }): Promise<QuickStatsResponse> {
		return apiClient.get<QuickStatsResponse>(
			`/api/v1/analytics/quick-stats${buildQuery({ startDate: params.startDate, endDate: params.endDate })}`
		);
	},

	async getFuelStats(params: {
		startDate: number;
		endDate: number;
		vehicleId?: string;
	}): Promise<FuelStatsResponse> {
		return apiClient.get<FuelStatsResponse>(
			`/api/v1/analytics/fuel-stats${buildQuery({ startDate: params.startDate, endDate: params.endDate, vehicleId: params.vehicleId })}`
		);
	},

	async getFuelAdvanced(params: {
		startDate: number;
		endDate: number;
		vehicleId?: string;
	}): Promise<FuelAdvancedResponse> {
		return apiClient.get<FuelAdvancedResponse>(
			`/api/v1/analytics/fuel-advanced${buildQuery({ startDate: params.startDate, endDate: params.endDate, vehicleId: params.vehicleId })}`
		);
	},

	async getCrossVehicle(params: {
		startDate: number;
		endDate: number;
	}): Promise<CrossVehicleResponse> {
		return apiClient.get<CrossVehicleResponse>(
			`/api/v1/analytics/cross-vehicle${buildQuery({ startDate: params.startDate, endDate: params.endDate })}`
		);
	},

	async getFinancing(): Promise<FinancingResponse> {
		return apiClient.get<FinancingResponse>('/api/v1/analytics/financing');
	},

	async getInsurance(): Promise<InsuranceResponse> {
		return apiClient.get<InsuranceResponse>('/api/v1/analytics/insurance');
	},

	async getVehicleHealth(vehicleId: string): Promise<VehicleHealthResponse> {
		return apiClient.get<VehicleHealthResponse>(
			`/api/v1/analytics/vehicle-health${buildQuery({ vehicleId })}`
		);
	},

	async getVehicleTCO(vehicleId: string, params?: { year?: number }): Promise<VehicleTCOResponse> {
		return apiClient.get<VehicleTCOResponse>(
			`/api/v1/analytics/vehicle-tco${buildQuery({ vehicleId, year: params?.year })}`
		);
	},

	async getVehicleExpenses(
		vehicleId: string,
		params: { startDate: number; endDate: number }
	): Promise<VehicleExpensesResponse> {
		return apiClient.get<VehicleExpensesResponse>(
			`/api/v1/analytics/vehicle-expenses${buildQuery({ vehicleId, startDate: params.startDate, endDate: params.endDate })}`
		);
	},

	async getYearEnd(params?: { year?: number }): Promise<YearEndResponse> {
		return apiClient.get<YearEndResponse>(
			`/api/v1/analytics/year-end${buildQuery({ year: params?.year })}`
		);
	},

	async getSummary(params: {
		startDate: number;
		endDate: number;
	}): Promise<AnalyticsSummaryResponse> {
		try {
			return await apiClient.get<AnalyticsSummaryResponse>(
				`/api/v1/analytics/summary${buildQuery({ startDate: params.startDate, endDate: params.endDate })}`
			);
		} catch (error: unknown) {
			// Only fall back to individual endpoints for 404 (endpoint not deployed yet)
			// or network errors. Other errors (401, 500, etc.) should propagate.
			const is404 = error instanceof ApiError && error.statusCode === 404;
			const isNetworkError = error instanceof TypeError;
			if (!is404 && !isNetworkError) throw error;

			const [quickStats, fuelStats, fuelAdvanced] = await Promise.all([
				analyticsApi.getQuickStats(params),
				analyticsApi.getFuelStats(params),
				analyticsApi.getFuelAdvanced(params)
			]);
			return { quickStats, fuelStats, fuelAdvanced };
		}
	}
};
