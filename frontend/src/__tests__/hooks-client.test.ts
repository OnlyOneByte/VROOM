import { afterEach, describe, expect, test, vi } from 'vitest';
import type { HandleClientError } from '@sveltejs/kit/hooks';
import { handleError } from '../hooks.client';

type HandleErrorInput = Parameters<HandleClientError>[0];
const event = {} as HandleErrorInput['event'];

describe('client handleError', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('leaves expected app and framework errors to SvelteKit defaults and does not log them', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(
			handleError({ kind: 'app', error: { status: 403, message: 'Forbidden' }, event })
		).toBeUndefined();
		expect(
			handleError({ kind: 'framework', error: { status: 404, message: 'Not Found' }, event })
		).toBeUndefined();
		expect(consoleError).not.toHaveBeenCalled();
	});

	test('masks unknown errors and logs them in development', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(handleError({ kind: 'unknown', error: new Error('boom'), event })).toEqual({
			message: 'An unexpected error occurred'
		});
		expect(consoleError).toHaveBeenCalledWith('Client error:', expect.any(Error), event);
	});
});
