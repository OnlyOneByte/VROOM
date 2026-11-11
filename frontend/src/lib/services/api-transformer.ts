/** Maps frontend expense models to and from the backend API contract. */

import type { Expense, ExpenseCategory } from '$lib/types';
import { isElectricFuelType } from '$lib/utils/units';

interface BackendExpenseRequest {
	vehicleId: string;
	tags: string[];
	category: string;
	expenseAmount: number;
	date: string;
	mileage?: number;
	volume?: number;
	fuelType?: string;
	// `null` clears the stored value on edit; omitted/undefined leaves it unchanged.
	description?: string | null;
	location?: string | null;
	missedFillup?: boolean;
	sourceType?: string;
	sourceId?: string;
}

interface ToBackendOptions {
	// Edit only: an emptied description/location is sent as null so it gets cleared.
	isEdit?: boolean;
}

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
	description?: string | null;
	location?: string | null;
	missedFillup?: boolean;
	sourceType?: string;
	sourceId?: string;
	groupId?: string;
	groupTotal?: number;
	splitMethod?: string;
	createdAt: string;
	updatedAt: string;
}

export function toBackendExpense(
	frontendExpense: Partial<Expense> & {
		vehicleId: string;
		category: ExpenseCategory;
		amount: number;
	},
	options: ToBackendOptions = {}
): BackendExpenseRequest {
	const backendExpense: BackendExpenseRequest = {
		vehicleId: frontendExpense.vehicleId,
		tags: frontendExpense.tags || [],
		category: frontendExpense.category,
		expenseAmount: frontendExpense.amount,
		date: frontendExpense.date || new Date().toISOString()
	};

	if (isElectricFuelType(frontendExpense.fuelType)) {
		if (frontendExpense.charge !== undefined && frontendExpense.charge !== null) {
			backendExpense.volume = frontendExpense.charge;
		}
	} else {
		if (frontendExpense.volume !== undefined && frontendExpense.volume !== null) {
			backendExpense.volume = frontendExpense.volume;
		}
	}

	if (frontendExpense.mileage !== undefined) {
		backendExpense.mileage = frontendExpense.mileage;
	}
	if (frontendExpense.fuelType) {
		backendExpense.fuelType = frontendExpense.fuelType;
	}
	if (frontendExpense.description) {
		backendExpense.description = frontendExpense.description;
	} else if (options.isEdit) {
		backendExpense.description = null;
	}
	if (frontendExpense.location) {
		backendExpense.location = frontendExpense.location;
	} else if (options.isEdit) {
		backendExpense.location = null;
	}
	if (frontendExpense.sourceType) {
		backendExpense.sourceType = frontendExpense.sourceType;
	}
	if (frontendExpense.sourceId) {
		backendExpense.sourceId = frontendExpense.sourceId;
	}
	if (frontendExpense.missedFillup !== undefined) {
		backendExpense.missedFillup = frontendExpense.missedFillup;
	}

	return backendExpense;
}

export function fromBackendExpense(backendExpense: BackendExpenseResponse): Expense {
	const frontendExpense: Expense = {
		id: backendExpense.id,
		vehicleId: backendExpense.vehicleId,
		userId: backendExpense.userId,
		tags: backendExpense.tags || [],
		category: backendExpense.category as ExpenseCategory,
		amount: backendExpense.expenseAmount,
		date: backendExpense.date,
		missedFillup: backendExpense.missedFillup ?? false,
		createdAt: backendExpense.createdAt,
		updatedAt: backendExpense.updatedAt
	};

	if (backendExpense.volume !== undefined && backendExpense.volume !== null) {
		if (isElectricFuelType(backendExpense.fuelType)) {
			frontendExpense.charge = backendExpense.volume;
		} else {
			frontendExpense.volume = backendExpense.volume;
		}
	}

	if (backendExpense.mileage !== undefined) {
		frontendExpense.mileage = backendExpense.mileage;
	}
	if (backendExpense.fuelType) {
		frontendExpense.fuelType = backendExpense.fuelType;
	}
	if (backendExpense.description) {
		frontendExpense.description = backendExpense.description;
	}
	if (backendExpense.location) {
		frontendExpense.location = backendExpense.location;
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
	if (backendExpense.sourceType) {
		frontendExpense.sourceType = backendExpense.sourceType;
	}
	if (backendExpense.sourceId) {
		frontendExpense.sourceId = backendExpense.sourceId;
	}

	return frontendExpense;
}
