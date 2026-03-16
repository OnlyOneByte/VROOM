import { appStore } from '$lib/stores/app.svelte';

interface AppError {
	message: string;
	code?: string | undefined;
	statusCode?: number | undefined;
	details?: Record<string, unknown> | undefined;
}

class VroomError extends Error {
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
	constructor(
		message: string,
		statusCode: number,
		details?: Record<string, unknown>,
		backendCode?: string
	) {
		super(message, backendCode || 'API_ERROR', statusCode, details);
		this.name = 'ApiError';
	}
}

// Error type guards
function isVroomError(error: unknown): error is VroomError {
	return error instanceof VroomError;
}

function isNetworkError(error: unknown): boolean {
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
function getUserFriendlyMessage(code: string | undefined): string | undefined {
	if (!code) return undefined;
	return ERROR_CODE_MESSAGES[code];
}

/**
 * Enhanced error handling with fallback message support
 * @param error - The error to handle
 * @param fallbackMessage - Optional fallback message if error is not descriptive
 * @returns Standardized AppError object
 */
function handleApiError(error: unknown, fallbackMessage?: string): AppError {
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

// Global error handler with user notification
export function handleErrorWithNotification(error: unknown, context?: string): void {
	const appError = handleApiError(error);
	const message = context ? `${context}: ${appError.message}` : appError.message;

	if (import.meta.env.DEV) {
		console.error('Application error:', appError);
	}

	appStore.addNotification({
		type: 'error',
		message,
		duration: 5000
	});
}
