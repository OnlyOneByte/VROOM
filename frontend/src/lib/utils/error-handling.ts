import { appStore } from '#lib/stores/app.svelte.ts';

export function extractErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

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

export class NetworkError extends TypeError {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : 'Network request failed', { cause });
		this.name = 'NetworkError';
	}
}

function isVroomError(error: unknown): error is VroomError {
	return error instanceof VroomError;
}

function isNetworkError(error: unknown): boolean {
	return error instanceof NetworkError;
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
	VALIDATION_ERROR: 'Please check your input and try again.',
	NOT_FOUND: 'The requested resource was not found.',
	UNAUTHORIZED: 'You need to be logged in to perform this action.',
	FORBIDDEN: 'You do not have permission to perform this action.',
	CONFLICT: 'This resource already exists or conflicts with existing data.',
	RATE_LIMIT_EXCEEDED: 'Too many requests. Please wait a moment and try again.',
	DATABASE_ERROR: 'A database error occurred. Please try again.',
	NETWORK_ERROR: 'Check your connection and try again.',
	AUTH_INVALID: 'Your session has expired. Please log in again.',
	SYNC_IN_PROGRESS: 'A sync operation is already in progress.',
	QUOTA_EXCEEDED: 'Storage quota exceeded.',
	PERMISSION_DENIED: 'Permission denied'
};

function getUserFriendlyMessage(code: string | undefined): string | undefined {
	if (!code) return undefined;
	return ERROR_CODE_MESSAGES[code];
}

export const NETWORK_FAILURE_MESSAGE = 'Check your connection and try again.';
export const SERVER_FAILURE_MESSAGE = 'Something went wrong on our side. Try again in a moment.';
export const UNEXPECTED_FAILURE_MESSAGE =
	'Something went wrong. Try again, and reload the page if it keeps happening.';

const STATUS_ONLY_MESSAGE = /^Request failed with status \d+$/;

function asSentence(text: string): string {
	const capitalised = text.charAt(0).toUpperCase() + text.slice(1);
	return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

function isAppStatedReason(error: unknown): error is Error {
	return (
		error instanceof Error && Object.getPrototypeOf(error) === Error.prototype && !!error.message
	);
}

export function userFacingErrorMessage(error: unknown): string {
	if (isNetworkError(error)) return NETWORK_FAILURE_MESSAGE;
	if (isVroomError(error)) {
		const status = error.statusCode ?? 0;
		if (status >= 500) return SERVER_FAILURE_MESSAGE;
		const friendlyMessage = getUserFriendlyMessage(error.code);
		if (friendlyMessage) return asSentence(friendlyMessage);
		if (status >= 400 && error.message && !STATUS_ONLY_MESSAGE.test(error.message)) {
			return asSentence(error.message);
		}
	}
	if (isAppStatedReason(error)) return asSentence(error.message);
	return UNEXPECTED_FAILURE_MESSAGE;
}

function handleApiError(error: unknown): AppError {
	const message = userFacingErrorMessage(error);
	if (isVroomError(error)) {
		return { message, code: error.code, statusCode: error.statusCode, details: error.details };
	}
	if (isNetworkError(error)) {
		return { message, code: 'NETWORK_ERROR', statusCode: 0 };
	}
	return { message, code: 'UNKNOWN_ERROR' };
}

export function handleErrorWithNotification(error: unknown, context?: string): void {
	const appError = handleApiError(error);
	const message = context ? `${asSentence(context)} ${appError.message}` : appError.message;

	if (import.meta.env.DEV) {
		console.error('Application error:', appError, error);
	}

	appStore.addNotification({
		type: 'error',
		message,
		duration: 5000
	});
}
