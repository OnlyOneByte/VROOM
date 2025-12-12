import { appStore } from '$lib/stores/app.js';

/**
 * Backend error response format
 * Matches: { success: false, error: { code, message, details } }
 */
export interface BackendErrorResponse {
	success: false;
	error: {
		code: string;
		message: string;
		details?: unknown;
	};
}

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
 * Error code to user-friendly message mapping
 */
const ERROR_CODE_MESSAGES: Record<string, string> = {
	VALIDATION_ERROR: 'Please check your input and try again',
	NOT_FOUND: 'The requested resource was not found',
	UNAUTHORIZED: 'You need to be logged in to perform this action',
	FORBIDDEN: 'You do not have permission to perform this action',
	CONFLICT: 'This resource already exists or conflicts with existing data',
	RATE_LIMIT_EXCEEDED: 'Too many requests. Please wait a moment and try again',
	DATABASE_ERROR: 'A database error occurred. Please try again',
	NETWORK_ERROR: 'Network error. Please check your connection',
	AUTH_INVALID: 'Your session has expired. Please log in again',
	SYNC_IN_PROGRESS: 'A sync operation is already in progress',
	QUOTA_EXCEEDED: 'Storage quota exceeded',
	PERMISSION_DENIED: 'Permission denied'
};

/**
 * Get user-friendly message for error code
 */
export function getUserFriendlyMessage(code: string | undefined): string | undefined {
	if (!code) return undefined;
	return ERROR_CODE_MESSAGES[code];
}

/**
 * Enhanced error handling with fallback message support
 * @param error - The error to handle
 * @param fallbackMessage - Optional fallback message if error is not descriptive
 * @returns Standardized AppError object
 */
export function handleApiError(error: unknown, fallbackMessage?: string): AppError {
	if (isVroomError(error)) {
		// Use user-friendly message if available
		const friendlyMessage = getUserFriendlyMessage(error.code);
		return {
			message: friendlyMessage || error.message,
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

/**
 * Parse backend error response
 * Handles new format: { success: false, error: { code, message, details } }
 */
export function parseBackendError(errorData: unknown): AppError {
	// Check if it's the new backend error format
	if (
		errorData &&
		typeof errorData === 'object' &&
		'success' in errorData &&
		errorData.success === false &&
		'error' in errorData
	) {
		const backendError = errorData as BackendErrorResponse;
		return {
			message: backendError.error.message,
			code: backendError.error.code,
			details:
				typeof backendError.error.details === 'object'
					? (backendError.error.details as Record<string, unknown>)
					: undefined
		};
	}

	// Fallback to old format
	if (errorData && typeof errorData === 'object' && 'message' in errorData) {
		return {
			message: (errorData as { message: string }).message,
			details: 'details' in errorData ? (errorData.details as Record<string, unknown>) : undefined
		};
	}

	return {
		message: 'An unexpected error occurred'
	};
}

// API response error handler
export async function handleApiResponse(response: Response): Promise<unknown> {
	if (!response.ok) {
		let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
		let errorCode = 'API_ERROR';
		let errorDetails: Record<string, unknown> = {};

		try {
			const errorData = await response.json();
			const parsedError = parseBackendError(errorData);
			errorMessage = parsedError.message;
			errorCode = parsedError.code || errorCode;
			errorDetails = parsedError.details || {};
		} catch {
			// If we can't parse the error response, use the default message
		}

		throw new VroomError(errorMessage, errorCode, response.status, errorDetails);
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

	// Check for validation errors with field-specific details
	if (appError.code === 'VALIDATION_ERROR' && appError.details) {
		// Map error.details to form field errors
		const fieldErrors: Record<string, string> = {};

		// Handle both object and array formats
		if (typeof appError.details === 'object' && appError.details !== null) {
			for (const [field, message] of Object.entries(appError.details)) {
				if (typeof message === 'string') {
					fieldErrors[field] = message;
				}
			}
		}

		// If we found field-specific errors, return them
		if (Object.keys(fieldErrors).length > 0) {
			return fieldErrors;
		}
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
