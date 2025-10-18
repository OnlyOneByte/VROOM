import { appStore } from '$lib/stores/app.js';

export interface AppError {
	message: string;
	code?: string | undefined;
	statusCode?: number | undefined;
	details?: Record<string, unknown> | undefined;
}

export class VroomError extends Error {
	public readonly code?: string | undefined;
	public readonly statusCode?: number | undefined;
	public readonly details?: Record<string, unknown> | undefined;

	constructor(
		message: string,
		code?: string,
		statusCode?: number,
		details?: Record<string, unknown>
	) {
		super(message);
		this.name = 'VroomError';
		this.code = code ?? undefined;
		this.statusCode = statusCode ?? undefined;
		this.details = details ?? undefined;
	}
}

/**
 * API-specific error class for HTTP errors
 */
export class ApiError extends VroomError {
	constructor(message: string, statusCode: number, details?: Record<string, unknown>) {
		super(message, 'API_ERROR', statusCode, details);
		this.name = 'ApiError';
	}
}

// Error type guards
export function isVroomError(error: unknown): error is VroomError {
	return error instanceof VroomError;
}

export function isNetworkError(error: unknown): boolean {
	return error instanceof TypeError && error.message.includes('fetch');
}

/**
 * Enhanced error handling with fallback message support
 * @param error - The error to handle
 * @param fallbackMessage - Optional fallback message if error is not descriptive
 * @returns Standardized AppError object
 */
export function handleApiError(error: unknown, fallbackMessage?: string): AppError {
	if (isVroomError(error)) {
		return {
			message: error.message,
			code: error.code,
			statusCode: error.statusCode,
			details: error.details
		};
	}

	if (isNetworkError(error)) {
		return {
			message: 'Network error. Please check your connection and try again.',
			code: 'NETWORK_ERROR',
			statusCode: 0
		};
	}

	const message =
		fallbackMessage || (error instanceof Error ? error.message : 'An unexpected error occurred');

	return {
		message,
		code: 'UNKNOWN_ERROR'
	};
}

// API response error handler
export async function handleApiResponse(response: Response): Promise<unknown> {
	if (!response.ok) {
		let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
		let errorDetails: Record<string, unknown> = {};

		try {
			const errorData = await response.json();
			errorMessage = errorData.message || errorMessage;
			errorDetails = errorData.details || {};
		} catch {
			// If we can't parse the error response, use the default message
		}

		throw new VroomError(errorMessage, 'API_ERROR', response.status, errorDetails);
	}

	try {
		return await response.json();
	} catch {
		// If response has no body or invalid JSON, return null
		return null;
	}
}

// Global error handler with user notification
export function handleErrorWithNotification(error: unknown, context?: string): void {
	const appError = handleApiError(error);
	const message = context ? `${context}: ${appError.message}` : appError.message;

	console.error('Application error:', appError);

	appStore.addNotification({
		type: 'error',
		message,
		duration: 5000
	});
}

// Async operation wrapper with error handling
export async function withErrorHandling<T>(
	operation: () => Promise<T>,
	context?: string
): Promise<T | null> {
	try {
		return await operation();
	} catch (error) {
		handleErrorWithNotification(error, context);
		return null;
	}
}

// Form submission error handler
export function handleFormError(error: unknown): Record<string, string> {
	const appError = handleApiError(error);

	if (appError.statusCode === 400 && appError.details) {
		// Return field-specific errors for form validation
		return appError.details as Record<string, string>;
	}

	// Return general error
	return { general: appError.message };
}

// Retry utility for failed operations
export async function retryOperation<T>(
	operation: () => Promise<T>,
	maxRetries = 3,
	delay = 1000
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;

			if (attempt === maxRetries) {
				break;
			}

			// Exponential backoff
			await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)));
		}
	}

	throw lastError;
}

// Error boundary for Svelte components
export function createErrorBoundary() {
	let hasError = false;
	let error: AppError | null = null;

	return {
		get hasError() {
			return hasError;
		},
		get error() {
			return error;
		},
		catch(err: unknown) {
			hasError = true;
			error = handleApiError(err);
			console.error('Component error boundary caught:', error);
		},
		reset() {
			hasError = false;
			error = null;
		}
	};
}
