/**
 * API Transformation Layer
 *
 * Transforms frontend data models to backend API contracts and vice versa.
 * v2: Backend uses `volume` directly — no fuelAmount bridging needed.
 * Maps: frontend amount ↔ backend expenseAmount, frontend volume/charge ↔ backend volume.
 */

import type { Expense, ExpenseCategory } from '$lib/types';
import { isElectricFuelType } from '$lib/utils/units';

/**
 * Backend expense request format (what we send to the API).
 * Internal to this module — not exported since no external consumer needs it.
 */
interface BackendExpenseRequest {
	vehicleId: string;
	tags: string[];
	category: string;
	expenseAmount: number;
	date: string;
	mileage?: number;
	volume?: number;
	fuelType?: string;
	description?: string;
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
	expenseAmount: number;
	date: string;
	mileage?: number;
	volume?: number;
	fuelType?: string;
	description?: string;
	isFinancingPayment?: boolean;
	missedFillup?: boolean;
	groupId?: string;
	groupTotal?: number;
	splitMethod?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Transform frontend expense to backend request format
 * Maps: amount → expenseAmount, volume/charge → volume
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
		expenseAmount: frontendExpense.amount,
		date: frontendExpense.date || new Date().toISOString()
	};

	// Map volume or charge to backend volume field
	if (isElectricFuelType(frontendExpense.fuelType)) {
		if (frontendExpense.charge !== undefined && frontendExpense.charge !== null) {
			backendExpense.volume = frontendExpense.charge;
		}
	} else {
		if (frontendExpense.volume !== undefined && frontendExpense.volume !== null) {
			backendExpense.volume = frontendExpense.volume;
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
 * Maps: expenseAmount → amount, volume → volume or charge (based on fuelType)
 */
export function fromBackendExpense(backendExpense: BackendExpenseResponse): Expense {
	const frontendExpense: Expense = {
		id: backendExpense.id,
		vehicleId: backendExpense.vehicleId,
		userId: backendExpense.userId,
		tags: backendExpense.tags || [],
		category: backendExpense.category as ExpenseCategory,
		amount: backendExpense.expenseAmount,
		date: backendExpense.date,
		isFinancingPayment: backendExpense.isFinancingPayment ?? false,
		missedFillup: backendExpense.missedFillup ?? false,
		createdAt: backendExpense.createdAt,
		updatedAt: backendExpense.updatedAt
	};

	// Map backend volume to frontend volume or charge based on fuelType
	if (backendExpense.volume !== undefined && backendExpense.volume !== null) {
		if (isElectricFuelType(backendExpense.fuelType)) {
			frontendExpense.charge = backendExpense.volume;
		} else {
			frontendExpense.volume = backendExpense.volume;
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
