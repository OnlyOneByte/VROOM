import type { FuelEfficiencyPoint } from '$lib/types';
import { apiClient } from './api-client';

/** Parameters accepted by the fuel efficiency endpoint. */
export interface FuelEfficiencyParams {
	vehicleId?: string;
}

/** Response shape returned by the fuel efficiency endpoint. */
export interface FuelEfficiencyResponse {
	fuelEfficiencyTrend: FuelEfficiencyPoint[];
}

/**
 * Analytics API service
 * Centralized API calls for analytics-related operations
 */
export const analyticsApi = {
	async getFuelEfficiency(params?: FuelEfficiencyParams): Promise<FuelEfficiencyResponse> {
		const query = new URLSearchParams();
		if (params?.vehicleId) query.set('vehicleId', params.vehicleId);
		const qs = query.toString();
		return apiClient.get<FuelEfficiencyResponse>(
			`/api/v1/analytics/fuel-efficiency${qs ? `?${qs}` : ''}`
		);
	}
};
