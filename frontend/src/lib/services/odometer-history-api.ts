import type { OdometerHistoryEntry, PaginatedResponse } from '#lib/types/index.ts';
import { apiClient, withPagination } from './api-client';

export const odometerHistoryApi = {
	async getHistory(
		vehicleId: string,
		params?: { limit?: number; offset?: number }
	): Promise<PaginatedResponse<OdometerHistoryEntry>> {
		return apiClient.getPaginated<OdometerHistoryEntry>(
			withPagination(`/odometer/${vehicleId}/history`, params)
		);
	}
};
