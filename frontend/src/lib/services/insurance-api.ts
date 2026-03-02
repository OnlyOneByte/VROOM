import type {
	CreatePolicyRequest,
	CreateTermRequest,
	InsurancePolicy,
	Photo,
	UpdatePolicyRequest,
	UpdateTermRequest
} from '$lib/types';
import { apiClient, getApiBaseUrl } from './api-client';

/**
 * Insurance API service
 * Centralized API calls for insurance policy operations
 */
export const insuranceApi = {
	async getAllPolicies(): Promise<InsurancePolicy[]> {
		return apiClient.get<InsurancePolicy[]>('/api/v1/insurance');
	},

	async getPoliciesForVehicle(vehicleId: string): Promise<InsurancePolicy[]> {
		return apiClient.get<InsurancePolicy[]>(`/api/v1/insurance/vehicles/${vehicleId}/policies`);
	},

	async getPolicy(policyId: string): Promise<InsurancePolicy> {
		return apiClient.get<InsurancePolicy>(`/api/v1/insurance/${policyId}`);
	},

	async createPolicy(data: CreatePolicyRequest): Promise<InsurancePolicy> {
		return apiClient.post<InsurancePolicy>('/api/v1/insurance', data);
	},

	async updatePolicy(policyId: string, data: UpdatePolicyRequest): Promise<InsurancePolicy> {
		return apiClient.put<InsurancePolicy>(`/api/v1/insurance/${policyId}`, data);
	},

	async deletePolicy(policyId: string): Promise<void> {
		await apiClient.delete(`/api/v1/insurance/${policyId}`);
	},

	async addTerm(policyId: string, term: CreateTermRequest): Promise<InsurancePolicy> {
		return apiClient.post<InsurancePolicy>(`/api/v1/insurance/${policyId}/terms`, term);
	},

	async updateTerm(
		policyId: string,
		termId: string,
		data: UpdateTermRequest
	): Promise<InsurancePolicy> {
		return apiClient.put<InsurancePolicy>(`/api/v1/insurance/${policyId}/terms/${termId}`, data);
	},

	async getExpiringPolicies(days?: number): Promise<InsurancePolicy[]> {
		const query = days !== undefined ? `?days=${days}` : '';
		return apiClient.get<InsurancePolicy[]>(`/api/v1/insurance/expiring-soon${query}`);
	},

	// --- Document methods (delegate to photo endpoints) ---

	async getDocuments(policyId: string): Promise<Photo[]> {
		return apiClient.get<Photo[]>(`/api/v1/photos/insurance_policy/${policyId}`);
	},

	async uploadDocument(policyId: string, file: File, termId?: string): Promise<Photo> {
		const formData = new FormData();
		formData.append('photo', file);
		if (termId) {
			formData.append('termId', termId);
		}
		return apiClient.post<Photo>(`/api/v1/photos/insurance_policy/${policyId}`, formData);
	},

	async deleteDocument(policyId: string, photoId: string): Promise<void> {
		await apiClient.delete(`/api/v1/photos/insurance_policy/${policyId}/${photoId}`);
	},

	getDocumentThumbnailUrl(policyId: string, photoId: string): string {
		return `${getApiBaseUrl()}/api/v1/photos/insurance_policy/${policyId}/${photoId}/thumbnail`;
	}
};
