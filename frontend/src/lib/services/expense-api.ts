import type {
	Expense,
	ExpenseCategory,
	ExpenseSummary,
	PaginatedResponse,
	Photo,
	SplitConfig,
	SplitExpenseGroup
} from '$lib/types';
import {
	fromBackendExpense,
	toBackendExpense,
	type BackendExpenseResponse
} from './api-transformer';
import { apiClient, getApiBaseUrl, withPagination } from './api-client';

/** Convenience alias for a paginated response of transformed frontend Expenses. */
type PaginatedExpenseResponse = PaginatedResponse<Expense>;

/** Parameters accepted by paginated expense list methods. */
interface ExpenseListParams {
	limit?: number;
	offset?: number;
	category?: string;
	startDate?: string;
	endDate?: string;
	tags?: string[];
	period?: string;
}

/** Parameters accepted by the expense summary endpoint. */
interface ExpenseSummaryParams {
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
 * Fetch a paginated expense response using apiClient.getPaginated() so we keep
 * the pagination metadata that apiClient.get() would strip during envelope unwrapping.
 * Transforms backend expense fields to frontend format.
 */
async function fetchPaginatedExpenses(url: string): Promise<PaginatedExpenseResponse> {
	const result = await apiClient.getPaginated<BackendExpenseResponse>(url);

	return {
		data: result.data.map(fromBackendExpense),
		pagination: result.pagination
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
		expense: Partial<Expense> & { vehicleId: string; category: ExpenseCategory; amount: number }
	): Promise<Expense> {
		const backendExpense = toBackendExpense(expense);
		const data = await apiClient.post<BackendExpenseResponse>('/api/v1/expenses', backendExpense);
		return fromBackendExpense(data);
	},

	async updateExpense(
		expenseId: string,
		expense: Partial<Expense> & { vehicleId: string; category: ExpenseCategory; amount: number }
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

	async getPhotos(
		entityType: 'expense',
		entityId: string,
		params?: { limit?: number; offset?: number }
	): Promise<PaginatedResponse<Photo>> {
		return apiClient.getPaginated<Photo>(
			withPagination(`/api/v1/photos/${entityType}/${entityId}`, params)
		);
	},

	async uploadPhoto(entityType: 'expense', entityId: string, file: File): Promise<Photo> {
		const formData = new FormData();
		formData.append('photo', file);
		return apiClient.post<Photo>(`/api/v1/photos/${entityType}/${entityId}`, formData);
	},

	async deletePhoto(entityType: 'expense', entityId: string, photoId: string): Promise<void> {
		await apiClient.delete(`/api/v1/photos/${entityType}/${entityId}/${photoId}`);
	},

	getPhotoThumbnailUrl(entityType: 'expense', entityId: string, photoId: string): string {
		return `${getApiBaseUrl()}/api/v1/photos/${entityType}/${entityId}/${photoId}/thumbnail`;
	},

	// --- Split expense (expense group) methods ---

	async createSplitExpense(data: {
		splitConfig: SplitConfig;
		category: ExpenseCategory;
		tags?: string[];
		date: string;
		description?: string;
		totalAmount: number;
		sourceType?: string;
		sourceId?: string;
	}): Promise<SplitExpenseGroup> {
		return apiClient.post<SplitExpenseGroup>('/api/v1/expenses/split', data);
	},

	async updateSplitExpense(
		groupId: string,
		data: { splitConfig: SplitConfig; totalAmount?: number }
	): Promise<SplitExpenseGroup> {
		return apiClient.put<SplitExpenseGroup>(`/api/v1/expenses/split/${groupId}`, data);
	},

	async getSplitExpense(groupId: string): Promise<SplitExpenseGroup> {
		return apiClient.get<SplitExpenseGroup>(`/api/v1/expenses/split/${groupId}`);
	},

	async deleteSplitExpense(groupId: string): Promise<void> {
		await apiClient.delete(`/api/v1/expenses/split/${groupId}`);
	}
};
