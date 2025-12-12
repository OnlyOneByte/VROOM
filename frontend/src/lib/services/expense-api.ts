import type { Expense, ApiResponse } from '$lib/types';
import { ApiError, handleApiError } from '$lib/utils/error-handling';
import {
	fromBackendExpense,
	fromBackendExpenses,
	toBackendExpense,
	type BackendExpenseResponse
} from './api-transformer';

/**
 * Expense API service
 * Centralized API calls for expense-related operations with field name transformations
 */
export const expenseApi = {
	/**
	 * Fetch expenses for a specific vehicle
	 * @throws {ApiError} If the request fails
	 */
	async getExpensesByVehicle(
		vehicleId: string,
		vehicleType?: 'gas' | 'electric' | 'hybrid'
	): Promise<Expense[]> {
		try {
			const response = await fetch(`/api/v1/expenses?vehicleId=${vehicleId}`, {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new ApiError('Failed to load expenses', response.status);
			}

			const result: ApiResponse<BackendExpenseResponse[]> = await response.json();
			const data = result.data || result || [];

			// Validate that we received an array
			if (!Array.isArray(data)) {
				console.warn('Invalid expenses data received, expected array');
				return [];
			}

			// Transform backend expenses to frontend format
			return data.map(expense => fromBackendExpense(expense, vehicleType));
		} catch (error) {
			throw handleApiError(error, 'Failed to load expenses');
		}
	},

	/**
	 * Fetch all expenses for the current user
	 * @throws {ApiError} If the request fails
	 */
	async getAllExpenses(
		vehicleTypeMap?: Map<string, 'gas' | 'electric' | 'hybrid'>
	): Promise<Expense[]> {
		try {
			const response = await fetch('/api/v1/expenses', {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new ApiError('Failed to load expenses', response.status);
			}

			const result: ApiResponse<BackendExpenseResponse[]> = await response.json();
			const data = result.data || [];

			if (!Array.isArray(data)) {
				console.warn('Invalid expenses data received, expected array');
				return [];
			}

			// Transform backend expenses to frontend format
			return fromBackendExpenses(data, vehicleTypeMap);
		} catch (error) {
			throw handleApiError(error, 'Failed to load expenses');
		}
	},

	/**
	 * Create a new expense
	 * @throws {ApiError} If the request fails
	 */
	async createExpense(
		expense: Partial<Expense> & { vehicleId: string; category: string; amount: number }
	): Promise<Expense> {
		try {
			// Transform to backend format
			const backendExpense = toBackendExpense(expense);

			const response = await fetch('/api/v1/expenses', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify(backendExpense)
			});

			if (!response.ok) {
				const result = await response.json();
				throw new ApiError(result.message || 'Failed to create expense', response.status);
			}

			const result: ApiResponse<BackendExpenseResponse> = await response.json();
			if (!result.data) {
				throw new ApiError('Invalid response format', 500);
			}

			// Transform response back to frontend format
			return fromBackendExpense(result.data);
		} catch (error) {
			throw handleApiError(error, 'Failed to create expense');
		}
	},

	/**
	 * Update an existing expense
	 * @throws {ApiError} If the request fails
	 */
	async updateExpense(
		expenseId: string,
		expense: Partial<Expense> & { vehicleId: string; category: string; amount: number }
	): Promise<Expense> {
		try {
			// Transform to backend format
			const backendExpense = toBackendExpense(expense);

			const response = await fetch(`/api/v1/expenses/${expenseId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify(backendExpense)
			});

			if (!response.ok) {
				const result = await response.json();
				throw new ApiError(result.message || 'Failed to update expense', response.status);
			}

			const result: ApiResponse<BackendExpenseResponse> = await response.json();
			if (!result.data) {
				throw new ApiError('Invalid response format', 500);
			}

			// Transform response back to frontend format
			return fromBackendExpense(result.data);
		} catch (error) {
			throw handleApiError(error, 'Failed to update expense');
		}
	},

	/**
	 * Delete an expense
	 * @throws {ApiError} If the request fails
	 */
	async deleteExpense(expenseId: string): Promise<void> {
		try {
			const response = await fetch(`/api/v1/expenses/${expenseId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!response.ok) {
				const result = await response.json();
				throw new ApiError(result.message || 'Failed to delete expense', response.status);
			}
		} catch (error) {
			throw handleApiError(error, 'Failed to delete expense');
		}
	}
};
