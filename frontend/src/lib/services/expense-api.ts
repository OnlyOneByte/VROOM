import type { Expense } from '$lib/types';
import {
	fromBackendExpense,
	fromBackendExpenses,
	toBackendExpense,
	type BackendExpenseResponse
} from './api-transformer';
import { apiClient } from './api-client';

/**
 * Expense API service
 * All expense API calls go through here to ensure field name transformations
 * (backend `expenseAmount`/`fuelAmount` ↔ frontend `amount`/`volume`/`charge`)
 */
export const expenseApi = {
	async getExpense(
		expenseId: string,
		vehicleType?: 'gas' | 'electric' | 'hybrid'
	): Promise<Expense> {
		const data = await apiClient.get<BackendExpenseResponse>(`/api/v1/expenses/${expenseId}`);
		return fromBackendExpense(data, vehicleType);
	},

	async getExpensesByVehicle(
		vehicleId: string,
		vehicleType?: 'gas' | 'electric' | 'hybrid'
	): Promise<Expense[]> {
		const data = await apiClient.get<BackendExpenseResponse[]>(
			`/api/v1/expenses?vehicleId=${vehicleId}`
		);
		if (!Array.isArray(data)) return [];
		return data.map(expense => fromBackendExpense(expense, vehicleType));
	},

	async getAllExpenses(
		vehicleTypeMap?: Map<string, 'gas' | 'electric' | 'hybrid'>
	): Promise<Expense[]> {
		const data = await apiClient.get<BackendExpenseResponse[]>('/api/v1/expenses');
		if (!Array.isArray(data)) return [];
		return fromBackendExpenses(data, vehicleTypeMap);
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
	}
};
