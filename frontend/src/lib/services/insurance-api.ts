import type {
	CreateClaimRequest,
	CreatePolicyRequest,
	CreateTermRequest,
	InsuranceClaim,
	InsurancePolicy,
	PaginatedResponse,
	Photo,
	UpdateClaimRequest,
	UpdatePolicyRequest,
	UpdateTermRequest
} from '#lib/types/index.ts';
import { apiClient } from './api-client';
import { entityPhotos } from './photo-api';

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

	async deleteTerm(policyId: string, termId: string): Promise<InsurancePolicy> {
		return apiClient.delete<InsurancePolicy>(`/api/v1/insurance/${policyId}/terms/${termId}`);
	},

	getEntityDocuments(
		entityType: string,
		entityId: string,
		params?: { limit?: number; offset?: number }
	): Promise<PaginatedResponse<Photo>> {
		return entityPhotos(entityType, entityId).list(params);
	},

	uploadEntityDocument(entityType: string, entityId: string, file: File): Promise<Photo> {
		return entityPhotos(entityType, entityId).upload(file);
	},

	deleteEntityDocument(entityType: string, entityId: string, photoId: string): Promise<void> {
		return entityPhotos(entityType, entityId).remove(photoId);
	},

	getEntityDocumentThumbnailUrl(entityType: string, entityId: string, photoId: string): string {
		return entityPhotos(entityType, entityId).thumbnailUrl(photoId);
	},

	async getClaims(policyId: string): Promise<InsuranceClaim[]> {
		return apiClient.get<InsuranceClaim[]>(`/api/v1/insurance/${policyId}/claims`);
	},

	async createClaim(policyId: string, data: CreateClaimRequest): Promise<InsuranceClaim> {
		return apiClient.post<InsuranceClaim>(`/api/v1/insurance/${policyId}/claims`, data);
	},

	async updateClaim(
		policyId: string,
		claimId: string,
		data: UpdateClaimRequest
	): Promise<InsuranceClaim> {
		return apiClient.put<InsuranceClaim>(`/api/v1/insurance/${policyId}/claims/${claimId}`, data);
	},

	async deleteClaim(policyId: string, claimId: string): Promise<void> {
		await apiClient.delete(`/api/v1/insurance/${policyId}/claims/${claimId}`);
	}
};
