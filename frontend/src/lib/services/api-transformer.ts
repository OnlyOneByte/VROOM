/**
 * API Transformation Layer
 *
 * Transforms frontend data models to backend API contracts and vice versa.
 * Handles field name mappings between frontend (amount, volume, charge) and
 * backend (expenseAmount, fuelAmount).
 */

import type { Expense, ExpenseCategory } from '$lib/types';
import { isElectricFuelType } from '$lib/utils/units';

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
	isFinancingPayment?: boolean;
	missedFillup?: boolean;
}

/**
 * Backend expense response format (what we receive from the API)
 */
export interface BackendExpenseResponse {
	id: string;
	vehicleId: string;
	userId: string;
	tags: string[];
	category: string;
	expenseAmount: number; // Backend field name
	date: string;
	mileage?: number;
	fuelAmount?: number; // Backend field name (unified for volume/charge)
	fuelType?: string;
	description?: string;
	receiptUrl?: string;
	isFinancingPayment?: boolean;
	missedFillup?: boolean;
	groupId?: string; // Non-null means this is a split child expense
	groupTotal?: number;
	splitMethod?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Transform frontend expense to backend request format
 * Maps: amount → expenseAmount, volume → fuelAmount, charge → fuelAmount
 */
export function toBackendExpense(
	frontendExpense: Partial<Expense> & {
		vehicleId: string;
		category: ExpenseCategory;
		amount: number;
	}
): BackendExpenseRequest {
	const backendExpense: BackendExpenseRequest = {
		vehicleId: frontendExpense.vehicleId,
		tags: frontendExpense.tags || [],
		category: frontendExpense.category,
		expenseAmount: frontendExpense.amount, // amount → expenseAmount
		date: frontendExpense.date || new Date().toISOString()
	};

	// Map volume or charge to fuelAmount based on fuelType
	if (isElectricFuelType(frontendExpense.fuelType)) {
		if (frontendExpense.charge !== undefined && frontendExpense.charge !== null) {
			backendExpense.fuelAmount = frontendExpense.charge;
		}
	} else {
		if (frontendExpense.volume !== undefined && frontendExpense.volume !== null) {
			backendExpense.fuelAmount = frontendExpense.volume;
		}
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
	if (frontendExpense.isFinancingPayment !== undefined) {
		backendExpense.isFinancingPayment = frontendExpense.isFinancingPayment;
	}
	if (frontendExpense.missedFillup !== undefined) {
		backendExpense.missedFillup = frontendExpense.missedFillup;
	}

	return backendExpense;
}

/**
 * Transform backend expense response to frontend format
 * Maps: expenseAmount → amount, fuelAmount → volume or charge (based on fuelType)
 *
 * Uses isElectricFuelType(fuelType) as the sole discriminator — no vehicleType needed.
 */
export function fromBackendExpense(backendExpense: BackendExpenseResponse): Expense {
	const frontendExpense: Expense = {
		id: backendExpense.id,
		vehicleId: backendExpense.vehicleId,
		userId: backendExpense.userId,
		tags: backendExpense.tags || [],
		category: backendExpense.category as ExpenseCategory,
		amount: backendExpense.expenseAmount, // expenseAmount → amount
		date: backendExpense.date,
		isFinancingPayment: backendExpense.isFinancingPayment ?? false,
		missedFillup: backendExpense.missedFillup ?? false,
		createdAt: backendExpense.createdAt,
		updatedAt: backendExpense.updatedAt
	};

	// Map fuelAmount to volume or charge based on fuelType
	if (backendExpense.fuelAmount !== undefined && backendExpense.fuelAmount !== null) {
		if (isElectricFuelType(backendExpense.fuelType)) {
			frontendExpense.charge = backendExpense.fuelAmount;
		} else {
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
	if (backendExpense.groupId) {
		frontendExpense.groupId = backendExpense.groupId;
	}
	if (backendExpense.groupTotal !== undefined) {
		frontendExpense.groupTotal = backendExpense.groupTotal;
	}
	if (backendExpense.splitMethod) {
		frontendExpense.splitMethod = backendExpense.splitMethod;
	}

	return frontendExpense;
}
