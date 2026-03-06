import type { Photo, Vehicle, VehicleFinancing, VehicleStats } from '$lib/types';
import type { TimePeriod } from '$lib/constants/time-periods';
import { apiClient, getApiBaseUrl } from './api-client';

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

	async createVehicle(data: Partial<Vehicle>): Promise<Vehicle> {
		return apiClient.post<Vehicle>('/api/v1/vehicles', data);
	},

	async updateVehicle(vehicleId: string, data: Partial<Vehicle>): Promise<Vehicle> {
		return apiClient.put<Vehicle>(`/api/v1/vehicles/${vehicleId}`, data);
	},

	async getVehicleStats(vehicleId: string, period: TimePeriod): Promise<VehicleStats> {
		return apiClient.get<VehicleStats>(`/api/v1/vehicles/${vehicleId}/stats?period=${period}`);
	},

	async deleteVehicle(vehicleId: string): Promise<void> {
		await apiClient.delete('/api/v1/vehicles/' + vehicleId);
	},

	async getFinancing(vehicleId: string): Promise<VehicleFinancing | null> {
		try {
			return await apiClient.get<VehicleFinancing>(
				`/api/v1/financing/vehicles/${vehicleId}/financing`
			);
		} catch {
			return null;
		}
	},

	async createFinancing(
		vehicleId: string,
		data: Partial<Omit<VehicleFinancing, 'id' | 'vehicleId' | 'createdAt' | 'updatedAt'>>
	): Promise<VehicleFinancing> {
		return apiClient.post<VehicleFinancing>(
			`/api/v1/financing/vehicles/${vehicleId}/financing`,
			data
		);
	},

	async updatePaymentAmount(financingId: string, paymentAmount: number): Promise<VehicleFinancing> {
		return apiClient.patch<VehicleFinancing>(`/api/v1/financing/${financingId}/payment-amount`, {
			paymentAmount
		});
	},

	async deleteFinancing(financingId: string): Promise<void> {
		await apiClient.delete(`/api/v1/financing/${financingId}`);
	},

	async getPhotos(vehicleId: string): Promise<Photo[]> {
		return apiClient.get<Photo[]>(`/api/v1/vehicles/${vehicleId}/photos`);
	},

	async uploadPhoto(vehicleId: string, file: File): Promise<Photo> {
		const formData = new FormData();
		formData.append('photo', file);
		return apiClient.post<Photo>(`/api/v1/vehicles/${vehicleId}/photos`, formData);
	},

	async setCoverPhoto(vehicleId: string, photoId: string): Promise<Photo> {
		return apiClient.put<Photo>(`/api/v1/vehicles/${vehicleId}/photos/${photoId}/cover`);
	},

	async deletePhoto(vehicleId: string, photoId: string): Promise<void> {
		await apiClient.delete(`/api/v1/vehicles/${vehicleId}/photos/${photoId}`);
	},

	getPhotoThumbnailUrl(vehicleId: string, photoId: string): string {
		return `${getApiBaseUrl()}/api/v1/vehicles/${vehicleId}/photos/${photoId}/thumbnail`;
	}
};
