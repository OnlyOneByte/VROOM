import type {
	CreateShareRequest,
	GrantedShare,
	ReceivedShare,
	ShareLevel,
	VehicleShare
} from '#lib/types/index.ts';
import { apiClient } from './api-client';

export const shareApi = {
	async invite(data: CreateShareRequest): Promise<VehicleShare> {
		return apiClient.post<VehicleShare>('/shares', data);
	},

	async listGranted(): Promise<GrantedShare[]> {
		return apiClient.get<GrantedShare[]>('/shares/granted');
	},

	async changeLevel(id: string, level: ShareLevel): Promise<VehicleShare> {
		return apiClient.put<VehicleShare>(`/shares/${id}`, { level });
	},

	async revoke(id: string): Promise<void> {
		await apiClient.delete(`/shares/${id}`);
	},

	async listReceived(): Promise<ReceivedShare[]> {
		return apiClient.get<ReceivedShare[]>('/shares/received');
	},

	async accept(id: string): Promise<VehicleShare> {
		return apiClient.post<VehicleShare>(`/shares/${id}/accept`);
	},

	async decline(id: string): Promise<void> {
		await apiClient.post(`/shares/${id}/decline`);
	}
};
