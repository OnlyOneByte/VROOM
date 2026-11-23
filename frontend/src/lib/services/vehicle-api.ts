import type {
	PaginatedResponse,
	Photo,
	UpdateVehicleRequest,
	Vehicle,
	VehicleFinancing,
	VehicleStats
} from '#lib/types/index.ts';
import type { TimePeriod } from '#lib/constants/time-periods.ts';
import { apiClient } from './api-client';
import { buildQueryString } from './api-utils';
import { userTimeZone } from './analytics-api';
import { photoCollection } from './photo-api';
import {
	cacheVehicles,
	currentOfflineQueueOwner,
	removeCachedVehicle,
	updateCachedVehicle
} from '#lib/utils/offline-storage.ts';

const vehiclePhotos = (vehicleId: string) => photoCollection(`/vehicles/${vehicleId}/photos`);

export const vehicleApi = {
	async getVehicle(vehicleId: string): Promise<Vehicle> {
		const requestedFor = currentOfflineQueueOwner();
		const vehicle = await apiClient.get<Vehicle>(
			`/vehicles/${vehicleId}${buildQueryString({ timeZone: userTimeZone() })}`
		);
		if (!vehicle.sharedAccess) updateCachedVehicle(vehicle, requestedFor);
		return vehicle;
	},

	async getVehicles(opts?: { includeShared?: boolean }): Promise<Vehicle[]> {
		const qs = buildQueryString({
			include: opts?.includeShared ? 'shared' : undefined,
			timeZone: userTimeZone()
		});
		const requestedFor = currentOfflineQueueOwner();
		const vehicles = await apiClient.get<Vehicle[]>(`/vehicles${qs}`);
		cacheVehicles(
			vehicles.filter(v => !v.sharedAccess),
			requestedFor
		);
		return vehicles;
	},

	async createVehicle(data: Partial<Vehicle>): Promise<Vehicle> {
		return apiClient.post<Vehicle>('/vehicles', data);
	},

	async updateVehicle(vehicleId: string, data: UpdateVehicleRequest): Promise<Vehicle> {
		const requestedFor = currentOfflineQueueOwner();
		const vehicle = await apiClient.put<Vehicle>(`/vehicles/${vehicleId}`, data);
		updateCachedVehicle(vehicle, requestedFor);
		return vehicle;
	},

	async getVehicleStats(vehicleId: string, period: TimePeriod): Promise<VehicleStats> {
		return apiClient.get<VehicleStats>(`/vehicles/${vehicleId}/stats?period=${period}`);
	},

	async deleteVehicle(vehicleId: string): Promise<void> {
		const requestedFor = currentOfflineQueueOwner();
		await apiClient.delete(`/vehicles/${vehicleId}`);
		removeCachedVehicle(vehicleId, requestedFor);
	},

	// The backend answers 200 with data: null when the vehicle has no financing; any error is real.
	async getFinancing(vehicleId: string): Promise<VehicleFinancing | null> {
		return apiClient.get<VehicleFinancing | null>(
			`/financing/vehicles/${vehicleId}/financing${buildQueryString({ timeZone: userTimeZone() })}`
		);
	},

	async createFinancing(
		vehicleId: string,
		data: Partial<Omit<VehicleFinancing, 'id' | 'vehicleId' | 'createdAt' | 'updatedAt'>>
	): Promise<VehicleFinancing> {
		return apiClient.post<VehicleFinancing>(`/financing/vehicles/${vehicleId}/financing`, data);
	},

	async updatePaymentAmount(financingId: string, paymentAmount: number): Promise<VehicleFinancing> {
		return apiClient.patch<VehicleFinancing>(`/financing/${financingId}/payment-amount`, {
			paymentAmount
		});
	},

	async payOffFinancing(financingId: string): Promise<VehicleFinancing> {
		return apiClient.put<VehicleFinancing>(`/financing/${financingId}/payoff`);
	},

	getPhotos(
		vehicleId: string,
		params?: { limit?: number; offset?: number }
	): Promise<PaginatedResponse<Photo>> {
		return vehiclePhotos(vehicleId).list(params);
	},

	async getAllVehiclePhotos(): Promise<Record<string, Photo[]>> {
		return apiClient.get<Record<string, Photo[]>>('/photos?entityType=vehicle');
	},

	uploadPhoto(vehicleId: string, file: File): Promise<Photo> {
		return vehiclePhotos(vehicleId).upload(file);
	},

	async setCoverPhoto(vehicleId: string, photoId: string): Promise<Photo> {
		return apiClient.put<Photo>(`/vehicles/${vehicleId}/photos/${photoId}/cover`);
	},

	deletePhoto(vehicleId: string, photoId: string): Promise<void> {
		return vehiclePhotos(vehicleId).remove(photoId);
	},

	getPhotoThumbnailUrl(vehicleId: string, photoId: string): string {
		return vehiclePhotos(vehicleId).thumbnailUrl(photoId);
	}
};
