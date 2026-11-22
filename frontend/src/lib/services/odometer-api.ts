import type { OdometerEntry, PaginatedResponse, Photo } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
import { userTimeZone } from './analytics-api';
import { apiClient, withPagination } from './api-client';
import { entityPhotos } from './photo-api';

const ODOMETER_ORDER_MESSAGE =
	/^Mileage (must be greater than [\d,]+ \(from earlier entry\)|must be less than [\d,]+ \(from later entry\)|cannot be less than initial mileage)$/;

export function isOdometerOrderError(error: unknown): error is ApiError {
	return (
		error instanceof ApiError &&
		error.statusCode === 400 &&
		ODOMETER_ORDER_MESSAGE.test(error.message)
	);
}

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
		return apiClient.post<OdometerEntry>(`/api/v1/odometer/${vehicleId}`, {
			...data,
			timeZone: userTimeZone()
		});
	},

	async update(entryId: string, data: UpdateOdometerRequest): Promise<OdometerEntry> {
		return apiClient.put<OdometerEntry>(`/api/v1/odometer/${entryId}`, {
			...data,
			timeZone: userTimeZone()
		});
	},

	async delete(entryId: string): Promise<void> {
		await apiClient.delete(`/api/v1/odometer/${entryId}`);
	},

	uploadPhoto(entryId: string, file: File): Promise<Photo> {
		return entityPhotos('odometer_entry', entryId).upload(file);
	}
};
