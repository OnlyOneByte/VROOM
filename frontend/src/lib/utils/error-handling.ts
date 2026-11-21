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

// requireAuth's code. Other 401s (a storage provider's AUTH_INVALID) leave the VROOM session alone.
export function isSessionExpiryError(error: unknown): boolean {
	return (
		error instanceof ApiError && error.statusCode === 401 && error.code === 'AuthenticationError'
	);
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
	AuthenticationError: 'Your session has ended. Sign in again to continue.',
	RATE_LIMIT_EXCEEDED: 'That was a lot of requests at once. Wait a moment, then try again.',
	PAYLOAD_TOO_LARGE: "That's too large to upload. Try a smaller file.",
	BACKUP_IN_PROGRESS: 'A backup is already running. Try again once it finishes.',
	BACKUP_FAILED:
		"The backup didn't reach any of your storage providers. Check them in Settings, then try again.",
	AUTH_INVALID: 'Your storage account needs to be reconnected. Reconnect it in Settings.',
	PUSH_NOT_CONFIGURED: "Push notifications aren't set up on this server."
};

const STATUS_MESSAGES: Record<number, string> = {
	401: 'Your session has ended. Sign in again to continue.',
	429: 'That was a lot of requests at once. Wait a moment, then try again.'
};

export const NETWORK_FAILURE_MESSAGE = 'Check your connection and try again.';
export const SERVER_FAILURE_MESSAGE = 'Something went wrong on our side. Try again in a moment.';
export const UNEXPECTED_FAILURE_MESSAGE =
	'Something went wrong. Try again, and reload the page if it keeps happening.';
const INVALID_DETAILS_MESSAGE = "Some details aren't valid. Check them and try again.";

const STATUS_ONLY_MESSAGE = /^Request failed with status \d+$/;
const SCHEMA_DEFAULT_MESSAGE =
	/^(Invalid\b|Too (small|big)\b|Unrecognized key|Expected |Required$)/;

export class NonErrorThrownError extends Error {
	readonly thrown: unknown;

	constructor(thrown: unknown) {
		super(UNEXPECTED_FAILURE_MESSAGE);
		this.name = 'NonErrorThrownError';
		this.thrown = thrown;
	}
}

export function toError(thrown: unknown): Error {
	return thrown instanceof Error ? thrown : new NonErrorThrownError(thrown);
}

function asSentence(text: string): string {
	const capitalised = text.charAt(0).toUpperCase() + text.slice(1);
	return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

function isAppStatedReason(error: unknown): error is Error {
	return (
		error instanceof Error && Object.getPrototypeOf(error) === Error.prototype && !!error.message
	);
}

interface SchemaIssue {
	path: unknown[];
	message: string;
}

function schemaIssues(details: Record<string, unknown> | undefined): SchemaIssue[] {
	const raw = details?.['issues'] ?? details?.['validationErrors'];
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(issue): issue is SchemaIssue =>
			typeof issue === 'object' &&
			issue !== null &&
			Array.isArray((issue as SchemaIssue).path) &&
			typeof (issue as SchemaIssue).message === 'string'
	);
}

function fieldName(path: unknown[]): string | null {
	const key = [...path].reverse().find((part): part is string => typeof part === 'string');
	if (!key) return null;
	return key
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.toLowerCase();
}

function listFields(fields: string[]): string {
	const shown = fields.slice(0, 3);
	const rest = fields.length - shown.length;
	if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
	if (shown.length === 1) return shown[0] as string;
	return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

function validationSentence(issues: SchemaIssue[]): string | null {
	if (issues.length === 0) return null;
	const written = issues.find(issue => !SCHEMA_DEFAULT_MESSAGE.test(issue.message));
	if (written) return asSentence(written.message);
	const fields = [...new Set(issues.map(issue => fieldName(issue.path)).filter(f => f !== null))];
	if (fields.length === 0) return INVALID_DETAILS_MESSAGE;
	return `Check the ${listFields(fields)}, then try again.`;
}

export function userFacingErrorMessage(error: unknown): string {
	if (isNetworkError(error)) return NETWORK_FAILURE_MESSAGE;
	if (isVroomError(error)) {
		const status = error.statusCode ?? 0;
		const byCode = error.code ? ERROR_CODE_MESSAGES[error.code] : undefined;
		if (byCode) return byCode;
		if (status >= 500) return SERVER_FAILURE_MESSAGE;
		const byStatus = STATUS_MESSAGES[status];
		if (byStatus) return byStatus;
		const validation = validationSentence(schemaIssues(error.details));
		if (validation) return validation;
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
