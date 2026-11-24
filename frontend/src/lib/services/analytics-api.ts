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
	AnalyticsSummaryResponse,
	AnalyticsQueryParams,
	AnalyticsQueryResponse,
	AnalyticsBucketItems,
	AnalyticsBucketItemsParams
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

export function userTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function getDefaultDateRange(now: Date = new Date()): {
	startDate: number;
	endDate: number;
	ytdStart: number;
} {
	const year = now.getFullYear();
	const month = now.getMonth();
	const day = now.getDate();
	const start = Math.floor(new Date(year - 1, month, day).getTime() / 1000);
	const end = Math.floor(new Date(year, month, day + 1).getTime() / 1000);
	const ytdStart = Math.floor(new Date(year, 0, 1).getTime() / 1000);
	return { startDate: start, endDate: end, ytdStart };
}

export const analyticsApi = {
	async getFuelEfficiency(params?: FuelEfficiencyParams): Promise<FuelEfficiencyResponse> {
		return apiClient.get<FuelEfficiencyResponse>(
			`/analytics/fuel-efficiency${buildQueryString({ vehicleId: params?.vehicleId })}`
		);
	},

	async getQuickStats(params: {
		startDate: number;
		endDate: number;
		ytdStart?: number;
	}): Promise<QuickStatsResponse> {
		return apiClient.get<QuickStatsResponse>(
			`/analytics/quick-stats${buildQueryString({ startDate: params.startDate, endDate: params.endDate, ytdStart: params.ytdStart, timeZone: userTimeZone() })}`
		);
	},

	async getFuelStats(params: {
		startDate: number;
		endDate: number;
		vehicleId?: string;
		vehicleIds?: string[];
	}): Promise<FuelStatsResponse> {
		return apiClient.get<FuelStatsResponse>(
			`/analytics/fuel-stats${buildQueryString({ startDate: params.startDate, endDate: params.endDate, vehicleId: params.vehicleId, vehicleIds: params.vehicleIds?.join(','), timeZone: userTimeZone() })}`
		);
	},

	async getFuelAdvanced(params: {
		startDate: number;
		endDate: number;
		vehicleId?: string;
		vehicleIds?: string[];
	}): Promise<FuelAdvancedResponse> {
		return apiClient.get<FuelAdvancedResponse>(
			`/analytics/fuel-advanced${buildQueryString({ startDate: params.startDate, endDate: params.endDate, vehicleId: params.vehicleId, vehicleIds: params.vehicleIds?.join(','), timeZone: userTimeZone() })}`
		);
	},

	async getCrossVehicle(params: {
		startDate: number;
		endDate: number;
		vehicleIds?: string[];
	}): Promise<CrossVehicleResponse> {
		return apiClient.get<CrossVehicleResponse>(
			`/analytics/cross-vehicle${buildQueryString({ startDate: params.startDate, endDate: params.endDate, vehicleIds: params.vehicleIds?.join(','), timeZone: userTimeZone() })}`
		);
	},

	async getFinancing(params?: { vehicleIds?: string[] }): Promise<FinancingResponse> {
		return apiClient.get<FinancingResponse>(
			`/analytics/financing${buildQueryString({ vehicleIds: params?.vehicleIds?.join(','), timeZone: userTimeZone() })}`
		);
	},

	async getInsurance(params?: { vehicleIds?: string[] }): Promise<InsuranceResponse> {
		return apiClient.get<InsuranceResponse>(
			`/analytics/insurance${buildQueryString({ vehicleIds: params?.vehicleIds?.join(','), timeZone: userTimeZone() })}`
		);
	},

	async getVehicleHealth(vehicleId: string): Promise<VehicleHealthResponse> {
		return apiClient.get<VehicleHealthResponse>(
			`/analytics/vehicle-health${buildQueryString({ vehicleId, timeZone: userTimeZone() })}`
		);
	},

	async getVehicleTCO(vehicleId: string, params?: { year?: number }): Promise<VehicleTCOResponse> {
		return apiClient.get<VehicleTCOResponse>(
			`/analytics/vehicle-tco${buildQueryString({ vehicleId, year: params?.year, timeZone: userTimeZone() })}`
		);
	},

	async getVehicleExpenses(
		vehicleId: string,
		params: { startDate: number; endDate: number }
	): Promise<VehicleExpensesResponse> {
		return apiClient.get<VehicleExpensesResponse>(
			`/analytics/vehicle-expenses${buildQueryString({ vehicleId, startDate: params.startDate, endDate: params.endDate, timeZone: userTimeZone() })}`
		);
	},

	async getYearEnd(params?: { year?: number }): Promise<YearEndResponse> {
		return apiClient.get<YearEndResponse>(
			`/analytics/year-end${buildQueryString({ year: params?.year, timeZone: userTimeZone() })}`
		);
	},

	async query(
		params: AnalyticsQueryParams,
		options?: { signal?: AbortSignal }
	): Promise<AnalyticsQueryResponse> {
		const { vehicleIds, categories, annotations, ...rest } = params;
		return apiClient.get<AnalyticsQueryResponse>(
			`/analytics/query${buildQueryString({ ...rest, vehicleIds: vehicleIds?.join(','), categories: categories?.join(','), annotations: annotations?.join(','), timeZone: userTimeZone() })}`,
			options
		);
	},

	async queryItems(
		params: AnalyticsBucketItemsParams,
		options?: { signal?: AbortSignal }
	): Promise<AnalyticsBucketItems> {
		const { vehicleIds, keys, ...rest } = params;
		return apiClient.get<AnalyticsBucketItems>(
			`/analytics/query/items${buildQueryString({
				...rest,
				vehicleIds: vehicleIds?.join(','),
				keys: keys ? JSON.stringify(keys) : undefined
			})}`,
			options
		);
	},

	async getSummary(params: {
		startDate: number;
		endDate: number;
		ytdStart?: number;
		vehicleIds?: string[];
	}): Promise<AnalyticsSummaryResponse> {
		try {
			return await apiClient.get<AnalyticsSummaryResponse>(
				`/analytics/summary${buildQueryString({ startDate: params.startDate, endDate: params.endDate, ytdStart: params.ytdStart, vehicleIds: params.vehicleIds?.join(','), timeZone: userTimeZone() })}`
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
