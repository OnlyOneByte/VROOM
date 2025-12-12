/**
 * Validation Rules Constants
 *
 * These constants mirror the backend CONFIG.validation rules to ensure
 * consistent validation between frontend and backend.
 *
 * Source: backend/src/config.ts
 */

/**
 * Vehicle validation limits
 */
export const VEHICLE_VALIDATION = {
	makeMaxLength: 50,
	modelMaxLength: 50,
	nicknameMaxLength: 50,
	licensePlateMaxLength: 20,
	minYear: 1900,
	maxYear: new Date().getFullYear() + 1,
	vinMinLength: 11,
	vinMaxLength: 17
} as const;

/**
 * Expense validation limits
 */
export const EXPENSE_VALIDATION = {
	descriptionMaxLength: 500,
	maxAmount: 1_000_000,
	maxTags: 10,
	tagMaxLength: 50,
	fuelTypeMaxLength: 50
} as const;

/**
 * Insurance validation limits
 */
export const INSURANCE_VALIDATION = {
	companyMaxLength: 100,
	policyNumberMaxLength: 50,
	maxTermMonths: 24
} as const;

/**
 * Financing validation limits
 */
export const FINANCING_VALIDATION = {
	providerMaxLength: 100,
	maxApr: 50,
	maxTermMonths: 600,
	minDayOfMonth: 1,
	maxDayOfMonth: 31,
	minDayOfWeek: 0,
	maxDayOfWeek: 6
} as const;

/**
 * Settings validation limits
 */
export const SETTINGS_VALIDATION = {
	maxBackupRetention: 100,
	maxSyncInactivityMinutes: 30,
	minSyncInactivityMinutes: 1
} as const;

/**
 * Validate vehicle make
 */
export function validateMake(make: string): string | null {
	if (!make || make.trim().length === 0) {
		return 'Make is required';
	}
	if (make.length > VEHICLE_VALIDATION.makeMaxLength) {
		return `Make must be ${VEHICLE_VALIDATION.makeMaxLength} characters or less`;
	}
	return null;
}

/**
 * Validate vehicle model
 */
export function validateModel(model: string): string | null {
	if (!model || model.trim().length === 0) {
		return 'Model is required';
	}
	if (model.length > VEHICLE_VALIDATION.modelMaxLength) {
		return `Model must be ${VEHICLE_VALIDATION.modelMaxLength} characters or less`;
	}
	return null;
}

/**
 * Validate vehicle year
 */
export function validateYear(year: number): string | null {
	if (!year) {
		return 'Year is required';
	}
	if (year < VEHICLE_VALIDATION.minYear) {
		return `Year must be ${VEHICLE_VALIDATION.minYear} or later`;
	}
	if (year > VEHICLE_VALIDATION.maxYear) {
		return 'Year cannot be in the future';
	}
	return null;
}

/**
 * Validate expense amount
 */
export function validateExpenseAmount(amount: number): string | null {
	if (!amount || amount <= 0) {
		return 'Amount must be greater than 0';
	}
	if (amount > EXPENSE_VALIDATION.maxAmount) {
		return `Amount cannot exceed ${EXPENSE_VALIDATION.maxAmount.toLocaleString()}`;
	}
	return null;
}

/**
 * Validate expense description
 */
export function validateExpenseDescription(description: string): string | null {
	if (description && description.length > EXPENSE_VALIDATION.descriptionMaxLength) {
		return `Description must be ${EXPENSE_VALIDATION.descriptionMaxLength} characters or less`;
	}
	return null;
}

/**
 * Validate expense tags
 */
export function validateExpenseTags(tags: string[]): string | null {
	if (tags.length > EXPENSE_VALIDATION.maxTags) {
		return `Maximum ${EXPENSE_VALIDATION.maxTags} tags allowed`;
	}
	for (const tag of tags) {
		if (tag.length > EXPENSE_VALIDATION.tagMaxLength) {
			return `Tag "${tag}" exceeds ${EXPENSE_VALIDATION.tagMaxLength} characters`;
		}
	}
	return null;
}

/**
 * Validate financing APR
 */
export function validateApr(apr: number | undefined): string | null {
	if (apr === undefined || apr === null) {
		return null; // APR is optional
	}
	if (apr < 0) {
		return 'APR cannot be negative';
	}
	if (apr > FINANCING_VALIDATION.maxApr) {
		return `APR cannot exceed ${FINANCING_VALIDATION.maxApr}%`;
	}
	return null;
}

/**
 * Validate financing term
 */
export function validateTermMonths(termMonths: number): string | null {
	if (!termMonths || termMonths <= 0) {
		return 'Term must be at least 1 month';
	}
	if (termMonths > FINANCING_VALIDATION.maxTermMonths) {
		return `Term cannot exceed ${FINANCING_VALIDATION.maxTermMonths} months`;
	}
	return null;
}

/**
 * Validate loan terms (used by financing calculations)
 */
export function validateLoanTerms(params: {
	principal: number;
	apr: number;
	termMonths: number;
}): string[] {
	const errors: string[] = [];

	if (params.principal <= 0) {
		errors.push('Principal must be greater than 0');
	}

	if (params.apr < 0) {
		errors.push('APR cannot be negative');
	}

	if (params.apr > FINANCING_VALIDATION.maxApr) {
		errors.push(`APR cannot exceed ${FINANCING_VALIDATION.maxApr}%`);
	}

	if (params.termMonths <= 0) {
		errors.push('Term must be at least 1 month');
	}

	if (params.termMonths > FINANCING_VALIDATION.maxTermMonths) {
		errors.push(`Term cannot exceed ${FINANCING_VALIDATION.maxTermMonths} months`);
	}

	return errors;
}

/**
 * Validate sync inactivity minutes
 */
export function validateSyncInactivityMinutes(minutes: number): string | null {
	if (minutes < SETTINGS_VALIDATION.minSyncInactivityMinutes) {
		return `Sync inactivity must be at least ${SETTINGS_VALIDATION.minSyncInactivityMinutes} minute`;
	}
	if (minutes > SETTINGS_VALIDATION.maxSyncInactivityMinutes) {
		return `Sync inactivity cannot exceed ${SETTINGS_VALIDATION.maxSyncInactivityMinutes} minutes`;
	}
	return null;
}
