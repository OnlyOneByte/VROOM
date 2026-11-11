import type {
	BackendExpenseResponse,
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
import { fromBackendExpense, toBackendExpense } from './api-transformer';
import { apiClient } from './api-client';
import { buildQueryString } from './api-utils';
import { entityPhotos } from './photo-api';
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

type ExpenseExportParams = Pick<
	ExpenseListParams,
	'category' | 'startDate' | 'endDate' | 'search' | 'tags'
> & { vehicleId?: string };

/**
 * Builds the expense list/export query suffix, including the leading '?', or '' when no filter is set.
 * Tags travel as one comma-joined param: the backend schema takes a single string and splits it, and
 * a repeated `tags=` key would arrive as an array and fail validation.
 */
export function buildExpenseQuery(params?: ExpenseListParams, vehicleId?: string): string {
	return buildQueryString({
		vehicleId: vehicleId || undefined,
		limit: params?.limit || undefined,
		offset: params?.offset || undefined,
		category: params?.category || undefined,
		startDate: params?.startDate || undefined,
		endDate: params?.endDate || undefined,
		period: params?.period || undefined,
		search: params?.search?.trim() || undefined,
		sortBy: params?.sortBy,
		sortDir: params?.sortDir,
		tags: params?.tags?.length ? params.tags.join(',') : undefined
	});
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
		return fetchPaginatedExpenses(`/api/v1/expenses${buildExpenseQuery(params, vehicleId)}`);
	},

	async getAllExpenses(params?: ExpenseListParams): Promise<PaginatedExpenseResponse> {
		return fetchPaginatedExpenses(`/api/v1/expenses${buildExpenseQuery(params)}`);
	},

	// Accepts the same filters as the list view so the export matches what the user sees.
	async downloadExpensesCsv(params?: ExpenseExportParams): Promise<void> {
		const { vehicleId, ...filters } = params ?? {};
		const res = await apiClient.raw(
			`/api/v1/expenses/export${buildExpenseQuery(filters, vehicleId)}`
		);
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
		const qs = buildQueryString({
			vehicleId: params?.vehicleId || undefined,
			period: params?.period || undefined
		});
		return apiClient.get<ExpenseSummary>(`/api/v1/expenses/summary${qs}`);
	},

	async getVehicleStats(recentDays?: number): Promise<
		Array<{
			vehicleId: string;
			totalAmount: number;
			recentAmount: number;
			lastExpenseDate: string | null;
		}>
	> {
		return apiClient.get(
			`/api/v1/expenses/vehicle-stats${buildQueryString({ recentDays: recentDays || undefined })}`
		);
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

	getPhotos(
		entityType: 'expense',
		entityId: string,
		params?: { limit?: number; offset?: number }
	): Promise<PaginatedResponse<Photo>> {
		return entityPhotos(entityType, entityId).list(params);
	},

	uploadPhoto(entityType: 'expense', entityId: string, file: File): Promise<Photo> {
		return entityPhotos(entityType, entityId).upload(file);
	},

	deletePhoto(entityType: 'expense', entityId: string, photoId: string): Promise<void> {
		return entityPhotos(entityType, entityId).remove(photoId);
	},

	getPhotoThumbnailUrl(entityType: 'expense', entityId: string, photoId: string): string {
		return entityPhotos(entityType, entityId).thumbnailUrl(photoId);
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
