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
	YearEndResponse
} from '$lib/types';
import { apiClient } from './api-client';

/** Parameters accepted by the fuel efficiency endpoint. */
export interface FuelEfficiencyParams {
	vehicleId?: string;
}

/** Response shape returned by the fuel efficiency endpoint. */
export interface FuelEfficiencyResponse {
	fuelEfficiencyTrend: FuelEfficiencyPoint[];
}

/** Get default date range: last 12 months from now (unix timestamps in seconds). */
export function getDefaultDateRange(): { startDate: number; endDate: number } {
	const now = new Date();
	const end = Math.floor(now.getTime() / 1000);
	const start = Math.floor(
		new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime() / 1000
	);
	return { startDate: start, endDate: end };
}

/** Build a query string from optional params, prepending '?' if non-empty. */
function buildQuery(params: Record<string, string | number | undefined>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value != null) query.set(key, String(value));
	}
	const qs = query.toString();
	return qs ? `?${qs}` : '';
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
	}
};
