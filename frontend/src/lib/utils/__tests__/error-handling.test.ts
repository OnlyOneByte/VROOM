/**
 * Coverage ratchet (guard, C137) for error-handling.ts — the C124 report's top FE low spot (34% line)
 * and a load-bearing module: every page's catch routes a thrown value through
 * `handleErrorWithNotification`, which drives the private `handleApiError` mapping (the user-facing
 * error copy). `extractErrorMessage` is already pinned (C90); this covers the rest — the `ApiError`
 * class, the 3-way `handleApiError` branch (VroomError → friendly-or-own message / network error /
 * unknown fallback), the error-code→friendly-message map, and the notification side-effect.
 *
 * The store is mocked (the analytics-api.test.ts pattern) so we can spy on what message + shape
 * actually reaches the notification — i.e. what the user would see — without a live rune store.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const addNotification = vi.fn();
vi.mock('$lib/stores/app.svelte', () => ({
	appStore: { addNotification }
}));

const { ApiError, handleErrorWithNotification } = await import('../error-handling');

interface NotificationArg {
	type: string;
	message: string;
	duration?: number;
}

/** The single notification raised by one handleErrorWithNotification call. */
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
		// DEV builds console.error the AppError; silence it so the run stays clean.
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	test('a known error code maps to its user-friendly message (not the raw message)', () => {
		// VALIDATION_ERROR is in ERROR_CODE_MESSAGES → the friendly copy wins over "Raw backend text".
		handleErrorWithNotification(new ApiError('Raw backend text', 400, undefined, 'VALIDATION_ERROR'));
		expect(notified()).toMatchObject({
			type: 'error',
			message: 'Please check your input and try again',
			duration: 5000
		});
	});

	test('an unmapped code falls back to the error’s own message', () => {
		// 'API_ERROR' (the ApiError default) is NOT in the friendly map → the real message surfaces.
		handleErrorWithNotification(new ApiError('Specific failure detail', 500));
		expect(notified().message).toBe('Specific failure detail');
	});

	test('a network TypeError (fetch) maps to the connection message', () => {
		// isNetworkError = TypeError whose message includes "fetch".
		handleErrorWithNotification(new TypeError('Failed to fetch'));
		expect(notified().message).toBe('Network error. Please check your connection and try again.');
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
