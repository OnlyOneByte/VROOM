import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
	CreateClaimRequest,
	CreatePolicyRequest,
	CreateTermRequest
} from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const getPaginated = vi.fn();
vi.mock('../api-client', async importOriginal => ({
	...(await importOriginal<typeof import('../api-client')>()),
	apiClient: { get, post, put, delete: del, getPaginated },
	getApiBaseUrl: () => 'https://api.example.com/api/v1'
}));

const { insuranceApi } = await import('../insurance-api');

const term: CreateTermRequest = {
	startDate: '2025-01-01',
	endDate: '2025-12-31',
	totalCost: 1_200,
	vehicleCoverage: { vehicleIds: ['v1'] }
};

beforeEach(() => {
	for (const fn of [get, post, put, del, getPaginated]) fn.mockReset();
});

describe('insuranceApi policies', () => {
	test('lists all policies and policies for one vehicle', async () => {
		get.mockResolvedValue([]);
		await insuranceApi.getAllPolicies();
		await insuranceApi.getPoliciesForVehicle('v1');
		await insuranceApi.getPolicy('p1');
		expect(get.mock.calls.map(c => c[0])).toEqual([
			'/insurance',
			'/insurance/vehicles/v1/policies',
			'/insurance/p1'
		]);
	});

	test('createPolicy POSTs the policy with its terms', async () => {
		const request: CreatePolicyRequest = { company: 'Acme', terms: [term] };
		post.mockResolvedValueOnce({ id: 'p1' });
		await expect(insuranceApi.createPolicy(request)).resolves.toEqual({ id: 'p1' });
		expect(post).toHaveBeenCalledWith('/insurance', request);
	});

	test('updatePolicy PUTs and deletePolicy DELETEs the policy path', async () => {
		put.mockResolvedValueOnce({ id: 'p1' });
		del.mockResolvedValueOnce({ deleted: true });
		await insuranceApi.updatePolicy('p1', { notes: null, isActive: false });
		await expect(insuranceApi.deletePolicy('p1')).resolves.toBeUndefined();
		expect(put).toHaveBeenCalledWith('/insurance/p1', { notes: null, isActive: false });
		expect(del).toHaveBeenCalledWith('/insurance/p1');
	});

	test('a failed policy request propagates the API error', async () => {
		const failure = new ApiError('Forbidden', 403);
		get.mockRejectedValueOnce(failure);
		await expect(insuranceApi.getPolicy('p1')).rejects.toBe(failure);
	});
});

describe('insuranceApi terms', () => {
	test('term mutations target the nested term paths', async () => {
		post.mockResolvedValueOnce({ id: 'p1' });
		put.mockResolvedValueOnce({ id: 'p1' });
		del.mockResolvedValueOnce({ id: 'p1' });
		await insuranceApi.addTerm('p1', term);
		await insuranceApi.updateTerm('p1', 't1', { policyNumber: null });
		await expect(insuranceApi.deleteTerm('p1', 't1')).resolves.toEqual({ id: 'p1' });
		expect(post).toHaveBeenCalledWith('/insurance/p1/terms', term);
		expect(put).toHaveBeenCalledWith('/insurance/p1/terms/t1', { policyNumber: null });
		expect(del).toHaveBeenCalledWith('/insurance/p1/terms/t1');
	});
});

describe('insuranceApi claims', () => {
	test('claim CRUD targets the policy claims paths', async () => {
		const claim: CreateClaimRequest = { claimDate: '2025-04-01', claimType: 'collision' };
		get.mockResolvedValueOnce([]);
		post.mockResolvedValueOnce({ id: 'c1' });
		put.mockResolvedValueOnce({ id: 'c1' });
		del.mockResolvedValueOnce(undefined);
		await insuranceApi.getClaims('p1');
		await insuranceApi.createClaim('p1', claim);
		await insuranceApi.updateClaim('p1', 'c1', { status: 'settled', payoutAmount: 800 });
		await insuranceApi.deleteClaim('p1', 'c1');
		expect(get).toHaveBeenCalledWith('/insurance/p1/claims');
		expect(post).toHaveBeenCalledWith('/insurance/p1/claims', claim);
		expect(put).toHaveBeenCalledWith('/insurance/p1/claims/c1', {
			status: 'settled',
			payoutAmount: 800
		});
		expect(del).toHaveBeenCalledWith('/insurance/p1/claims/c1');
	});

	test('a failed claim creation propagates the API error', async () => {
		const failure = new ApiError('Invalid claim', 400);
		post.mockRejectedValueOnce(failure);
		await expect(
			insuranceApi.createClaim('p1', { claimDate: '2025-04-01', claimType: 'theft' })
		).rejects.toBe(failure);
	});
});

describe('insuranceApi documents', () => {
	test('documents use the entity photo collection with pagination', async () => {
		getPaginated.mockResolvedValueOnce({ data: [] });
		post.mockResolvedValueOnce({ id: 'd1' });
		del.mockResolvedValueOnce(undefined);
		await insuranceApi.getEntityDocuments('insurance_policy', 'p1', { limit: 5, offset: 10 });
		await insuranceApi.uploadEntityDocument('insurance_policy', 'p1', new File(['x'], 'card.pdf'));
		await insuranceApi.deleteEntityDocument('insurance_policy', 'p1', 'd1');
		expect(getPaginated).toHaveBeenCalledWith('/photos/insurance_policy/p1?limit=5&offset=10');
		expect(post.mock.calls[0]?.[0]).toBe('/photos/insurance_policy/p1');
		expect(del).toHaveBeenCalledWith('/photos/insurance_policy/p1/d1');
		expect(insuranceApi.getEntityDocumentThumbnailUrl('insurance_policy', 'p1', 'd1')).toBe(
			'https://api.example.com/api/v1/photos/insurance_policy/p1/d1/thumbnail'
		);
	});
});
