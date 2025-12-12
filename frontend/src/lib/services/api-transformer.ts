/**
 * API Transformation Layer
 *
 * Transforms frontend data models to backend API contracts and vice versa.
 * Handles field name mappings between frontend (amount, volume, charge) and
 * backend (expenseAmount, fuelAmount).
 */

import type { Expense } from '$lib/types';

/**
 * Backend expense request format (what we send to the API)
 */
export interface BackendExpenseRequest {
	vehicleId: string;
	tags: string[];
	category: string;
	expenseAmount: number; // Backend field name
	date: string;
	mileage?: number;
	fuelAmount?: number; // Backend field name (unified for volume/charge)
	fuelType?: string;
	description?: string;
	receiptUrl?: string;
}

/**
 * Backend expense response format (what we receive from the API)
 */
export interface BackendExpenseResponse {
	id: string;
	vehicleId: string;
	tags: string[];
	category: string;
	expenseAmount: number; // Backend field name
	date: string;
	mileage?: number;
	fuelAmount?: number; // Backend field name (unified for volume/charge)
	fuelType?: string;
	description?: string;
	receiptUrl?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Transform frontend expense to backend request format
 * Maps: amount → expenseAmount, volume → fuelAmount, charge → fuelAmount
 */
export function toBackendExpense(
	frontendExpense: Partial<Expense> & { vehicleId: string; category: string; amount: number }
): BackendExpenseRequest {
	const backendExpense: BackendExpenseRequest = {
		vehicleId: frontendExpense.vehicleId,
		tags: frontendExpense.tags || [],
		category: frontendExpense.category,
		expenseAmount: frontendExpense.amount, // amount → expenseAmount
		date: frontendExpense.date || new Date().toISOString()
	};

	// Map volume or charge to fuelAmount
	if (frontendExpense.volume !== undefined && frontendExpense.volume !== null) {
		backendExpense.fuelAmount = frontendExpense.volume;
	} else if (frontendExpense.charge !== undefined && frontendExpense.charge !== null) {
		backendExpense.fuelAmount = frontendExpense.charge;
	}

	// Optional fields
	if (frontendExpense.mileage !== undefined) {
		backendExpense.mileage = frontendExpense.mileage;
	}
	if (frontendExpense.fuelType) {
		backendExpense.fuelType = frontendExpense.fuelType;
	}
	if (frontendExpense.description) {
		backendExpense.description = frontendExpense.description;
	}
	if (frontendExpense.receiptUrl) {
		backendExpense.receiptUrl = frontendExpense.receiptUrl;
	}

	return backendExpense;
}

/**
 * Transform backend expense response to frontend format
 * Maps: expenseAmount → amount, fuelAmount → volume or charge (based on vehicle type)
 *
 * Note: For proper charge vs volume mapping, vehicle type should be provided.
 * If not provided, defaults to mapping fuelAmount → volume.
 */
export function fromBackendExpense(
	backendExpense: BackendExpenseResponse,
	vehicleType?: 'gas' | 'electric' | 'hybrid'
): Expense {
	const frontendExpense: Expense = {
		id: backendExpense.id,
		vehicleId: backendExpense.vehicleId,
		tags: backendExpense.tags || [],
		category: backendExpense.category,
		amount: backendExpense.expenseAmount, // expenseAmount → amount
		date: backendExpense.date,
		createdAt: backendExpense.createdAt,
		updatedAt: backendExpense.updatedAt
	};

	// Map fuelAmount to volume or charge based on vehicle type
	if (backendExpense.fuelAmount !== undefined && backendExpense.fuelAmount !== null) {
		if (vehicleType === 'electric') {
			frontendExpense.charge = backendExpense.fuelAmount;
		} else {
			// Default to volume for gas/hybrid or unknown vehicle types
			frontendExpense.volume = backendExpense.fuelAmount;
		}
	}

	// Optional fields
	if (backendExpense.mileage !== undefined) {
		frontendExpense.mileage = backendExpense.mileage;
	}
	if (backendExpense.fuelType) {
		frontendExpense.fuelType = backendExpense.fuelType;
	}
	if (backendExpense.description) {
		frontendExpense.description = backendExpense.description;
	}

	return frontendExpense;
}

/**
 * Transform array of backend expenses to frontend format
 */
export function fromBackendExpenses(
	backendExpenses: BackendExpenseResponse[],
	vehicleTypeMap?: Map<string, 'gas' | 'electric' | 'hybrid'>
): Expense[] {
	return backendExpenses.map(expense => {
		const vehicleType = vehicleTypeMap?.get(expense.vehicleId);
		return fromBackendExpense(expense, vehicleType);
	});
}

/**
 * Check if an expense object uses backend field names
 */
export function hasBackendFieldNames(expense: Record<string, unknown>): boolean {
	return 'expenseAmount' in expense || 'fuelAmount' in expense;
}

/**
 * Check if an expense object uses frontend field names
 */
export function hasFrontendFieldNames(expense: Record<string, unknown>): boolean {
	return 'amount' in expense || 'volume' in expense || 'charge' in expense;
}
