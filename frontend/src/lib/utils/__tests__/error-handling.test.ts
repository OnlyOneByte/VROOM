import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const addNotification = vi.fn();
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { addNotification }
}));

const { ApiError, NetworkError, handleErrorWithNotification } = await import('../error-handling');

interface NotificationArg {
	type: string;
	message: string;
	duration?: number;
}

function notified(): NotificationArg {
	expect(addNotification).toHaveBeenCalledTimes(1);
	const arg = addNotification.mock.calls[0]?.[0] as NotificationArg | undefined;
	expect(arg).toBeDefined();
	return arg as NotificationArg;
}

describe('ApiError', () => {
	test('is an Error subclass carrying message + statusCode, defaulting code to API_ERROR', () => {
		const e = new ApiError('Boom', 500);
		expect(e).toBeInstanceOf(Error);
		expect(e.name).toBe('ApiError');
		expect(e.message).toBe('Boom');
		expect(e.statusCode).toBe(500);
		expect(e.code).toBe('API_ERROR');
	});

	test('uses the backend code when supplied, and carries details', () => {
		const e = new ApiError('Bad', 400, { field: 'amount' }, 'VALIDATION_ERROR');
		expect(e.code).toBe('VALIDATION_ERROR');
		expect(e.statusCode).toBe(400);
		expect(e.details).toEqual({ field: 'amount' });
	});
});

describe('handleErrorWithNotification (drives handleApiError)', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	test('a known error code maps to its user-friendly message (not the raw message)', () => {
		handleErrorWithNotification(
			new ApiError('Raw backend text', 400, undefined, 'VALIDATION_ERROR')
		);
		expect(notified()).toMatchObject({
			type: 'error',
			message: 'Please check your input and try again',
			duration: 5000
		});
	});

	test('an unmapped code falls back to the error’s own message', () => {
		handleErrorWithNotification(new ApiError('Specific failure detail', 500));
		expect(notified().message).toBe('Specific failure detail');
	});

	test.each(['Failed to fetch', 'Load failed'])(
		'a NetworkError (%s) maps to the connection message',
		browserMessage => {
			handleErrorWithNotification(new NetworkError(new TypeError(browserMessage)));
			expect(notified().message).toBe('Network error. Please check your connection and try again.');
		}
	);

	test('a bare TypeError is a bug, not a network failure', () => {
		handleErrorWithNotification(new TypeError('x.fetchAll is not a function'));
		expect(notified().message).toBe('x.fetchAll is not a function');
	});

	test('a plain Error (not Vroom, not network) surfaces its own message under UNKNOWN_ERROR', () => {
		handleErrorWithNotification(new Error('plain boom'));
		expect(notified().message).toBe('plain boom');
	});

	test('a non-Error throw uses the generic unexpected-error copy', () => {
		handleErrorWithNotification('a bare string');
		expect(notified().message).toBe('An unexpected error occurred');
	});

	test('a context prefix is prepended to the resolved message', () => {
		handleErrorWithNotification(new ApiError('boom', 500), 'Saving expense');
		expect(notified().message).toBe('Saving expense: boom');
	});
});
