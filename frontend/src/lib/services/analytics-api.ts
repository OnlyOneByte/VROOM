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
} from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
import { apiClient } from './api-client';
import { NetworkError } from '#lib/utils/error-handling.ts';
import { buildQueryString } from './api-utils';

interface FuelEfficiencyParams {
	vehicleId?: string;
}

interface FuelEfficiencyResponse {
	fuelEfficiencyTrend: FuelEfficiencyPoint[];
}

export function getDefaultDateRange(): { startDate: number; endDate: number } {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth();
	const day = now.getDate();
	const start = Math.floor(new Date(year - 1, month, day).getTime() / 1000);
	const end = Math.floor(new Date(year, month, day + 1).getTime() / 1000);
	return { startDate: start, endDate: end };
}

export const analyticsApi = {
	async getFuelEfficiency(params?: FuelEfficiencyParams): Promise<FuelEfficiencyResponse> {
		return apiClient.get<FuelEfficiencyResponse>(
			`/api/v1/analytics/fuel-efficiency${buildQueryString({ vehicleId: params?.vehicleId })}`
		);
	},

	async getQuickStats(params: { startDate: number; endDate: number }): Promise<QuickStatsResponse> {
		return apiClient.get<QuickStatsResponse>(
			`/api/v1/analytics/quick-stats${buildQueryString({ startDate: params.startDate, endDate: params.endDate })}`
		);
	},

	async getFuelStats(params: {
		startDate: number;
		endDate: number;
		vehicleId?: string;
	}): Promise<FuelStatsResponse> {
		return apiClient.get<FuelStatsResponse>(
			`/api/v1/analytics/fuel-stats${buildQueryString({ startDate: params.startDate, endDate: params.endDate, vehicleId: params.vehicleId })}`
		);
	},

	async getFuelAdvanced(params: {
		startDate: number;
		endDate: number;
		vehicleId?: string;
	}): Promise<FuelAdvancedResponse> {
		return apiClient.get<FuelAdvancedResponse>(
			`/api/v1/analytics/fuel-advanced${buildQueryString({ startDate: params.startDate, endDate: params.endDate, vehicleId: params.vehicleId })}`
		);
	},

	async getCrossVehicle(params: {
		startDate: number;
		endDate: number;
	}): Promise<CrossVehicleResponse> {
		return apiClient.get<CrossVehicleResponse>(
			`/api/v1/analytics/cross-vehicle${buildQueryString({ startDate: params.startDate, endDate: params.endDate })}`
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
			`/api/v1/analytics/vehicle-health${buildQueryString({ vehicleId })}`
		);
	},

	async getVehicleTCO(vehicleId: string, params?: { year?: number }): Promise<VehicleTCOResponse> {
		return apiClient.get<VehicleTCOResponse>(
			`/api/v1/analytics/vehicle-tco${buildQueryString({ vehicleId, year: params?.year })}`
		);
	},

	async getVehicleExpenses(
		vehicleId: string,
		params: { startDate: number; endDate: number }
	): Promise<VehicleExpensesResponse> {
		return apiClient.get<VehicleExpensesResponse>(
			`/api/v1/analytics/vehicle-expenses${buildQueryString({ vehicleId, startDate: params.startDate, endDate: params.endDate })}`
		);
	},

	async getYearEnd(params?: { year?: number }): Promise<YearEndResponse> {
		return apiClient.get<YearEndResponse>(
			`/api/v1/analytics/year-end${buildQueryString({ year: params?.year })}`
		);
	},

	async getSummary(params: {
		startDate: number;
		endDate: number;
	}): Promise<AnalyticsSummaryResponse> {
		try {
			return await apiClient.get<AnalyticsSummaryResponse>(
				`/api/v1/analytics/summary${buildQueryString({ startDate: params.startDate, endDate: params.endDate })}`
			);
		} catch (error: unknown) {
			const is404 = error instanceof ApiError && error.statusCode === 404;
			if (!is404 && !(error instanceof NetworkError)) throw error;

			const [quickStats, fuelStats, fuelAdvanced] = await Promise.all([
				analyticsApi.getQuickStats(params),
				analyticsApi.getFuelStats(params),
				analyticsApi.getFuelAdvanced(params)
			]);
			return { quickStats, fuelStats, fuelAdvanced };
		}
	}
};
