import type { CreateShareRequest, ShareLevel, VehicleShare } from '$lib/types';
import { apiClient } from './api-client';

/**
 * Vehicle-share API service (vehicle-sharing T10 FE seam) — the C149/C163 service pattern over the
 * T3 (owner-side) + T4 (invitee-side) `/api/v1/shares` routes:
 *   POST   /api/v1/shares              — owner invites an existing user by email (-> pending)
 *   GET    /api/v1/shares/granted      — shares I granted (owner side)
 *   PUT    /api/v1/shares/:id          — owner changes a share's level
 *   DELETE /api/v1/shares/:id          — owner revokes a share
 *   GET    /api/v1/shares/received     — invites/grants TO me (invitee side)
 *   POST   /api/v1/shares/:id/accept   — invitee accepts a pending invite
 *   POST   /api/v1/shares/:id/decline  — invitee declines / self-removes
 *
 * apiClient.get/post/put already unwrap the { success, data } envelope, so these are thin pass-throughs.
 * No money fields on a share row, so no cents↔dollars transform is needed (unlike expense/reminder reads).
 */
export const shareApi = {
	// --- owner side (T3) ---
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

	// --- invitee side (T4) ---
	async listReceived(): Promise<VehicleShare[]> {
		return apiClient.get<VehicleShare[]>('/api/v1/shares/received');
	},

	async accept(id: string): Promise<VehicleShare> {
		return apiClient.post<VehicleShare>(`/api/v1/shares/${id}/accept`);
	},

	async decline(id: string): Promise<void> {
		await apiClient.post(`/api/v1/shares/${id}/decline`);
	}
};
