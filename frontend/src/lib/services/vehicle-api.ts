import type {
	PaginatedResponse,
	Photo,
	UpdateVehicleRequest,
	Vehicle,
	VehicleFinancing,
	VehicleStats
} from '$lib/types';
import type { TimePeriod } from '$lib/constants/time-periods';
import { apiClient } from './api-client';
import { photoCollection } from './photo-api';

const vehiclePhotos = (vehicleId: string) =>
	photoCollection(`/api/v1/vehicles/${vehicleId}/photos`);

export const vehicleApi = {
	async getVehicle(vehicleId: string): Promise<Vehicle> {
		return apiClient.get<Vehicle>(`/api/v1/vehicles/${vehicleId}`);
	},

	async getVehicles(opts?: { includeShared?: boolean }): Promise<Vehicle[]> {
		const path = opts?.includeShared ? '/api/v1/vehicles?include=shared' : '/api/v1/vehicles';
		return apiClient.get<Vehicle[]>(path);
	},

	async createVehicle(data: Partial<Vehicle>): Promise<Vehicle> {
		return apiClient.post<Vehicle>('/api/v1/vehicles', data);
	},

	async updateVehicle(vehicleId: string, data: UpdateVehicleRequest): Promise<Vehicle> {
		return apiClient.put<Vehicle>(`/api/v1/vehicles/${vehicleId}`, data);
	},

	async getVehicleStats(vehicleId: string, period: TimePeriod): Promise<VehicleStats> {
		return apiClient.get<VehicleStats>(`/api/v1/vehicles/${vehicleId}/stats?period=${period}`);
	},

	async deleteVehicle(vehicleId: string): Promise<void> {
		await apiClient.delete(`/api/v1/vehicles/${vehicleId}`);
	},

	// The backend answers 200 with data: null when the vehicle has no financing; any error is real.
	async getFinancing(vehicleId: string): Promise<VehicleFinancing | null> {
		return apiClient.get<VehicleFinancing | null>(
			`/api/v1/financing/vehicles/${vehicleId}/financing`
		);
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

	getPhotos(
		vehicleId: string,
		params?: { limit?: number; offset?: number }
	): Promise<PaginatedResponse<Photo>> {
		return vehiclePhotos(vehicleId).list(params);
	},

	async getAllVehiclePhotos(): Promise<Record<string, Photo[]>> {
		return apiClient.get<Record<string, Photo[]>>('/api/v1/photos?entityType=vehicle');
	},

	uploadPhoto(vehicleId: string, file: File): Promise<Photo> {
		return vehiclePhotos(vehicleId).upload(file);
	},

	async setCoverPhoto(vehicleId: string, photoId: string): Promise<Photo> {
		return apiClient.put<Photo>(`/api/v1/vehicles/${vehicleId}/photos/${photoId}/cover`);
	},

	deletePhoto(vehicleId: string, photoId: string): Promise<void> {
		return vehiclePhotos(vehicleId).remove(photoId);
	},

	getPhotoThumbnailUrl(vehicleId: string, photoId: string): string {
		return vehiclePhotos(vehicleId).thumbnailUrl(photoId);
	}
};
