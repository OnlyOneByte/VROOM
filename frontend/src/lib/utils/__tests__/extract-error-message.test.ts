/**
 * Unit tests for extractErrorMessage — the shared `error instanceof Error ? error.message
 * : fallback` idiom extracted from the catch blocks in load-state, the auth store, and the
 * sync manager (arch dedup, C90).
 *
 * The load-bearing contract is the PRECEDENCE: a real Error's own message WINS, and the
 * literal is only the fallback for a non-Error throw. (This is deliberately the OPPOSITE
 * ordering from handleApiError's `fallbackMessage || (...)`, which gives the caller's
 * message precedence — that site is intentionally NOT routed through this helper.)
 */

import { describe, expect, test } from 'vitest';
import { extractErrorMessage } from '../error-handling';

describe('extractErrorMessage', () => {
	test("an Error's own message wins over the fallback", () => {
		expect(extractErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
	});

	test('a subclass of Error is still unwrapped to its message', () => {
		class CustomError extends Error {}
		expect(extractErrorMessage(new CustomError('specific'), 'fallback')).toBe('specific');
	});

	test('a non-Error throw falls back to the literal', () => {
		expect(extractErrorMessage('a string', 'fallback')).toBe('fallback');
		expect(extractErrorMessage({ message: 'lookalike' }, 'fallback')).toBe('fallback');
		expect(extractErrorMessage(undefined, 'fallback')).toBe('fallback');
		expect(extractErrorMessage(null, 'fallback')).toBe('fallback');
		expect(extractErrorMessage(42, 'fallback')).toBe('fallback');
	});

	test('an Error with an empty message returns the empty string (does NOT fall back)', () => {
		// The error IS an Error, so its (empty) message wins — the fallback is only for
		// non-Errors. This pins that we branch on the type, not on message truthiness.
		expect(extractErrorMessage(new Error(''), 'fallback')).toBe('');
	});
});
