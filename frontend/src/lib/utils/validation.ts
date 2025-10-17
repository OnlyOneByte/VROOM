import { z } from 'zod';

// Common validation schemas
export const emailSchema = z.string().email('Please enter a valid email address');

export const requiredStringSchema = (fieldName: string) =>
	z.string().min(1, `${fieldName} is required`);

export const positiveNumberSchema = (fieldName: string) =>
	z.number().positive(`${fieldName} must be a positive number`);

export const yearSchema = z
	.number()
	.int()
	.min(1900, 'Year must be 1900 or later')
	.max(new Date().getFullYear() + 1, 'Year cannot be in the future');

// Vehicle validation schemas
export const vehicleSchema = z.object({
	make: requiredStringSchema('Make'),
	model: requiredStringSchema('Model'),
	year: yearSchema,
	licensePlate: z.string().optional(),
	vin: z.string().optional(),
	purchasePrice: z.number().optional(),
	purchaseDate: z.string().optional(),
	initialMileage: z.number().min(0, 'Initial mileage cannot be negative').optional()
});

// Expense validation schemas
export const expenseSchema = z.object({
	amount: positiveNumberSchema('Amount'),
	description: requiredStringSchema('Description'),
	category: requiredStringSchema('Category'),
	type: requiredStringSchema('Type'),
	date: z.string().min(1, 'Date is required'),
	mileage: z.number().min(0, 'Mileage cannot be negative').optional(),
	gallons: z.number().positive('Gallons must be positive').optional(),
	location: z.string().optional(),
	notes: z.string().optional()
});

// Financing validation schemas
export const financingSchema = z.object({
	financingType: z.enum(['loan', 'lease', 'own']),
	provider: requiredStringSchema('Provider'),
	originalAmount: positiveNumberSchema('Original amount'),
	apr: z.number().min(0, 'APR cannot be negative').max(50, 'APR cannot exceed 50%').optional(),
	termMonths: z.number().int().positive('Term must be a positive number of months'),
	startDate: z.string().min(1, 'Start date is required'),
	paymentAmount: positiveNumberSchema('Payment amount'),
	paymentFrequency: z.enum(['monthly', 'bi-weekly', 'weekly']),
	// Lease-specific fields
	residualValue: z.number().min(0).optional(),
	mileageLimit: z.number().int().min(0).optional(),
	excessMileageFee: z.number().min(0).optional()
});

// Form validation helper
export function validateForm<T>(
	schema: z.ZodSchema<T>,
	data: unknown
): {
	success: boolean;
	data?: T;
	errors?: Record<string, string>;
} {
	try {
		const validData = schema.parse(data);
		return { success: true, data: validData };
	} catch (error) {
		if (error instanceof z.ZodError) {
			const errors: Record<string, string> = {};
			error.issues.forEach((err: z.ZodIssue) => {
				const path = err.path.join('.');
				errors[path] = err.message;
			});
			return { success: false, errors };
		}
		return { success: false, errors: { general: 'Validation failed' } };
	}
}

// Field validation helper for real-time validation
export function validateField<T>(
	schema: z.ZodSchema<T>,
	fieldName: string,
	value: unknown
): string | null {
	try {
		const schemaAny = schema as { shape?: Record<string, z.ZodSchema> };
		const fieldSchema = schemaAny.shape?.[fieldName];
		if (fieldSchema) {
			fieldSchema.parse(value);
		}
		return null;
	} catch (error) {
		if (error instanceof z.ZodError) {
			return error.issues[0]?.message || 'Invalid value';
		}
		return 'Invalid value';
	}
}

// Currency formatting
export function formatCurrency(amount: number, currency = 'USD'): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency
	}).format(amount);
}

// Number formatting
export function formatNumber(value: number, decimals = 2): string {
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	}).format(value);
}

// Date formatting
export function formatDate(date: string | Date): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	return new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	}).format(d);
}

// Input sanitization
export function sanitizeInput(input: string): string {
	return input.trim().replace(/[<>]/g, '');
}

// Debounce utility for form validation
export function debounce<T extends (...args: unknown[]) => unknown>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout>;
	return (...args: Parameters<T>) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => func(...args), wait);
	};
}
