import type { OdometerEntry, PaginatedResponse, Photo } from '$lib/types';
import { apiClient, getApiBaseUrl, withPagination } from './api-client';

interface CreateOdometerRequest {
	odometer: number;
	recordedAt: string;
	note?: string;
}

interface UpdateOdometerRequest {
	odometer?: number;
	recordedAt?: string;
	note?: string;
}

/**
 * Odometer API service
 * Handles all odometer entry CRUD operations
 */
export const odometerApi = {
	async getEntries(
		vehicleId: string,
		params?: { limit?: number; offset?: number }
	): Promise<PaginatedResponse<OdometerEntry>> {
		return apiClient.getPaginated<OdometerEntry>(
			withPagination(`/api/v1/odometer/${vehicleId}`, params)
		);
	},

	async getEntry(entryId: string): Promise<OdometerEntry> {
		return apiClient.get<OdometerEntry>(`/api/v1/odometer/entry/${entryId}`);
	},

	async create(vehicleId: string, data: CreateOdometerRequest): Promise<OdometerEntry> {
		return apiClient.post<OdometerEntry>(`/api/v1/odometer/${vehicleId}`, data);
	},

	async update(entryId: string, data: UpdateOdometerRequest): Promise<OdometerEntry> {
		return apiClient.put<OdometerEntry>(`/api/v1/odometer/${entryId}`, data);
	},

	async delete(entryId: string): Promise<void> {
		await apiClient.delete(`/api/v1/odometer/${entryId}`);
	},

	async uploadPhoto(entryId: string, file: File): Promise<Photo> {
		const formData = new FormData();
		formData.append('photo', file);
		return apiClient.post<Photo>(`/api/v1/photos/odometer_entry/${entryId}`, formData);
	},

	async getPhotos(
		entryId: string,
		params?: { limit?: number; offset?: number }
	): Promise<PaginatedResponse<Photo>> {
		return apiClient.getPaginated<Photo>(
			withPagination(`/api/v1/photos/odometer_entry/${entryId}`, params)
		);
	},

	async deletePhoto(entryId: string, photoId: string): Promise<void> {
		await apiClient.delete(`/api/v1/photos/odometer_entry/${entryId}/${photoId}`);
	},

	getPhotoThumbnailUrl(entryId: string, photoId: string): string {
		return `${getApiBaseUrl()}/api/v1/photos/odometer_entry/${entryId}/${photoId}/thumbnail`;
	}
};
