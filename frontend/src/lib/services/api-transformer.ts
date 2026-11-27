import type {
	BackendExpenseResponse,
	ChargerType,
	Expense,
	ExpenseCategory
} from '#lib/types/index.ts';
import { isElectricFuelType } from '#lib/utils/units.ts';

interface BackendExpenseRequest {
	vehicleId: string;
	tags: string[];
	category: string;
	expenseAmount: number;
	date: string;
	mileage?: number;
	volume?: number;
	fuelType?: string | null;
	chargerType?: ChargerType | null;
	description?: string | null;
	location?: string | null;
	missedFillup?: boolean;
	sourceType?: string | null;
	sourceId?: string | null;
	paidByDriverId?: string | null;
}

interface ToBackendOptions {
	isEdit?: boolean;
}

export type ExpenseInput = Omit<Partial<Expense>, 'sourceType' | 'sourceId'> & {
	sourceType?: string | null;
	sourceId?: string | null;
};

export function toBackendExpense(
	frontendExpense: ExpenseInput & {
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
	} else if (options.isEdit) {
		backendExpense.fuelType = null;
	}
	if (frontendExpense.chargerType) {
		backendExpense.chargerType = frontendExpense.chargerType;
	} else if (options.isEdit || frontendExpense.chargerType === null) {
		backendExpense.chargerType = null;
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
	if (frontendExpense.sourceType && frontendExpense.sourceId) {
		backendExpense.sourceType = frontendExpense.sourceType;
		backendExpense.sourceId = frontendExpense.sourceId;
	} else if (options.isEdit && frontendExpense.sourceType === null) {
		backendExpense.sourceType = null;
		backendExpense.sourceId = null;
	}
	if (frontendExpense.missedFillup !== undefined) {
		backendExpense.missedFillup = frontendExpense.missedFillup;
	}
	if (frontendExpense.paidByDriverId !== undefined) {
		backendExpense.paidByDriverId = frontendExpense.paidByDriverId;
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
	if (backendExpense.chargerType) {
		frontendExpense.chargerType = backendExpense.chargerType;
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
	if (backendExpense.paidByDriverId !== undefined) {
		frontendExpense.paidByDriverId = backendExpense.paidByDriverId;
	}
	if (backendExpense.sourceType) {
		frontendExpense.sourceType = backendExpense.sourceType;
	}
	if (backendExpense.sourceId) {
		frontendExpense.sourceId = backendExpense.sourceId;
	}

	return frontendExpense;
}
