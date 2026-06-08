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

/** One row's outcome from a CSV import (mirrors the backend summarizeImportPlan). */
export interface ExpenseImportRow {
	row: number;
	status: 'ready' | 'error';
	message?: string;
	raw?: { vehicle: string; category: string; amount: string; date: string };
}

/** Result of POST /expenses/import (preview when dryRun, else the commit summary). */
export interface ExpenseImportResult {
	dryRun: boolean;
	imported: number;
	readyCount: number;
	errorCount: number;
	totalRows: number;
	rows: ExpenseImportRow[];
}

/** Parameters accepted by paginated expense list methods. */
/** Columns the expense list can be sorted by (must match the backend allowlist). */
export type ExpenseSortBy = 'date' | 'amount' | 'category';
export type ExpenseSortDir = 'asc' | 'desc';

interface ExpenseListParams {
	limit?: number;
	offset?: number;
	category?: string;
	startDate?: string;
	endDate?: string;
	tags?: string[];
	period?: string;
	search?: string;
	sortBy?: ExpenseSortBy;
	sortDir?: ExpenseSortDir;
}

/** Parameters accepted by the expense summary endpoint. */
interface ExpenseSummaryParams {
	vehicleId?: string;
	period?: string;
}

/**
 * Build a URLSearchParams from expense list params + optional vehicleId.
 * Exported for unit testing (the expense list/search/pagination correctness
 * depends on this building the query string exactly right).
 */
export function buildExpenseQuery(params?: ExpenseListParams, vehicleId?: string): string {
	const query = new URLSearchParams();
	if (vehicleId) query.set('vehicleId', vehicleId);
	if (params?.limit) query.set('limit', String(params.limit));
	if (params?.offset) query.set('offset', String(params.offset));
	if (params?.category) query.set('category', params.category);
	if (params?.startDate) query.set('startDate', params.startDate);
	if (params?.endDate) query.set('endDate', params.endDate);
	if (params?.period) query.set('period', params.period);
	if (params?.search?.trim()) query.set('search', params.search.trim());
	// Only emit sort params when set to a non-default — keeps URLs/queries identical
	// to before for the default (date desc) path, so nothing else changes behavior.
	if (params?.sortBy) query.set('sortBy', params.sortBy);
	if (params?.sortDir) query.set('sortDir', params.sortDir);
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

	/**
	 * Download all matching expenses as a CSV file (server-generated). Honours the
	 * SAME filters as the list table — vehicle / category / date-range / free-text
	 * search / tags — so the export matches exactly what the user is viewing.
	 * Triggers a browser download.
	 */
	async downloadExpensesCsv(params?: {
		vehicleId?: string;
		category?: string;
		startDate?: string;
		endDate?: string;
		search?: string;
		tags?: string[];
	}): Promise<void> {
		const query = new URLSearchParams();
		if (params?.vehicleId) query.set('vehicleId', params.vehicleId);
		if (params?.category) query.set('category', params.category);
		if (params?.startDate) query.set('startDate', params.startDate);
		if (params?.endDate) query.set('endDate', params.endDate);
		if (params?.search?.trim()) query.set('search', params.search.trim());
		// tags as a comma-joined param (the export schema splits on comma).
		if (params?.tags?.length) query.set('tags', params.tags.join(','));
		const qs = query.toString();

		const res = await apiClient.raw(`/api/v1/expenses/export${qs ? `?${qs}` : ''}`);
		if (!res.ok) throw new Error(`Export failed with status ${res.status}`);

		const blob = await res.blob();
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `vroom-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
		document.body.appendChild(a);
		a.click();
		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	},

	/**
	 * Import expenses from a "VROOM CSV" (the round-trip target of the export). Sends
	 * the CSV TEXT; the server validates every row and resolves each vehicle by NAME
	 * within the user's own fleet. With `dryRun: true` the server validates + reports
	 * only (preview) and writes nothing; `dryRun: false` commits the valid rows.
	 */
	async importExpensesCsv(csv: string, dryRun = false): Promise<ExpenseImportResult> {
		return apiClient.post<ExpenseImportResult>('/api/v1/expenses/import', { csv, dryRun });
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
		// isEdit: an emptied description is sent as null so the user can CLEAR it
		// (the clear-optional-field class). Create + offline/sync paths don't pass
		// this, so their payloads are unchanged.
		const backendExpense = toBackendExpense(expense, { isEdit: true });
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
