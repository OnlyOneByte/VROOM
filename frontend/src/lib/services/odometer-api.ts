import type { OdometerEntry, PaginatedOdometerResponse, Photo } from '$lib/types';
import { apiClient, getApiBaseUrl } from './api-client';
import { ApiError } from '$lib/utils/error-handling';

export interface CreateOdometerRequest {
	odometer: number;
	recordedAt: string;
	note?: string;
}

export interface UpdateOdometerRequest {
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
	): Promise<PaginatedOdometerResponse> {
		const query = new URLSearchParams();
		if (params?.limit) query.set('limit', String(params.limit));
		if (params?.offset) query.set('offset', String(params.offset));
		const qs = query.toString();

		// Use raw() because apiClient auto-unwraps `data` from the envelope,
		// but we need the full paginated response (totalCount, hasMore, etc.)
		const response = await apiClient.raw(
			`${getApiBaseUrl()}/api/v1/odometer/${vehicleId}${qs ? `?${qs}` : ''}`,
			{ method: 'GET' }
		);

		if (!response.ok) {
			let message = `Request failed with status ${response.status}`;
			try {
				const errorBody = await response.json();
				message = errorBody.error?.message || errorBody.message || message;
			} catch {
				// ignore parse errors
			}
			throw new ApiError(message, response.status);
		}

		const result = await response.json();
		return {
			data: result.data as OdometerEntry[],
			totalCount: result.totalCount as number,
			limit: result.limit as number,
			offset: result.offset as number,
			hasMore: result.hasMore as boolean
		};
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

	async getPhotos(entryId: string): Promise<Photo[]> {
		return apiClient.get<Photo[]>(`/api/v1/photos/odometer_entry/${entryId}`);
	},

	async deletePhoto(entryId: string, photoId: string): Promise<void> {
		await apiClient.delete(`/api/v1/photos/odometer_entry/${entryId}/${photoId}`);
	},

	getPhotoThumbnailUrl(entryId: string, photoId: string): string {
		return `${getApiBaseUrl()}/api/v1/photos/odometer_entry/${entryId}/${photoId}/thumbnail`;
	}
};
