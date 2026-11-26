import type {
	BackfillBatch,
	BackfillRequest,
	BackfillSummary,
	Driver,
	DriverBalances,
	DriverStats,
	SplitRules
} from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
import { apiClient } from './api-client';
import { buildQueryString } from './api-utils';

export const driverApi = {
	async list(vehicleId: string): Promise<Driver[] | null> {
		try {
			return await apiClient.get<Driver[]>(`/vehicles/${vehicleId}/drivers`);
		} catch (error) {
			const status = error instanceof ApiError ? error.statusCode : undefined;
			if (status === 403 || status === 404) return null;
			throw error;
		}
	},

	async stats(vehicleId: string, period: { from: Date; to: Date }): Promise<DriverStats | null> {
		const qs = buildQueryString({ from: period.from.toISOString(), to: period.to.toISOString() });
		try {
			return await apiClient.get<DriverStats>(`/vehicles/${vehicleId}/drivers/stats${qs}`);
		} catch (error) {
			const status = error instanceof ApiError ? error.statusCode : undefined;
			if (status === 403 || status === 404) return null;
			throw error;
		}
	},

	async rules(vehicleId: string): Promise<SplitRules> {
		return apiClient.get<SplitRules>(`/vehicles/${vehicleId}/drivers/rules`);
	},

	async setRules(vehicleId: string, rules: SplitRules): Promise<SplitRules> {
		return apiClient.put<SplitRules>(`/vehicles/${vehicleId}/drivers/rules`, rules);
	},

	async balances(
		vehicleId: string,
		period: { from: Date; to: Date }
	): Promise<DriverBalances | null> {
		const qs = buildQueryString({ from: period.from.toISOString(), to: period.to.toISOString() });
		try {
			return await apiClient.get<DriverBalances>(`/vehicles/${vehicleId}/drivers/balances${qs}`);
		} catch (error) {
			const status = error instanceof ApiError ? error.statusCode : undefined;
			if (status === 403 || status === 404) return null;
			throw error;
		}
	},

	async setCarShare(vehicleId: string, enabled: boolean): Promise<{ drivers: Driver[] }> {
		return apiClient.put(`/vehicles/${vehicleId}/car-share`, { enabled });
	},

	async addGuest(vehicleId: string, name: string): Promise<Driver> {
		return apiClient.post<Driver>(`/vehicles/${vehicleId}/drivers`, { name });
	},

	async update(
		vehicleId: string,
		driverId: string,
		changes: { name?: string; archived?: boolean }
	): Promise<Driver> {
		return apiClient.patch<Driver>(`/vehicles/${vehicleId}/drivers/${driverId}`, changes);
	},

	async previewBackfill(vehicleId: string, request: BackfillRequest): Promise<BackfillSummary> {
		return apiClient.post<BackfillSummary>(
			`/vehicles/${vehicleId}/drivers/backfill/preview`,
			request
		);
	},

	async backfill(
		vehicleId: string,
		request: BackfillRequest
	): Promise<BackfillSummary & { batchId: string }> {
		return apiClient.post(`/vehicles/${vehicleId}/drivers/backfill`, request);
	},

	async backfills(vehicleId: string): Promise<BackfillBatch[]> {
		return apiClient.get<BackfillBatch[]>(`/vehicles/${vehicleId}/drivers/backfill`);
	},

	async undoBackfill(vehicleId: string, batchId: string): Promise<{ reverted: number }> {
		return apiClient.post(`/vehicles/${vehicleId}/drivers/backfill/${batchId}/undo`);
	}
};
