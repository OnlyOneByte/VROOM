import type {
	CreateShareRequest,
	ReceivedShare,
	ShareLevel,
	VehicleShare
} from '#lib/types/index.ts';
import { apiClient } from './api-client';

export const shareApi = {
	async invite(data: CreateShareRequest): Promise<VehicleShare> {
		return apiClient.post<VehicleShare>('/api/v1/shares', data);
	},

	async listGranted(): Promise<VehicleShare[]> {
		return apiClient.get<VehicleShare[]>('/api/v1/shares/granted');
	},

	async changeLevel(id: string, level: ShareLevel): Promise<VehicleShare> {
		return apiClient.put<VehicleShare>(`/api/v1/shares/${id}`, { level });
	},

	async revoke(id: string): Promise<void> {
		await apiClient.delete(`/api/v1/shares/${id}`);
	},

	async listReceived(): Promise<ReceivedShare[]> {
		return apiClient.get<ReceivedShare[]>('/api/v1/shares/received');
	},

	async accept(id: string): Promise<VehicleShare> {
		return apiClient.post<VehicleShare>(`/api/v1/shares/${id}/accept`);
	},

	async decline(id: string): Promise<void> {
		await apiClient.post(`/api/v1/shares/${id}/decline`);
	}
};
