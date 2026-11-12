import type { OdometerEntry, PaginatedResponse, Photo } from '#lib/types/index.ts';
import { apiClient, withPagination } from './api-client';
import { entityPhotos } from './photo-api';

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

	uploadPhoto(entryId: string, file: File): Promise<Photo> {
		return entityPhotos('odometer_entry', entryId).upload(file);
	}
};
