import type { VehicleFormData, VehicleFormErrors, FinancingFormErrors } from '$lib/types';

interface FinancingFormData {
	financingType: 'loan' | 'lease' | 'own';
	provider: string;
	originalAmount: number;
	apr: number;
	termMonths: number;
	startDate: string | undefined;
	paymentAmount: number;
}

/**
 * Validate vehicle form fields. Returns an errors object — empty means valid.
 */
export function validateVehicleFields(vehicleForm: VehicleFormData): VehicleFormErrors {
	const errors: VehicleFormErrors = {};

	if (!vehicleForm.make.trim()) {
		errors['make'] = 'Make is required';
	}

	if (!vehicleForm.model.trim()) {
		errors['model'] = 'Model is required';
	}

	if (vehicleForm.year < 1900 || vehicleForm.year > new Date().getFullYear() + 2) {
		errors['year'] = 'Please enter a valid year';
	}

	if (vehicleForm.vin && vehicleForm.vin.trim()) {
		const vinRegex = /^[A-Z0-9]+$/i;
		if (!vinRegex.test(vehicleForm.vin)) {
			errors['vin'] = 'VIN must contain only letters and numbers';
		} else if (vehicleForm.vin.length < 11 || vehicleForm.vin.length > 17) {
			errors['vin'] = 'VIN must be between 11 and 17 characters';
		}
	}

	if (vehicleForm.initialMileage !== undefined && vehicleForm.initialMileage < 0) {
		errors['initialMileage'] = 'Mileage cannot be negative';
	}

	if (vehicleForm.purchasePrice !== undefined && vehicleForm.purchasePrice < 0) {
		errors['purchasePrice'] = 'Purchase price cannot be negative';
	}

	return errors;
}

/**
 * Validate financing form fields. Returns an errors object — empty means valid.
 * Skips validation when ownershipType is 'own'.
 */
export function validateFinancingFields(
	financingForm: FinancingFormData,
	ownershipType: 'own' | 'lease' | 'finance'
): FinancingFormErrors {
	if (ownershipType === 'own') return {};

	const errors: FinancingFormErrors = {};

	if (!financingForm.provider.trim()) {
		errors['provider'] = 'Provider is required';
	}

	if (financingForm.originalAmount <= 0) {
		errors['originalAmount'] = 'Amount must be greater than 0';
	}

	if (financingForm.financingType === 'loan') {
		if (financingForm.apr < 0 || financingForm.apr > 50) {
			errors['apr'] = 'APR must be between 0% and 50%';
		}
	}

	if (financingForm.termMonths < 1 || financingForm.termMonths > 600) {
		errors['termMonths'] = 'Term must be between 1 and 600 months';
	}

	if (!financingForm.startDate) {
		errors['startDate'] = 'Start date is required';
	}

	if (financingForm.paymentAmount <= 0) {
		errors['paymentAmount'] = 'Payment amount must be greater than 0';
	}

	return errors;
}
