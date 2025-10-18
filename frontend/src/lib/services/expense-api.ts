import type { Expense, ApiResponse } from '$lib/types';
import { ApiError, handleApiError } from '$lib/utils/error-handling';

/**
 * Expense API service
 * Centralized API calls for expense-related operations
 */
export const expenseApi = {
	/**
	 * Fetch expenses for a specific vehicle
	 * @throws {ApiError} If the request fails
	 */
	async getExpensesByVehicle(vehicleId: string): Promise<Expense[]> {
		try {
			const response = await fetch(`/api/expenses?vehicleId=${vehicleId}`, {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new ApiError('Failed to load expenses', response.status);
			}

			const result: ApiResponse<Expense[]> = await response.json();
			const data = result.data || result || [];

			// Validate that we received an array
			if (!Array.isArray(data)) {
				console.warn('Invalid expenses data received, expected array');
				return [];
			}

			return data;
		} catch (error) {
			throw handleApiError(error, 'Failed to load expenses');
		}
	},

	/**
	 * Fetch all expenses for the current user
	 * @throws {ApiError} If the request fails
	 */
	async getAllExpenses(): Promise<Expense[]> {
		try {
			const response = await fetch('/api/expenses', {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new ApiError('Failed to load expenses', response.status);
			}

			const result: ApiResponse<Expense[]> = await response.json();
			const data = result.data || [];

			if (!Array.isArray(data)) {
				console.warn('Invalid expenses data received, expected array');
				return [];
			}

			return data;
		} catch (error) {
			throw handleApiError(error, 'Failed to load expenses');
		}
	},

	/**
	 * Delete an expense
	 * @throws {ApiError} If the request fails
	 */
	async deleteExpense(expenseId: string): Promise<void> {
		try {
			const response = await fetch(`/api/expenses/${expenseId}`, {
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
