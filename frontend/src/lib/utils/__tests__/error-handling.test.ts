import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const addNotification = vi.fn();
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { addNotification }
}));

const {
	ApiError,
	NetworkError,
	NETWORK_FAILURE_MESSAGE,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE,
	handleErrorWithNotification,
	userFacingErrorMessage
} = await import('../error-handling');

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

describe('userFacingErrorMessage', () => {
	test.each([
		[
			'a network failure',
			new NetworkError(new TypeError('Failed to fetch')),
			NETWORK_FAILURE_MESSAGE
		],
		[
			'a known error code',
			new ApiError('Raw backend text', 400, undefined, 'VALIDATION_ERROR'),
			'Please check your input and try again.'
		],
		[
			'a 4xx with a written message',
			new ApiError('No VROOM account with that email', 404),
			'No VROOM account with that email.'
		],
		[
			'a 4xx with only a status line',
			new ApiError('Request failed with status 404', 404),
			UNEXPECTED_FAILURE_MESSAGE
		],
		[
			'a 500 with raw server text',
			new ApiError('Internal server error', 500),
			SERVER_FAILURE_MESSAGE
		],
		['a 503', new ApiError('Service Unavailable', 503), SERVER_FAILURE_MESSAGE],
		[
			'a bare TypeError (a bug, not the network)',
			new TypeError('x.fetchAll is not a function'),
			UNEXPECTED_FAILURE_MESSAGE
		],
		[
			'a reason the app states with a plain Error',
			new Error('Cannot sync while offline'),
			'Cannot sync while offline.'
		],
		[
			'a runtime failure (SyntaxError)',
			new SyntaxError('Unexpected token < in JSON'),
			UNEXPECTED_FAILURE_MESSAGE
		],
		['a non-Error throw', 'a bare string', UNEXPECTED_FAILURE_MESSAGE]
	])('%s becomes a plain sentence', (_label, error, expected) => {
		expect(userFacingErrorMessage(error)).toBe(expected);
	});

	test('only a real network failure is told to check the connection', () => {
		const notNetwork = [
			new ApiError('Internal server error', 500),
			new ApiError('Bad gateway', 502),
			new ApiError('Backup export timed out after 600000ms', 503, undefined, 'NETWORK_ERROR'),
			new TypeError('Failed to fetch')
		];
		for (const error of notNetwork) {
			expect(userFacingErrorMessage(error)).not.toMatch(/connection/i);
		}
		expect(userFacingErrorMessage(new NetworkError(new TypeError('Load failed')))).toBe(
			NETWORK_FAILURE_MESSAGE
		);
	});
});

describe('handleErrorWithNotification', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	test('the toast carries the plain sentence, never the raw message', () => {
		handleErrorWithNotification(new ApiError('Internal server error', 500));
		expect(notified()).toMatchObject({
			type: 'error',
			message: SERVER_FAILURE_MESSAGE,
			duration: 5000
		});
	});

	test('a context becomes its own sentence ahead of the plain sentence', () => {
		handleErrorWithNotification(
			new ApiError('Internal server error', 500),
			'Failed to load vehicle'
		);
		expect(notified().message).toBe(`Failed to load vehicle. ${SERVER_FAILURE_MESSAGE}`);
	});

	test('a network failure toast tells the user to check the connection', () => {
		handleErrorWithNotification(
			new NetworkError(new TypeError('Failed to fetch')),
			'Saving expense'
		);
		expect(notified().message).toBe(`Saving expense. ${NETWORK_FAILURE_MESSAGE}`);
	});
});
