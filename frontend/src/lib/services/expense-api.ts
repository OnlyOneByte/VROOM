import type {
	Expense,
	ExpenseGroupWithChildren,
	ExpenseSummary,
	PaginatedResponse,
	Photo,
	SplitConfig
} from '$lib/types';
import {
	fromBackendExpense,
	toBackendExpense,
	type BackendExpenseResponse
} from './api-transformer';
import { apiClient, getApiBaseUrl } from './api-client';
import { ApiError } from '$lib/utils/error-handling';

/** Convenience alias for a paginated response of transformed frontend Expenses. */
export type PaginatedExpenseResponse = PaginatedResponse<Expense>;

/** Parameters accepted by paginated expense list methods. */
export interface ExpenseListParams {
	limit?: number;
	offset?: number;
	category?: string;
	startDate?: string;
	endDate?: string;
	tags?: string[];
	period?: string;
}

/** Parameters accepted by the expense summary endpoint. */
export interface ExpenseSummaryParams {
	vehicleId?: string;
	period?: string;
}

/**
 * Build a URLSearchParams from expense list params + optional vehicleId.
 */
function buildExpenseQuery(params?: ExpenseListParams, vehicleId?: string): string {
	const query = new URLSearchParams();
	if (vehicleId) query.set('vehicleId', vehicleId);
	if (params?.limit) query.set('limit', String(params.limit));
	if (params?.offset) query.set('offset', String(params.offset));
	if (params?.category) query.set('category', params.category);
	if (params?.startDate) query.set('startDate', params.startDate);
	if (params?.endDate) query.set('endDate', params.endDate);
	if (params?.period) query.set('period', params.period);
	if (params?.tags?.length) {
		for (const tag of params.tags) {
			query.append('tags', tag);
		}
	}
	return query.toString();
}

/**
 * Fetch a paginated expense response using apiClient.raw() so we keep
 * the pagination metadata (totalCount, limit, offset, hasMore) that
 * apiClient.get() would strip during envelope unwrapping.
 */
async function fetchPaginatedExpenses(url: string): Promise<PaginatedExpenseResponse> {
	const response = await apiClient.raw(`${getApiBaseUrl()}${url}`, { method: 'GET' });

	if (!response.ok) {
		let message = `Request failed with status ${response.status}`;
		try {
			const errorBody = await response.json();
			message = errorBody.error?.message || errorBody.message || message;
		} catch {
			// ignore parse errors
		}
		throw new ApiError(message, response.status);
	}

	const result = await response.json();
	const backendData = (result.data ?? []) as BackendExpenseResponse[];

	return {
		data: backendData.map(fromBackendExpense),
		totalCount: result.totalCount as number,
		limit: result.limit as number,
		offset: result.offset as number,
		hasMore: result.hasMore as boolean
	};
}

/**
 * Expense API service
 * All expense API calls go through here to ensure field name transformations
 * (backend `expenseAmount`/`fuelAmount` ↔ frontend `amount`/`volume`/`charge`)
 */
