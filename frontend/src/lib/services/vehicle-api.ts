import type { Vehicle, VehicleStats, ApiResponse } from '$lib/types';
import type { TimePeriod } from '$lib/constants/time-periods';
import { ApiError, handleApiError } from '$lib/utils/error-handling';

/**
 * Vehicle API service
 * Centralized API calls for vehicle-related operations
 */
export const vehicleApi = {
	/**
	 * Fetch a single vehicle by ID
	 * @throws {ApiError} If the request fails
	 */
	async getVehicle(vehicleId: string): Promise<Vehicle> {
		try {
			const response = await fetch(`/api/vehicles/${vehicleId}`, {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new ApiError('Vehicle not found', response.status);
			}

			const result: ApiResponse<Vehicle> = await response.json();
			return result.data || (result as unknown as Vehicle);
		} catch (error) {
			throw handleApiError(error, 'Failed to load vehicle');
		}
	},

	/**
	 * Fetch all vehicles for the current user
	 * @throws {ApiError} If the request fails
	 */
	async getVehicles(): Promise<Vehicle[]> {
		try {
			const response = await fetch('/api/vehicles', {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new ApiError('Failed to load vehicles', response.status);
			}

			const result: ApiResponse<Vehicle[]> = await response.json();
			return result.data || [];
		} catch (error) {
			throw handleApiError(error, 'Failed to load vehicles');
		}
	},

	/**
	 * Fetch vehicle statistics for a given period
	 * @throws {ApiError} If the request fails
	 */
	async getVehicleStats(vehicleId: string, period: TimePeriod): Promise<VehicleStats> {
		try {
			const response = await fetch(`/api/vehicles/${vehicleId}/stats?period=${period}`, {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new ApiError('Failed to load vehicle statistics', response.status);
			}

			const result: ApiResponse<VehicleStats> = await response.json();
			if (!result.data) {
				throw new ApiError('Invalid response format', 500);
			}
			return result.data;
		} catch (error) {
			throw handleApiError(error, 'Failed to load vehicle statistics');
		}
	},

	/**
	 * Delete a vehicle
	 * @throws {ApiError} If the request fails
	 */
	async deleteVehicle(vehicleId: string): Promise<void> {
		try {
			const response = await fetch(`/api/vehicles/${vehicleId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!response.ok) {
				const result = await response.json();
				throw new ApiError(result.message || 'Failed to delete vehicle', response.status);
			}
		} catch (error) {
			throw handleApiError(error, 'Failed to delete vehicle');
		}
	}
};
