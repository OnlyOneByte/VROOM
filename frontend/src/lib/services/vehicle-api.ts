import type { Vehicle, VehicleFinancingPayment } from '$lib/types';
import type { VehicleStats } from '$lib/types';
import type { TimePeriod } from '$lib/constants/time-periods';
import { apiClient } from './api-client';

/**
 * Vehicle API service
 * Centralized API calls for vehicle-related operations
 */
export const vehicleApi = {
	async getVehicle(vehicleId: string): Promise<Vehicle> {
		return apiClient.get<Vehicle>(`/api/v1/vehicles/${vehicleId}`);
	},

	async getVehicles(): Promise<Vehicle[]> {
		return apiClient.get<Vehicle[]>('/api/v1/vehicles');
	},

	async getVehicleStats(vehicleId: string, period: TimePeriod): Promise<VehicleStats> {
		return apiClient.get<VehicleStats>(`/api/v1/vehicles/${vehicleId}/stats?period=${period}`);
	},

	async deleteVehicle(vehicleId: string): Promise<void> {
		await apiClient.delete('/api/v1/vehicles/' + vehicleId);
	},

	async getFinancingPayments(vehicleId: string): Promise<VehicleFinancingPayment[]> {
		return apiClient.get<VehicleFinancingPayment[]>(
			`/api/v1/vehicles/${vehicleId}/financing/payments`
		);
	}
};
