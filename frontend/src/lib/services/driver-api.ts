import type { Driver } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
import { apiClient } from './api-client';

export const driverApi = {
	async list(vehicleId: string): Promise<Driver[] | null> {
		try {
			return await apiClient.get<Driver[]>(`/vehicles/${vehicleId}/drivers`);
		} catch (error) {
			const status = error instanceof ApiError ? error.statusCode : undefined;
			if (status === 403 || status === 404) return null;
			throw error;
		}
	},

	async setCarShare(vehicleId: string, enabled: boolean): Promise<{ drivers: Driver[] }> {
		return apiClient.put(`/vehicles/${vehicleId}/car-share`, { enabled });
	},

	async addGuest(vehicleId: string, name: string): Promise<Driver> {
		return apiClient.post<Driver>(`/vehicles/${vehicleId}/drivers`, { name });
	},

	async update(
		vehicleId: string,
		driverId: string,
		changes: { name?: string; archived?: boolean }
	): Promise<Driver> {
		return apiClient.patch<Driver>(`/vehicles/${vehicleId}/drivers/${driverId}`, changes);
	}
};
