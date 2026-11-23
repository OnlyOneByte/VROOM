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
	NonErrorThrownError,
	handleErrorWithNotification,
	logLoadFailure,
	toError,
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
			'a code the backend sends (rate limit)',
			new ApiError('Too many requests', 429, undefined, 'RATE_LIMIT_EXCEEDED'),
			'That was a lot of requests at once. Wait a moment, then try again.'
		],
		[
			'a signed-out request (AuthenticationError)',
			new ApiError('Authentication required', 401, undefined, 'AuthenticationError'),
			'Your session has ended. Sign in again to continue.'
		],
		[
			'a 401 without a known code',
			new ApiError('Invalid session', 401, undefined, 'HTTPException'),
			'Your session has ended. Sign in again to continue.'
		],
		[
			'a backend timeout (503 NETWORK_ERROR), which can be local work as well as an upstream call',
			new ApiError('Backup export timed out after 600000ms', 503, undefined, 'NETWORK_ERROR'),
			SERVER_FAILURE_MESSAGE
		],
		[
			'a 500 DatabaseError',
			new ApiError('SQLITE_BUSY: database is locked', 500, undefined, 'DatabaseError'),
			SERVER_FAILURE_MESSAGE
		],
		[
			'a 4xx with a written message',
			new ApiError('No VROOM account uses that email.', 404),
			'No VROOM account uses that email.'
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

describe('the copy for each code the backend sends', () => {
	test.each([
		['AuthenticationError', 401],
		['RATE_LIMIT_EXCEEDED', 429],
		['PAYLOAD_TOO_LARGE', 413],
		['BACKUP_IN_PROGRESS', 409],
		['BACKUP_FAILED', 502],
		['AUTH_INVALID', 401],
		['PUSH_NOT_CONFIGURED', 503]
	])('%s gets its own full sentence, never the raw text or a connection hint', (code, status) => {
		const message = userFacingErrorMessage(
			new ApiError('raw backend text', status, undefined, code)
		);
		expect(message).not.toBe('Raw backend text.');
		expect(message).toMatch(/[.!?]$/);
		expect(message).not.toMatch(/connection/i);
		expect([SERVER_FAILURE_MESSAGE, UNEXPECTED_FAILURE_MESSAGE]).not.toContain(message);
	});
});

describe('userFacingErrorMessage for request validation', () => {
	const invalid = (details: Record<string, unknown>) =>
		new ApiError(
			'Invalid json: odometer: Invalid input: expected number, received string',
			400,
			details,
			'ValidationError'
		);
	const issue = (path: unknown[], message: string) => ({ path, message });

	test('a schema default message names the field instead of the schema text', () => {
		expect(
			userFacingErrorMessage(
				invalid({
					issues: [issue(['odometer'], 'Invalid input: expected number, received string')]
				})
			)
		).toBe('Check the odometer, then try again.');
	});

	test('several fields are listed in plain words', () => {
		expect(
			userFacingErrorMessage(
				invalid({
					issues: [
						issue(['odometer'], 'Invalid input: expected number, received string'),
						issue(['purchaseDate'], 'Too small: expected string to have >=1 characters'),
						issue(['splits', 0, 'fuel_type'], 'Invalid option: expected one of "gas"|"diesel"')
					]
				})
			)
		).toBe('Check the odometer, purchase date and fuel type, then try again.');
	});

	test.each([
		['agentEmail', 'Invalid email address'],
		['nonce', 'Invalid UUID'],
		['website', 'Invalid URL'],
		['purchaseDate', 'Invalid ISO date'],
		['lastBackupAt', 'Invalid ISO datetime'],
		['type', 'Invalid discriminator value. Expected "fuel" | "split"'],
		['volume', 'Invalid number: must be a multiple of 0.001'],
		['slug', 'Invalid lowercase'],
		['purchaseDate', 'Invalid date']
	])('the built-in %s message (%s) names the field instead', (field, message) => {
		const sentence = userFacingErrorMessage(invalid({ issues: [issue([field], message)] }));
		expect(sentence).toMatch(/^Check the .+, then try again\.$/);
		expect(sentence).not.toContain(message);
	});

	test('more than three fields are summarised', () => {
		const fields = ['a', 'b', 'c', 'd', 'e'].map(f =>
			issue([f], 'Too big: expected number to be <=1')
		);
		expect(userFacingErrorMessage(invalid({ issues: fields }))).toBe(
			'Check the a, b, c and 2 more, then try again.'
		);
	});

	test('a message the schema author wrote is shown as written', () => {
		expect(
			userFacingErrorMessage(
				invalid({
					issues: [
						issue(['odometer'], 'Invalid input: expected number, received string'),
						issue(['amount'], 'Amount exceeds the allowed maximum')
					]
				})
			)
		).toBe('Amount exceeds the allowed maximum.');
	});

	test('issues wrapped by the API client (validationErrors) are read too', () => {
		expect(
			userFacingErrorMessage(
				invalid({
					validationErrors: [
						issue(['vehicleId'], 'Invalid input: expected string, received undefined')
					]
				})
			)
		).toBe('Check the vehicle id, then try again.');
	});

	test('an issue with no field path gets a general sentence', () => {
		expect(userFacingErrorMessage(invalid({ issues: [issue([], 'Invalid input')] }))).toBe(
			"Some details aren't valid. Check them and try again."
		);
	});

	test('a validation error without schema issues keeps its own written reason', () => {
		expect(
			userFacingErrorMessage(
				new ApiError(
					'Unsupported image type. Use JPEG, PNG, or WebP.',
					400,
					undefined,
					'ValidationError'
				)
			)
		).toBe('Unsupported image type. Use JPEG, PNG, or WebP.');
	});
});

describe('toError', () => {
	test('keeps an Error as it is', () => {
		const error = new TypeError('boom');
		expect(toError(error)).toBe(error);
	});

	test.each([[{ status: 'weird' }], ['a string'], [42], [null]])(
		'wraps a thrown %j so it never reads as raw text or [object Object]',
		thrown => {
			const error = toError(thrown);
			expect(error).toBeInstanceOf(NonErrorThrownError);
			expect((error as InstanceType<typeof NonErrorThrownError>).thrown).toBe(thrown);
			expect(userFacingErrorMessage(error)).toBe(UNEXPECTED_FAILURE_MESSAGE);
			expect(error.message).not.toContain('[object Object]');
		}
	);
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

describe('logLoadFailure', () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	test('logs a load failure in dev without raising a toast', () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new ApiError('Internal server error', 500);

		logLoadFailure(failure, "Couldn't load the dashboard");

		expect(addNotification).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith(
			"Couldn't load the dashboard.",
			expect.objectContaining({ message: SERVER_FAILURE_MESSAGE, statusCode: 500 }),
			failure
		);
	});
});
