import type {
	Expense,
	ExpenseCategory,
	ExpenseSummary,
	ImportColumnMapping,
	PaginatedResponse,
	Photo,
	SplitConfig,
	SplitExpenseGroup
} from '$lib/types';
import type { ImportMappingPreset } from '$lib/types/import-mapping';
import {
	fromBackendExpense,
	toBackendExpense,
	type BackendExpenseResponse
} from './api-transformer';
import { apiClient, getApiBaseUrl, withPagination } from './api-client';
import { toDateInputValue } from '$lib/utils/formatters';
import { triggerBlobDownload } from '$lib/utils/download';

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
	/** Commit only: rows skipped because they were already imported. */
	duplicates?: number;
	/** Foreign-tracker import: unrecognized category words, imported as `misc`. */
	unmappedCategories?: string[];
}

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

interface ExpenseSummaryParams {
	vehicleId?: string;
	period?: string;
}

/** Builds the expense list query string, without the leading '?'. */
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
	if (params?.sortBy) query.set('sortBy', params.sortBy);
	if (params?.sortDir) query.set('sortDir', params.sortDir);
	if (params?.tags?.length) {
		for (const tag of params.tags) {
			query.append('tags', tag);
		}
	}
	return query.toString();
}

// Uses getPaginated so pagination metadata is kept; get() would unwrap it away.
async function fetchPaginatedExpenses(url: string): Promise<PaginatedExpenseResponse> {
	const result = await apiClient.getPaginated<BackendExpenseResponse>(url);

	return {
		data: result.data.map(fromBackendExpense),
		pagination: result.pagination
	};
}

/** Expense endpoints. Responses are mapped from backend to frontend field names. */
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

	// Accepts the same filters as the list view so the export matches what the user sees.
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
		triggerBlobDownload(blob, `vroom-expenses-${toDateInputValue(new Date())}.csv`);
	},

	// dryRun previews without writing. A foreign-tracker file needs `mapping`; omit it for native VROOM CSV.
	async importExpensesCsv(
		csv: string,
		dryRun = false,
		mapping?: ImportColumnMapping
	): Promise<ExpenseImportResult> {
		return apiClient.post<ExpenseImportResult>('/api/v1/expenses/import', {
			csv,
			dryRun,
			...(mapping ? { mapping } : {})
		});
	},

	// Matches a known tracker by header names only; null means the user maps columns manually.
	async detectImportSource(headers: string[]): Promise<ImportMappingPreset | null> {
		return apiClient.post<ImportMappingPreset | null>('/api/v1/expenses/import/detect', {
			headers
		});
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
		// Edit only: an emptied description is sent as null so it can be cleared.
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
