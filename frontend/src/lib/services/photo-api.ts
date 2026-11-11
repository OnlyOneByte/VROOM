import type { PaginatedResponse, Photo } from '$lib/types';
import { apiClient, getApiBaseUrl, withPagination } from './api-client';

/** List, upload, delete, and thumbnail calls for the photos under one collection path. */
export function photoCollection(collectionPath: string) {
	return {
		list(params?: { limit?: number; offset?: number }): Promise<PaginatedResponse<Photo>> {
			return apiClient.getPaginated<Photo>(withPagination(collectionPath, params));
		},

		upload(file: File): Promise<Photo> {
			const formData = new FormData();
			formData.append('photo', file);
			return apiClient.post<Photo>(collectionPath, formData);
		},

		async remove(photoId: string): Promise<void> {
			await apiClient.delete(`${collectionPath}/${photoId}`);
		},

		thumbnailUrl(photoId: string): string {
			return `${getApiBaseUrl()}${collectionPath}/${photoId}/thumbnail`;
		}
	};
}

/** Photos attached to an expense, odometer entry, or insurance record. */
export function entityPhotos(entityType: string, entityId: string) {
	return photoCollection(`/api/v1/photos/${entityType}/${entityId}`);
}