export const expenseApi = {
	async getExpense(expenseId: string): Promise<Expense> {
		const data = await apiClient.get<BackendExpenseResponse>(`/api/v1/expenses/${expenseId}`);
		return fromBackendExpense(data);
	},

	async getExpensesByVehicle(
		vehicleId: string,
		params?: ExpenseListParams
	): Promise<PaginatedExpenseResponse> {
		const qs = buildExpenseQuery(params, vehicleId);
		return fetchPaginatedExpenses(`/api/v1/expenses${qs ? `?${qs}` : ''}`);
	},

	async getAllExpenses(params?: ExpenseListParams): Promise<PaginatedExpenseResponse> {
		const qs = buildExpenseQuery(params);
		return fetchPaginatedExpenses(`/api/v1/expenses${qs ? `?${qs}` : ''}`);
	},

	async getExpenseSummary(params?: ExpenseSummaryParams): Promise<ExpenseSummary> {
		const query = new URLSearchParams();
		if (params?.vehicleId) query.set('vehicleId', params.vehicleId);
		if (params?.period) query.set('period', params.period);
		const qs = query.toString();
		return apiClient.get<ExpenseSummary>(`/api/v1/expenses/summary${qs ? `?${qs}` : ''}`);
	},

	async getVehicleStats(recentDays?: number): Promise<
		Array<{
			vehicleId: string;
			totalAmount: number;
			recentAmount: number;
			lastExpenseDate: string | null;
		}>
	> {
		const query = new URLSearchParams();
		if (recentDays) query.set('recentDays', String(recentDays));
		const qs = query.toString();
		return apiClient.get(`/api/v1/expenses/vehicle-stats${qs ? `?${qs}` : ''}`);
	},

	async createExpense(
		expense: Partial<Expense> & { vehicleId: string; category: string; amount: number }
	): Promise<Expense> {
		const backendExpense = toBackendExpense(expense);
		const data = await apiClient.post<BackendExpenseResponse>('/api/v1/expenses', backendExpense);
		return fromBackendExpense(data);
	},

	async updateExpense(
		expenseId: string,
		expense: Partial<Expense> & { vehicleId: string; category: string; amount: number }
	): Promise<Expense> {
		const backendExpense = toBackendExpense(expense);
		const data = await apiClient.put<BackendExpenseResponse>(
			`/api/v1/expenses/${expenseId}`,
			backendExpense
		);
		return fromBackendExpense(data);
	},

	async deleteExpense(expenseId: string): Promise<void> {
		await apiClient.delete(`/api/v1/expenses/${expenseId}`);
	},

	// --- Photo methods (delegate to generic photo endpoints) ---

	async getPhotos(entityType: 'expense' | 'expense_group', entityId: string): Promise<Photo[]> {
		return apiClient.get<Photo[]>(`/api/v1/photos/${entityType}/${entityId}`);
	},

	async uploadPhoto(
		entityType: 'expense' | 'expense_group',
		entityId: string,
		file: File
	): Promise<Photo> {
		const formData = new FormData();
		formData.append('photo', file);
		return apiClient.post<Photo>(`/api/v1/photos/${entityType}/${entityId}`, formData);
	},

	async deletePhoto(
		entityType: 'expense' | 'expense_group',
		entityId: string,
		photoId: string
	): Promise<void> {
		await apiClient.delete(`/api/v1/photos/${entityType}/${entityId}/${photoId}`);
	},

	getPhotoThumbnailUrl(
		entityType: 'expense' | 'expense_group',
		entityId: string,
		photoId: string
	): string {
		return `${getApiBaseUrl()}/api/v1/photos/${entityType}/${entityId}/${photoId}/thumbnail`;
	},

	// --- Split expense (expense group) methods ---

	async createSplitExpense(data: {
		splitConfig: SplitConfig;
		category: string;
		tags?: string[];
		date: string;
		description?: string;
		totalAmount: number;
		insurancePolicyId?: string;
		insuranceTermId?: string;
	}): Promise<ExpenseGroupWithChildren> {
		return apiClient.post<ExpenseGroupWithChildren>('/api/v1/expenses/split', data);
	},

	async updateSplitExpense(
		groupId: string,
		data: { splitConfig: SplitConfig; totalAmount?: number }
	): Promise<ExpenseGroupWithChildren> {
		return apiClient.put<ExpenseGroupWithChildren>(`/api/v1/expenses/split/${groupId}`, data);
	},

	async getSplitExpense(groupId: string): Promise<ExpenseGroupWithChildren> {
		return apiClient.get<ExpenseGroupWithChildren>(`/api/v1/expenses/split/${groupId}`);
	},

	async deleteSplitExpense(groupId: string): Promise<void> {
		await apiClient.delete(`/api/v1/expenses/split/${groupId}`);
	}
};
