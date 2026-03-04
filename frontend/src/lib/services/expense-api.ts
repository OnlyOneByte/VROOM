import type { Expense, ExpenseGroupWithChildren, Photo, SplitConfig } from '$lib/types';
import {
	fromBackendExpense,
	fromBackendExpenses,
	toBackendExpense,
	type BackendExpenseResponse
} from './api-transformer';
import { apiClient, getApiBaseUrl } from './api-client';

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

	async getExpensesByVehicle(vehicleId: string): Promise<Expense[]> {
		const data = await apiClient.get<BackendExpenseResponse[]>(
			`/api/v1/expenses?vehicleId=${vehicleId}`
		);
		if (!Array.isArray(data)) return [];
		return data.map(expense => fromBackendExpense(expense));
	},

	async getAllExpenses(): Promise<Expense[]> {
		const data = await apiClient.get<BackendExpenseResponse[]>('/api/v1/expenses');
		if (!Array.isArray(data)) return [];
		return fromBackendExpenses(data);
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
